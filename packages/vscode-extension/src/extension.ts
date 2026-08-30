import * as vscode from "vscode";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import {
  BROWSER_EXTENSION_ID,
  CLI_ORIGIN,
  DEFAULT_PORT,
  LANGUAGE_EXTENSIONS,
  PROTOCOL_VERSION,
  SITES,
  isLanguage,
  parseCliMessage,
  parseBrowserMessage,
  problemKey,
  type ActiveEditorChangedMessage,
  type BrowserToWorkspaceMessage,
  type CliPushMessage,
  type CliUpdateMessage,
  type ProblemContext,
  type Site,
  type WorkspaceToBrowserMessage
} from "@algo-sync/shared";
import {
  DEFAULT_SITE_DIRECTORIES,
  STATEMENT_FILENAME,
  existingFilePrefix,
  mergeStatementMarkdown,
  normalizeRelativeDirectory,
  problemDirectoryName,
  shouldSyncSavedFile,
  solutionFilename,
  type WorkspaceConfig
} from "./core";

interface ActiveTarget {
  key: string;
  tabId: number;
  context: ProblemContext;
  fileUri: vscode.Uri;
  statementUri: vscode.Uri;
  socket: WebSocket;
}

interface PendingCliSubmission {
  socket: WebSocket;
  tabId: number;
  timeout: ReturnType<typeof setTimeout>;
}

let server: WebSocketServer | undefined;
let activeTarget: ActiveTarget | undefined;
let status: vscode.StatusBarItem | undefined;
let statusText = "未启动";
let output: vscode.OutputChannel | undefined;
const pendingCliSubmissions = new Map<string, PendingCliSubmission>();
const MPE_EXTENSION_ID = "shd101wyy.markdown-preview-enhanced";
const MPE_OPEN_PREVIEW_COMMAND = "markdown-preview-enhanced.openPreview";

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
    vscode.commands.registerCommand("algoSync.showStatement", () => {
      if (!activeTarget) {
        void vscode.window.showInformationMessage("Algo Sync：当前没有活动题目");
        return;
      }
      void showStatementPreview(activeTarget.statementUri);
    }),
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
  for (const pending of pendingCliSubmissions.values()) clearTimeout(pending.timeout);
  pendingCliSubmissions.clear();
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
    statementPreview: raw.statementPreview !== false,
    siteDirectories
  };
}

function startServer(port: number, folder: vscode.WorkspaceFolder, config: WorkspaceConfig): Promise<WebSocketServer> {
  return new Promise((resolve, reject) => {
    const instance = new WebSocketServer({
      host: "127.0.0.1",
      port,
      maxPayload: 2_100_000,
      verifyClient: ({ origin }: { origin?: string }) =>
        origin === `chrome-extension://${BROWSER_EXTENSION_ID}` || origin === CLI_ORIGIN
    });
    const onError = (error: Error) => reject(error);
    instance.once("error", onError);
    instance.once("listening", () => {
      instance.off("error", onError);
      instance.on("error", (error) => {
        setStatus(`服务错误：${error.message}`, "$(error) Algo Sync");
      });
      instance.on("connection", (socket, request) => {
        if (request.headers.origin === CLI_ORIGIN) attachCliSocket(socket, folder);
        else attachBrowserSocket(socket, folder, config);
      });
      resolve(instance);
    });
  });
}

function attachBrowserSocket(socket: WebSocket, folder: vscode.WorkspaceFolder, config: WorkspaceConfig): void {
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
    const closedTarget = activeTarget?.socket === socket ? activeTarget : undefined;
    if (closedTarget) activeTarget = undefined;
    for (const [requestId, pending] of pendingCliSubmissions) {
      if (pending.tabId === closedTarget?.tabId) finishCliSubmission(requestId, "error", "浏览器连接已断开", false);
    }
    setStatus("正在等待浏览器", "$(radio-tower) Algo Sync");
    log("浏览器连接已关闭");
  });
}

function attachCliSocket(socket: WebSocket, folder: vscode.WorkspaceFolder): void {
  log("acm CLI 已连接");
  socket.on("message", (data) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      sendCliError(socket, "invalid-json", "CLI 消息不是有效 JSON");
      return;
    }
    const message = parseCliMessage(parsed);
    if (!message) {
      sendCliError(socket, "invalid-message", "CLI 消息结构或协议版本无效");
      return;
    }
    if (message.type === "ping") {
      sendRaw(socket, { type: "pong", protocolVersion: PROTOCOL_VERSION });
      return;
    }
    if (message.type === "cliPush") void handleCliPush(socket, message, folder);
  });
  socket.on("close", () => {
    for (const [requestId, pending] of pendingCliSubmissions) {
      if (pending.socket === socket) {
        clearTimeout(pending.timeout);
        pendingCliSubmissions.delete(requestId);
      }
    }
  });
}

