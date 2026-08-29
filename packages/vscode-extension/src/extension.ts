import * as vscode from "vscode";
import { WebSocket, WebSocketServer } from "ws";
import {
  BROWSER_EXTENSION_ID,
  DEFAULT_PORT,
  LANGUAGE_EXTENSIONS,
  PROTOCOL_VERSION,
  SITES,
  isLanguage,
  parseBrowserMessage,
  problemKey,
  type ActiveEditorChangedMessage,
  type BrowserToWorkspaceMessage,
  type ProblemContext,
  type Site,
  type WorkspaceToBrowserMessage
} from "@algo-sync/shared";
import {
  DEFAULT_SITE_DIRECTORIES,
  existingFilePrefix,
  normalizeRelativeDirectory,
  shouldSyncSavedFile,
  solutionFilename,
  type WorkspaceConfig
} from "./core";

interface ActiveTarget {
  key: string;
  tabId: number;
  context: ProblemContext;
  fileUri: vscode.Uri;
  socket: WebSocket;
}

let server: WebSocketServer | undefined;
let activeTarget: ActiveTarget | undefined;
let status: vscode.StatusBarItem | undefined;
let statusText = "未启动";
let output: vscode.OutputChannel | undefined;

export async function activate(extensionContext: vscode.ExtensionContext): Promise<void> {
  const located = await locateWorkspace();
  if (!located) return;
  const { folder, marker } = located;
  const config = await readConfig(marker);
  if (!config.enabled) return;

  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  output = vscode.window.createOutputChannel("Algo Sync");
  status.command = "algoSync.showStatus";
  status.show();
  setStatus("正在等待浏览器", "$(radio-tower) Algo Sync");

  extensionContext.subscriptions.push(
    status,
    output,
    vscode.commands.registerCommand("algoSync.showStatus", () => {
      void vscode.window.showInformationMessage(`Algo Sync：${statusText}`);
    }),
    vscode.commands.registerCommand("algoSync.showLog", () => output?.show(true)),
    vscode.workspace.onDidSaveTextDocument((document) => {
      void handleSavedDocument(document);
    })
  );

  try {
    server = await startServer(config.port, folder, config);
    log(`服务已启动：127.0.0.1:${config.port}`);
    extensionContext.subscriptions.push({ dispose: () => server?.close() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus("启动失败", "$(error) Algo Sync");
    log(`服务启动失败：${message}`);
    void vscode.window.showErrorMessage(`Algo Sync 无法监听 127.0.0.1:${config.port}：${message}`);
  }
}

export function deactivate(): void {
  activeTarget = undefined;
  server?.close();
  server = undefined;
}

async function locateWorkspace(): Promise<{ folder: vscode.WorkspaceFolder; marker: vscode.Uri } | undefined> {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const marker = vscode.Uri.joinPath(folder.uri, ".algo-sync.json");
    try {
      await vscode.workspace.fs.stat(marker);
      return { folder, marker };
    } catch {
      // This folder is intentionally not enabled.
    }
  }
  return undefined;
}

async function readConfig(marker: vscode.Uri): Promise<WorkspaceConfig> {
  const raw = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(marker))) as Record<string, unknown>;
  const rawDirs = typeof raw.siteDirectories === "object" && raw.siteDirectories !== null
    ? raw.siteDirectories as Record<string, unknown>
    : {};
  const siteDirectories = Object.fromEntries(SITES.map((site) => [
    site,
    normalizeRelativeDirectory(rawDirs[site], DEFAULT_SITE_DIRECTORIES[site])
  ])) as Record<Site, string>;
  const requestedPort = typeof raw.port === "number" && Number.isInteger(raw.port) ? raw.port : DEFAULT_PORT;
  return {
    enabled: raw.enabled !== false,
    port: requestedPort >= DEFAULT_PORT && requestedPort <= DEFAULT_PORT + 9 ? requestedPort : DEFAULT_PORT,
    solutionRoot: normalizeRelativeDirectory(raw.solutionRoot, "."),
    defaultLanguage: isLanguage(raw.defaultLanguage) ? raw.defaultLanguage : "cpp",
    siteDirectories
  };
}

function startServer(port: number, folder: vscode.WorkspaceFolder, config: WorkspaceConfig): Promise<WebSocketServer> {
  return new Promise((resolve, reject) => {
    const instance = new WebSocketServer({
      host: "127.0.0.1",
      port,
      maxPayload: 2_100_000,
      verifyClient: ({ origin }: { origin?: string }) => origin === `chrome-extension://${BROWSER_EXTENSION_ID}`
    });
    const onError = (error: Error) => reject(error);
    instance.once("error", onError);
    instance.once("listening", () => {
      instance.off("error", onError);
      instance.on("error", (error) => {
        setStatus(`服务错误：${error.message}`, "$(error) Algo Sync");
      });
      instance.on("connection", (socket) => attachSocket(socket, folder, config));
      resolve(instance);
    });
  });
}