async function handleCliPush(socket: WebSocket, message: CliPushMessage, folder: vscode.WorkspaceFolder): Promise<void> {
  const target = activeTarget;
  if (!target || target.socket.readyState !== WebSocket.OPEN) {
    sendCliUpdate(socket, message.requestId, "error", "当前没有已连接的活动题目网页", undefined, false);
    return;
  }
  const workspacePath = path.resolve(folder.uri.fsPath);
  const cwd = path.resolve(message.cwd);
  const targetDirectory = path.dirname(path.resolve(target.fileUri.fsPath));
  if (!isSameOrInside(cwd, workspacePath)) {
    sendCliUpdate(socket, message.requestId, "error", "请在当前 Algo Sync 工作空间内运行 acm push", target, false);
    return;
  }
  const cwdMatchesTarget = isSameOrInside(target.fileUri.fsPath, cwd) || isSameOrInside(cwd, targetDirectory);
  if (!cwdMatchesTarget) {
    sendCliUpdate(socket, message.requestId, "error", "终端目录与浏览器当前题目不匹配", target, false);
    return;
  }
  if (pendingCliSubmissions.size > 0) {
    sendCliUpdate(socket, message.requestId, "error", "已有一个提交正在等待评测，请稍后再试", target, false);
    return;
  }
  const document = await vscode.workspace.openTextDocument(target.fileUri);
  const code = document.getText();
  if (!code.trim()) {
    sendCliUpdate(socket, message.requestId, "error", "当前题目代码文件为空，已取消提交", target, false);
    return;
  }
  const timeout = setTimeout(() => {
    finishCliSubmission(message.requestId, "error", "等待浏览器评测结果超时", false);
  }, 10 * 60_000 + 15_000);
  pendingCliSubmissions.set(message.requestId, { socket, tabId: target.tabId, timeout });
  sendCliUpdate(socket, message.requestId, "preparing", `准备提交 ${path.basename(target.fileUri.fsPath)}`, target);
  send(target.socket, {
    type: "submitCode",
    protocolVersion: PROTOCOL_VERSION,
    requestId: message.requestId,
    tabId: target.tabId,
    site: target.context.site,
    problemId: target.context.problemId,
    language: target.context.language,
    code
  });
  log(`CLI 请求提交：${target.context.site}/${target.context.problemId}/${target.context.language}，${code.length} 字符`);
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
    return;
  }
  if (message.type === "submissionUpdate") {
    const pending = pendingCliSubmissions.get(message.requestId);
    if (!pending || pending.tabId !== message.tabId) return;
    const target = activeTarget;
    sendCliUpdate(pending.socket, message.requestId, message.phase, message.status, target, message.success);
    log(`评测状态：${message.status}`);
    if (message.phase === "finished" || message.phase === "error") {
      clearTimeout(pending.timeout);
      pendingCliSubmissions.delete(message.requestId);
      setStatus(message.phase === "finished" ? message.status : `提交失败：${message.status}`,
        message.success ? "$(pass) Algo Sync" : "$(error) Algo Sync");
    } else {
      setStatus(message.status, "$(loading~spin) Algo Sync");
    }
  }
}

async function activateProblemFile(
  socket: WebSocket,
  message: ActiveEditorChangedMessage,
  folder: vscode.WorkspaceFolder,
  config: WorkspaceConfig
): Promise<void> {
  const context = message.context;
  const siteDirectory = vscode.Uri.joinPath(folder.uri, config.solutionRoot, config.siteDirectories[context.site]);
  await vscode.workspace.fs.createDirectory(siteDirectory);
  const problemDirectory = await findOrCreateProblemDirectory(siteDirectory, context);
  const fileUri = await findOrCreateFile(problemDirectory, context);
  const statementUri = vscode.Uri.joinPath(problemDirectory, STATEMENT_FILENAME);
  await updateStatementFile(statementUri, context);
  activeTarget = {
    key: problemKey(context),
    tabId: message.tabId,
    context,
    fileUri: fileUri.uri,
    statementUri,
    socket
  };
  log(`活动目标：${context.site}/${context.problemId}/${context.language} -> ${fileUri.uri.fsPath}`);
  const document = await vscode.workspace.openTextDocument(fileUri.uri);
  if (config.statementPreview) await showStatementPreview(statementUri);
  await vscode.window.showTextDocument(document, {
    preview: false,
    preserveFocus: false,
    viewColumn: config.statementPreview ? vscode.ViewColumn.Beside : undefined
  });
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

async function showStatementPreview(statementUri: vscode.Uri): Promise<void> {
  const statementDocument = await vscode.workspace.openTextDocument(statementUri);
  await vscode.window.showTextDocument(statementDocument, {
    preview: true,
    preserveFocus: false,
    viewColumn: vscode.ViewColumn.One
  });
  try {
    const enhancedPreview = vscode.extensions.getExtension(MPE_EXTENSION_ID);
    if (!enhancedPreview) throw new Error("Markdown Preview Enhanced 未安装");
    if (!enhancedPreview.isActive) await enhancedPreview.activate();
    await vscode.commands.executeCommand(MPE_OPEN_PREVIEW_COMMAND, statementUri);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`增强题面预览不可用，已退回内置预览：${message}`);
    void vscode.window.showWarningMessage(`Algo Sync：增强题面预览不可用，已使用内置预览。${message}`);
    await vscode.commands.executeCommand("markdown.showPreview", statementUri);
  }
}

async function findOrCreateFile(
  problemDirectory: vscode.Uri,
  context: ProblemContext
): Promise<{ uri: vscode.Uri; created: boolean }> {
  const extension = LANGUAGE_EXTENSIONS[context.language];
  const prefix = existingFilePrefix(context.problemId).toLocaleLowerCase();
  const entries = await vscode.workspace.fs.readDirectory(problemDirectory);
  const existing = entries
    .filter(([name, type]) => type === vscode.FileType.File &&
      name.toLocaleLowerCase().startsWith(prefix) && name.toLocaleLowerCase().endsWith(extension))
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b))[0];
  if (existing) return { uri: vscode.Uri.joinPath(problemDirectory, existing), created: false };

  const uri = vscode.Uri.joinPath(problemDirectory, solutionFilename(context.problemId, context.title, context.language));
  try {
    await vscode.workspace.fs.stat(uri);
    return { uri, created: false };
  } catch {
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(context.code));
    return { uri, created: true };
  }
}

async function findOrCreateProblemDirectory(siteDirectory: vscode.Uri, context: ProblemContext): Promise<vscode.Uri> {
  const prefix = existingFilePrefix(context.problemId).toLocaleLowerCase();
  const entries = await vscode.workspace.fs.readDirectory(siteDirectory);
  const existing = entries
    .filter(([name, type]) => type === vscode.FileType.Directory && name.toLocaleLowerCase().startsWith(prefix))
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b))[0];
  const directory = vscode.Uri.joinPath(
    siteDirectory,
    existing ?? problemDirectoryName(context.problemId, context.title)
  );
  await vscode.workspace.fs.createDirectory(directory);
  return directory;
}

async function updateStatementFile(uri: vscode.Uri, context: ProblemContext): Promise<void> {
  let existing = "";
  try {
    existing = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    // The statement will be created below.
  }
  const updated = mergeStatementMarkdown(existing, context);
  if (updated === existing) return;
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(updated));
  log(`题面文件已更新：${uri.fsPath}，${context.statementMarkdown?.length ?? 0} 字符`);
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

function sendCliUpdate(
  socket: WebSocket,
  requestId: string,
  phase: CliUpdateMessage["phase"],
  statusMessage: string,
  target?: ActiveTarget,
  success?: boolean
): void {
  sendRaw(socket, {
    type: "cliUpdate",
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    phase,
    status: statusMessage,
    site: target?.context.site,
    problemId: target?.context.problemId,
    language: target?.context.language,
    success
  } satisfies CliUpdateMessage);
}

function finishCliSubmission(requestId: string, phase: "finished" | "error", message: string, success?: boolean): void {
  const pending = pendingCliSubmissions.get(requestId);
  if (!pending) return;
  sendCliUpdate(pending.socket, requestId, phase, message, activeTarget, success);
  clearTimeout(pending.timeout);
  pendingCliSubmissions.delete(requestId);
}

function sendCliError(socket: WebSocket, code: string, message: string): void {
  sendRaw(socket, { type: "error", protocolVersion: PROTOCOL_VERSION, code, message });
}

function sendRaw(socket: WebSocket, message: object): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function isSameOrInside(candidate: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
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