function attachSocket(socket: WebSocket, folder: vscode.WorkspaceFolder, config: WorkspaceConfig): void {
  log("浏览器已建立 WebSocket 连接");
  setStatus("浏览器已连接", "$(plug) Algo Sync");
  socket.on("message", (data) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      send(socket, { type: "error", protocolVersion: PROTOCOL_VERSION, code: "invalid-json", message: "消息不是有效 JSON" });
      return;
    }
    const message = parseBrowserMessage(parsed);
    if (!message) {
      send(socket, { type: "error", protocolVersion: PROTOCOL_VERSION, code: "invalid-message", message: "消息结构或协议版本无效" });
      return;
    }
    void handleBrowserMessage(socket, message, folder, config);
  });
  socket.on("close", () => {
    if (activeTarget?.socket === socket) activeTarget = undefined;
    setStatus("正在等待浏览器", "$(radio-tower) Algo Sync");
    log("浏览器连接已关闭");
  });
}

async function handleBrowserMessage(
  socket: WebSocket,
  message: BrowserToWorkspaceMessage,
  folder: vscode.WorkspaceFolder,
  config: WorkspaceConfig
): Promise<void> {
  if (message.type === "hello") {
    log(`浏览器握手成功：${message.extensionVersion}`);
    send(socket, {
      type: "ready",
      protocolVersion: PROTOCOL_VERSION,
      workspaceName: folder.name,
      defaultLanguage: config.defaultLanguage
    });
    return;
  }
  if (message.type === "ping") {
    send(socket, { type: "pong", protocolVersion: PROTOCOL_VERSION });
    return;
  }
  if (message.type === "activeEditorChanged") {
    await activateProblemFile(socket, message, folder, config);
    return;
  }
  if (message.type === "applyResult") {
    log(message.ok ? `网页写入成功：标签 ${message.tabId}` : `网页写入失败：${message.message ?? "未知错误"}`);
    setStatus(message.ok ? "代码已同步到网页" : `网页同步失败：${message.message ?? "未知错误"}`,
      message.ok ? "$(check) Algo Sync" : "$(error) Algo Sync");
  }
}

async function activateProblemFile(
  socket: WebSocket,
  message: ActiveEditorChangedMessage,
  folder: vscode.WorkspaceFolder,
  config: WorkspaceConfig
): Promise<void> {
  const context = message.context;
  const directory = vscode.Uri.joinPath(folder.uri, config.solutionRoot, config.siteDirectories[context.site]);
  await vscode.workspace.fs.createDirectory(directory);
  const fileUri = await findOrCreateFile(directory, context);
  activeTarget = {
    key: problemKey(context),
    tabId: message.tabId,
    context,
    fileUri: fileUri.uri,
    socket
  };
  log(`活动目标：${context.site}/${context.problemId}/${context.language} -> ${fileUri.uri.fsPath}`);
  const document = await vscode.workspace.openTextDocument(fileUri.uri);
  await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
  send(socket, {
    type: "localFileReady",
    protocolVersion: PROTOCOL_VERSION,
    tabId: message.tabId,
    relativePath: vscode.workspace.asRelativePath(fileUri.uri, false).replace(/\\/g, "/"),
    created: fileUri.created
  });
  setStatus(`${context.site} ${context.problemId} · ${context.language}`,
    fileUri.created ? "$(new-file) Algo Sync" : "$(file-code) Algo Sync");
}

async function findOrCreateFile(
  directory: vscode.Uri,
  context: ProblemContext
): Promise<{ uri: vscode.Uri; created: boolean }> {
  const extension = LANGUAGE_EXTENSIONS[context.language];
  const prefix = existingFilePrefix(context.problemId).toLocaleLowerCase();
  const entries = await vscode.workspace.fs.readDirectory(directory);
  const existing = entries
    .filter(([name, type]) => type === vscode.FileType.File &&
      name.toLocaleLowerCase().startsWith(prefix) && name.toLocaleLowerCase().endsWith(extension))
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b))[0];
  if (existing) return { uri: vscode.Uri.joinPath(directory, existing), created: false };

  const uri = vscode.Uri.joinPath(directory, solutionFilename(context.problemId, context.title, context.language));
  try {
    await vscode.workspace.fs.stat(uri);
    return { uri, created: false };
  } catch {
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(context.code));
    return { uri, created: true };
  }
}

async function handleSavedDocument(document: vscode.TextDocument): Promise<void> {
  const target = activeTarget;
  if (!target) {
    log(`保存未同步（没有活动网页题目）：${document.uri.fsPath}`);
    return;
  }
  if (target.socket.readyState !== WebSocket.OPEN) {
    log(`保存未同步（浏览器连接未就绪）：${document.uri.fsPath}`);
    return;
  }
  if (!shouldSyncSavedFile(document.uri.fsPath, target.fileUri.fsPath)) {
    log(`保存未同步（不是当前题目文件）：${document.uri.fsPath}`);
    return;
  }
  send(target.socket, {
    type: "savedCode",
    protocolVersion: PROTOCOL_VERSION,
    tabId: target.tabId,
    site: target.context.site,
    problemId: target.context.problemId,
    language: target.context.language,
    code: document.getText()
  });
  log(`已发送保存代码：${target.context.site}/${target.context.problemId}/${target.context.language}，${document.getText().length} 字符`);
  setStatus("正在同步到网页", "$(sync~spin) Algo Sync");
}

function send(socket: WebSocket, message: WorkspaceToBrowserMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function setStatus(detail: string, label: string): void {
  statusText = detail;
  if (!status) return;
  status.text = label;
  status.tooltip = `Algo Sync：${detail}`;
}

function log(message: string): void {
  output?.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
}
