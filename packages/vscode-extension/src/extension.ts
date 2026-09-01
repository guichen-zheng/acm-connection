import * as vscode from "vscode";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
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
  type CliBrowserRefreshMessage,
  type CliFetchMessage,
  type CliPushMessage,
  type CliRemoteMessage,
  type CliRefreshMessage,
  type CliSwitchMessage,
  type CliUpdateMessage,
  type Language,
  type ProblemContext,
  type Site,
  type TestPointResult,
  type WorkspaceToBrowserMessage
} from "@algo-sync/shared";
import {
  DEFAULT_SITE_DIRECTORIES,
  STATEMENT_FILENAME,
  existingFilePrefix,
  formatRemoteProblems,
  isStatementPreviewTab,
  mergeStatementMarkdown,
  normalizeRelativeDirectory,
  problemDirectoryName,
  resolveInitialTemplate,
  sanitizePathPart,
  shouldDispatchLanguageSwitch,
  shouldSyncSavedFile,
  solutionFilename,
  type WorkspaceConfig
} from "./core";
import { planBrowserWake, type BrowserWakePlan } from "./browser-launch";

interface ActiveTarget {
  key: string;
  tabId: number;
  context: ProblemContext;
  fileUri: vscode.Uri;
  statementUri: vscode.Uri;
  initialUri: vscode.Uri;
  socket: WebSocket;
}

interface PendingCliSubmission {
  socket: WebSocket;
  tabId: number;
  timeout: ReturnType<typeof setTimeout>;
}

interface BrowserConnection {
  userAgent: string;
  connectedAt: number;
}

interface PendingCliAction {
  socket: WebSocket;
  browserSocket: WebSocket;
  timeout: ReturnType<typeof setTimeout>;
  target?: ActiveTarget;
  rollbackCode?: string;
  resultLanguage?: Language;
}

let server: WebSocketServer | undefined;
let activeTarget: ActiveTarget | undefined;
let status: vscode.StatusBarItem | undefined;
let statusText = "未启动";
let output: vscode.OutputChannel | undefined;
const pendingCliSubmissions = new Map<string, PendingCliSubmission>();
const browserConnections = new Map<WebSocket, BrowserConnection>();
const pendingCliActions = new Map<string, PendingCliAction>();
const suppressedSavePaths = new Set<string>();
const MPE_EXTENSION_ID = "shd101wyy.markdown-preview-enhanced";
const MPE_OPEN_PREVIEW_COMMAND = "markdown-preview-enhanced.openPreview";
const LAST_BROWSER_KEY = "algoSync.lastBrowser";
let extensionContextRef: vscode.ExtensionContext | undefined;
let statementPreviewQueue: Promise<void> = Promise.resolve();

export async function activate(extensionContext: vscode.ExtensionContext): Promise<void> {
  extensionContextRef = extensionContext;
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
      void showStatementPreview(activeTarget.statementUri, folder, config);
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
  extensionContextRef = undefined;
  activeTarget = undefined;
  for (const pending of pendingCliSubmissions.values()) clearTimeout(pending.timeout);
  pendingCliSubmissions.clear();
  for (const pending of pendingCliActions.values()) clearTimeout(pending.timeout);
  pendingCliActions.clear();
  browserConnections.clear();
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
    browserConnections.delete(socket);
    for (const [requestId, pending] of pendingCliActions) {
      if (pending.browserSocket === socket) void finishCliAction(requestId, false, "浏览器连接已断开");
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
    if (message.type === "cliRefresh") void handleCliRefresh(socket, message, folder);
    if (message.type === "cliFetch") void handleCliFetch(socket, message, folder);
    if (message.type === "cliBrowserRefresh") void handleCliBrowserRefresh(socket, message, folder);
    if (message.type === "cliRemote") void handleCliRemote(socket, message, folder);
    if (message.type === "cliSwitch") void handleCliSwitch(socket, message, folder);
  });
  socket.on("close", () => {
    for (const [requestId, pending] of pendingCliSubmissions) {
      if (pending.socket === socket) {
        clearTimeout(pending.timeout);
        pendingCliSubmissions.delete(requestId);
      }
    }
    for (const [requestId, pending] of pendingCliActions) {
      if (pending.socket === socket) {
        clearTimeout(pending.timeout);
        pendingCliActions.delete(requestId);
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

async function handleCliRefresh(
  socket: WebSocket,
  message: CliRefreshMessage,
  folder: vscode.WorkspaceFolder
): Promise<void> {
  const target = activeTarget;
  const targetError = validateCliTarget(target, message.cwd, folder);
  if (targetError || !target) {
    sendCliUpdate(socket, message.requestId, "error", targetError ?? "当前没有活动题目", target, false);
    return;
  }
  if (pendingCliSubmissions.size > 0 || pendingCliActions.size > 0) {
    sendCliUpdate(socket, message.requestId, "error", "已有命令正在等待浏览器响应，请稍后再试", target, false);
    return;
  }
  const code = resolveInitialTemplate(target.context.initialCode, target.context.site);
  if (code === undefined) {
    sendCliUpdate(
      socket,
      message.requestId,
      "error",
      "网页没有提供可信的官方初始模板；为避免把上次代码当成模板，本次没有执行恢复",
      target,
      false
    );
    return;
  }
  const document = await vscode.workspace.openTextDocument(target.fileUri);
  const rollbackCode = document.getText();
  const end = document.lineAt(document.lineCount - 1).range.end;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(target.fileUri, new vscode.Range(new vscode.Position(0, 0), end), code);
  const saveKey = normalizedPathKey(target.fileUri.fsPath);
  suppressedSavePaths.add(saveKey);
  if (!await vscode.workspace.applyEdit(edit) || !await document.save()) {
    suppressedSavePaths.delete(saveKey);
    sendCliUpdate(socket, message.requestId, "error", "无法写入或保存本地代码文件", target, false);
    return;
  }
  setTimeout(() => suppressedSavePaths.delete(saveKey), 1_000);
  startCliAction(message.requestId, socket, target.socket, target, rollbackCode);
  sendCliUpdate(socket, message.requestId, "preparing", `正在恢复 ${path.basename(target.fileUri.fsPath)}`, target);
  send(target.socket, {
    type: "resetCode",
    protocolVersion: PROTOCOL_VERSION,
    requestId: message.requestId,
    tabId: target.tabId,
    site: target.context.site,
    problemId: target.context.problemId,
    language: target.context.language,
    code
  });
}

async function handleCliFetch(socket: WebSocket, message: CliFetchMessage, folder: vscode.WorkspaceFolder): Promise<void> {
  if (!isSameOrInside(path.resolve(message.cwd), path.resolve(folder.uri.fsPath))) {
    sendCliUpdate(socket, message.requestId, "error", "请在当前 Algo Sync 工作空间内运行 acm fetch", undefined, false);
    return;
  }
  sendCliUpdate(socket, message.requestId, "preparing", `正在查找并打开 ${message.problemCode}`);
  const browserSocket = await ensureFetchBrowserSocket();
  if (!browserSocket) {
    sendCliUpdate(
      socket,
      message.requestId,
      "error",
      "无法启动或连接 Edge/Chrome；请确认浏览器已安装并加载 Algo Sync 扩展",
      undefined,
      false
    );
    return;
  }
  startCliAction(message.requestId, socket, browserSocket);
  send(browserSocket, {
    type: "navigateToProblem",
    protocolVersion: PROTOCOL_VERSION,
    requestId: message.requestId,
    problemCode: message.problemCode
  });
}

async function handleCliRemote(
  socket: WebSocket,
  message: CliRemoteMessage,
  folder: vscode.WorkspaceFolder
): Promise<void> {
  if (!isSameOrInside(path.resolve(message.cwd), path.resolve(folder.uri.fsPath))) {
    sendCliUpdate(socket, message.requestId, "error", "请在当前 Algo Sync 工作空间内运行 acm remote", undefined, false);
    return;
  }
  const browserSocket = selectBrowserSocket();
  if (!browserSocket) {
    sendCliUpdate(socket, message.requestId, "error", "当前没有已连接的浏览器扩展", undefined, false);
    return;
  }
  startCliAction(message.requestId, socket, browserSocket);
  send(browserSocket, {
    type: "listRemoteProblems",
    protocolVersion: PROTOCOL_VERSION,
    requestId: message.requestId
  });
}

async function handleCliSwitch(
  socket: WebSocket,
  message: CliSwitchMessage,
  folder: vscode.WorkspaceFolder
): Promise<void> {
  const target = activeTarget;
  const targetError = validateCliTarget(target, message.cwd, folder);
  if (targetError || !target) {
    sendCliUpdate(socket, message.requestId, "error", targetError ?? "当前没有活动题目", target, false);
    return;
  }
  if (pendingCliSubmissions.size > 0 || pendingCliActions.size > 0) {
    sendCliUpdate(socket, message.requestId, "error", "已有命令正在等待浏览器响应，请稍后再试", target, false);
    return;
  }
  if (!shouldDispatchLanguageSwitch(target.context.site, target.context.language, message.language)) {
    sendCliUpdate(socket, message.requestId, "completed", `当前题目已经是 ${message.language}`, target, true);
    return;
  }
  startCliAction(message.requestId, socket, target.socket, target, undefined, message.language);
  sendCliUpdate(socket, message.requestId, "preparing", `正在切换到 ${message.language}`, target);
  send(target.socket, {
    type: "switchLanguage",
    protocolVersion: PROTOCOL_VERSION,
    requestId: message.requestId,
    tabId: target.tabId,
    site: target.context.site,
    problemId: target.context.problemId,
    language: message.language
  });
}

async function ensureFetchBrowserSocket(): Promise<WebSocket | undefined> {
  const connected = selectBrowserSocket();
  if (connected) return connected;
  // A freshly activated workspace can race with an already running browser's
  // extension handshake. Give it a short chance before starting a process.
  const connecting = await waitForBrowserSocket(1_500);
  if (connecting) return connecting;
  if (process.platform !== "win32") return undefined;

  const preferred = extensionContextRef?.globalState.get<"edge" | "chrome">(LAST_BROWSER_KEY);
  // Wake exactly one preferred browser. Trying both Edge and Chrome creates two
  // unrelated windows when neither profile has loaded the extension yet.
  const wakePlan = planBrowserWake(browserExecutables(preferred));
  if (!wakePlan || !await launchBrowserExecutable(wakePlan)) return undefined;
  return waitForBrowserSocket(15_000);
}

async function waitForBrowserSocket(timeoutMs: number): Promise<WebSocket | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const socket = selectBrowserSocket();
    if (socket) return socket;
  }
  return undefined;
}

async function launchBrowserExecutable(plan: BrowserWakePlan): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    // Chromium's no-startup-window mode starts the browser for background apps
    // without opening or focusing a window. Once connected, the extension
    // creates a minimized window only if no browser window already exists.
    const child = spawn(plan.executable, plan.arguments, {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
    child.once("error", () => resolve(false));
  });
}

function browserExecutables(preferred?: "edge" | "chrome"): string[] {
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  const localAppData = process.env.LOCALAPPDATA;
  const candidates: Record<"edge" | "chrome", string[]> = {
    edge: [
      programFilesX86 && path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      programFiles && path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      localAppData && path.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe")
    ].filter((value): value is string => Boolean(value)),
    chrome: [
      programFiles && path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      programFilesX86 && path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      localAppData && path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe")
    ].filter((value): value is string => Boolean(value))
  };
  const selected = preferred ?? defaultWindowsBrowser();
  const order: Array<"edge" | "chrome"> = selected
    ? [selected, selected === "edge" ? "chrome" : "edge"]
    : ["edge", "chrome"];
  return order.flatMap((browser) => {
    const executable = candidates[browser].find((candidate) => existsSync(candidate));
    return executable ? [executable] : [];
  });
}

function defaultWindowsBrowser(): "edge" | "chrome" | undefined {
  try {
    const output = execFileSync("reg.exe", [
      "query",
      "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice",
      "/v",
      "ProgId"
    ], { encoding: "utf8", windowsHide: true });
    const progId = output.match(/ProgId\s+REG_SZ\s+(\S+)/i)?.[1] ?? "";
    if (/chrome/i.test(progId)) return "chrome";
    if (/edge/i.test(progId)) return "edge";
  } catch {
    // Fall through to the installed-browser order.
  }
  return undefined;
}

async function handleCliBrowserRefresh(
  socket: WebSocket,
  message: CliBrowserRefreshMessage,
  folder: vscode.WorkspaceFolder
): Promise<void> {
  if (!isSameOrInside(path.resolve(message.cwd), path.resolve(folder.uri.fsPath))) {
    sendCliUpdate(socket, message.requestId, "error", `请在当前工作空间内运行 ${message.browser} refresh`, undefined, false);
    return;
  }
  const browserSocket = selectBrowserSocket(message.browser);
  if (!browserSocket) {
    sendCliUpdate(socket, message.requestId, "error", `没有已连接的 ${message.browser} 浏览器扩展`, undefined, false);
    return;
  }
  startCliAction(message.requestId, socket, browserSocket);
  sendCliUpdate(socket, message.requestId, "preparing", `正在刷新 ${message.browser} 当前页面`);
  send(browserSocket, { type: "reloadPage", protocolVersion: PROTOCOL_VERSION, requestId: message.requestId });
}

function validateCliTarget(
  target: ActiveTarget | undefined,
  cwdValue: string,
  folder: vscode.WorkspaceFolder
): string | undefined {
  if (!target || target.socket.readyState !== WebSocket.OPEN) return "当前没有已连接的活动题目网页";
  const workspacePath = path.resolve(folder.uri.fsPath);
  const cwd = path.resolve(cwdValue);
  const targetDirectory = path.dirname(path.resolve(target.fileUri.fsPath));
  if (!isSameOrInside(cwd, workspacePath)) return "请在当前 Algo Sync 工作空间内运行该命令";
  if (!isSameOrInside(target.fileUri.fsPath, cwd) && !isSameOrInside(cwd, targetDirectory)) {
    return "终端目录与浏览器当前题目不匹配";
  }
  return undefined;
}

function selectBrowserSocket(browser?: "edge" | "chrome"): WebSocket | undefined {
  const matches = Array.from(browserConnections.entries())
    .filter(([socket, connection]) => socket.readyState === WebSocket.OPEN && (!browser || browserMatches(connection.userAgent, browser)))
    .sort((left, right) => right[1].connectedAt - left[1].connectedAt);
  if (!browser && activeTarget?.socket.readyState === WebSocket.OPEN) return activeTarget.socket;
  return matches[0]?.[0];
}

function browserMatches(userAgent: string, browser: "edge" | "chrome"): boolean {
  return browser === "edge" ? /\bEdg\//i.test(userAgent) : /\bChrome\//i.test(userAgent) && !/\bEdg\//i.test(userAgent);
}

function startCliAction(
  requestId: string,
  cliSocket: WebSocket,
  browserSocket: WebSocket,
  target?: ActiveTarget,
  rollbackCode?: string,
  resultLanguage?: Language
): void {
  const timeout = setTimeout(() => void finishCliAction(requestId, false, "等待浏览器响应超时"), 20_000);
  pendingCliActions.set(requestId, { socket: cliSocket, browserSocket, timeout, target, rollbackCode, resultLanguage });
}

async function finishCliAction(requestId: string, ok: boolean, message: string): Promise<void> {
  const pending = pendingCliActions.get(requestId);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingCliActions.delete(requestId);
  if (!ok && pending.target && pending.rollbackCode !== undefined) {
    try {
      const document = await vscode.workspace.openTextDocument(pending.target.fileUri);
      const end = document.lineAt(document.lineCount - 1).range.end;
      const edit = new vscode.WorkspaceEdit();
      edit.replace(pending.target.fileUri, new vscode.Range(new vscode.Position(0, 0), end), pending.rollbackCode);
      const saveKey = normalizedPathKey(pending.target.fileUri.fsPath);
      suppressedSavePaths.add(saveKey);
      if (!await vscode.workspace.applyEdit(edit) || !await document.save()) {
        suppressedSavePaths.delete(saveKey);
        message = `${message}；本地代码回滚失败`;
      } else {
        setTimeout(() => suppressedSavePaths.delete(saveKey), 1_000);
      }
    } catch (error) {
      message = `${message}；本地代码回滚失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }
  const resultTarget = pending.target && pending.resultLanguage
    ? { ...pending.target, context: { ...pending.target.context, language: pending.resultLanguage } }
    : pending.target;
  sendCliUpdate(
    pending.socket,
    requestId,
    ok ? "completed" : "error",
    message,
    resultTarget,
    ok
  );
}

async function handleBrowserMessage(
  socket: WebSocket,
  message: BrowserToWorkspaceMessage,
  folder: vscode.WorkspaceFolder,
  config: WorkspaceConfig
): Promise<void> {
  if (message.type === "hello") {
    browserConnections.set(socket, { userAgent: message.browser, connectedAt: Date.now() });
    const family = /\bEdg\//i.test(message.browser) ? "edge"
      : /\bChrome\//i.test(message.browser) ? "chrome"
        : undefined;
    if (family) void extensionContextRef?.globalState.update(LAST_BROWSER_KEY, family);
    log(`浏览器握手成功：${message.extensionVersion}`);
    send(socket, {
      type: "ready",
      protocolVersion: PROTOCOL_VERSION,
      workspaceName: folder.name,
      defaultLanguage: config.defaultLanguage
    });
    return;
  }
  if (message.type === "browserActionResult") {
    void finishCliAction(message.requestId, message.ok, message.message);
    return;
  }
  if (message.type === "remoteProblemsResult") {
    const pending = pendingCliActions.get(message.requestId);
    if (!pending || pending.browserSocket !== socket) return;
    if (message.problems.length === 0) {
      void finishCliAction(message.requestId, false, "当前浏览器中没有已识别的远程题目");
      return;
    }
    void finishCliAction(
      message.requestId,
      true,
      formatRemoteProblems(message.problems, browserDisplayName(browserConnections.get(socket)?.userAgent))
    );
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
    sendCliUpdate(
      pending.socket,
      message.requestId,
      message.phase,
      message.status,
      target,
      message.success,
      message.allAccepted,
      message.testPoints
    );
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
  const previousFileUri = activeTarget?.fileUri;
  const siteDirectory = vscode.Uri.joinPath(folder.uri, config.solutionRoot, config.siteDirectories[context.site]);
  await vscode.workspace.fs.createDirectory(siteDirectory);
  const problemDirectory = await findOrCreateProblemDirectory(siteDirectory, context);
  const fileUri = await findOrCreateFile(problemDirectory, context);
  const statementUri = vscode.Uri.joinPath(problemDirectory, STATEMENT_FILENAME);
  const initialUri = await ensureInitialTemplate(folder, context, fileUri.created);
  await updateStatementFile(statementUri, context);
  activeTarget = {
    key: problemKey(context),
    tabId: message.tabId,
    context,
    fileUri: fileUri.uri,
    statementUri,
    initialUri,
    socket
  };
  log(`活动目标：${context.site}/${context.problemId}/${context.language} -> ${fileUri.uri.fsPath}`);
  const document = await vscode.workspace.openTextDocument(fileUri.uri);
  if (config.statementPreview) await showStatementPreview(statementUri, folder, config);
  await showSolutionDocument(document, config.statementPreview, previousFileUri);
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

async function showSolutionDocument(
  document: vscode.TextDocument,
  statementPreview: boolean,
  previousFileUri?: vscode.Uri
): Promise<void> {
  const matchingTabs = textTabsFor(document.uri);
  // Column one belongs exclusively to the statement and its preview. Never
  // reuse a solution tab that was manually dragged there or left there by an
  // older release.
  const keep = matchingTabs.find(({ group }) => group.viewColumn !== vscode.ViewColumn.One);
  const previous = previousFileUri
    ? textTabsFor(previousFileUri).find(({ group }) => group.viewColumn !== vscode.ViewColumn.One)
    : undefined;
  const targetColumn = keep?.group.viewColumn ?? previous?.group.viewColumn ??
    (statementPreview ? vscode.ViewColumn.Two : undefined);
  await vscode.window.showTextDocument(document, {
    preview: false,
    preserveFocus: false,
    viewColumn: targetColumn
  });

  // Opening the shared document in the target group preserves an unsaved
  // buffer. It is now safe to remove stale copies, including one in column one.
  const openedTabs = textTabsFor(document.uri);
  const retained = openedTabs.find(({ group }) => group.viewColumn === targetColumn) ?? openedTabs[0];
  const duplicates = openedTabs.filter(({ tab }) => tab !== retained?.tab).map(({ tab }) => tab);
  if (duplicates.length > 0) await vscode.window.tabGroups.close(duplicates, true);
}

function textTabsFor(uri: vscode.Uri): Array<{ group: vscode.TabGroup; tab: vscode.Tab }> {
  const key = uri.toString();
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs
      .filter((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === key)
      .map((tab) => ({ group, tab })))
    .sort((left, right) => left.group.viewColumn - right.group.viewColumn);
}

function showStatementPreview(
  statementUri: vscode.Uri,
  folder: vscode.WorkspaceFolder,
  config: WorkspaceConfig
): Promise<void> {
  const operation = statementPreviewQueue.then(() => showStatementPreviewNow(statementUri, folder, config));
  statementPreviewQueue = operation.catch(() => undefined);
  return operation;
}

async function showStatementPreviewNow(
  statementUri: vscode.Uri,
  folder: vscode.WorkspaceFolder,
  config: WorkspaceConfig
): Promise<void> {
  await closeStatementGroupTabs(statementUri, folder, config);
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

async function closeStatementGroupTabs(
  currentStatementUri: vscode.Uri,
  _folder: vscode.WorkspaceFolder,
  _config: WorkspaceConfig
): Promise<void> {
  const leftGroup = vscode.window.tabGroups.all.find((group) => group.viewColumn === vscode.ViewColumn.One);
  if (!leftGroup) return;
  const tabsToClose: vscode.Tab[] = [];
  let keptCurrentStatement = false;
  for (const tab of leftGroup.tabs) {
    if (tab.input instanceof vscode.TabInputWebview &&
      isStatementPreviewTab(tab.input.viewType, tab.label)) {
      tabsToClose.push(tab);
      continue;
    }
    if (!(tab.input instanceof vscode.TabInputText)) continue;
    const uri = tab.input.uri;
    if (uri.toString() === currentStatementUri.toString() && !keptCurrentStatement) {
      keptCurrentStatement = true;
      continue;
    }
    // Clean files can simply be closed. Dirty files are first opened in the
    // solution group so the same TextDocument (and every unsaved edit) stays
    // alive when its stale left-side tab is removed.
    if (tab.isDirty) {
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document, {
        preview: false,
        preserveFocus: true,
        viewColumn: vscode.ViewColumn.Two
      });
    }
    tabsToClose.push(tab);
  }
  if (tabsToClose.length > 0) await vscode.window.tabGroups.close(tabsToClose, true);
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

async function ensureInitialTemplate(
  folder: vscode.WorkspaceFolder,
  context: ProblemContext,
  solutionCreated: boolean
): Promise<vscode.Uri> {
  const directory = vscode.Uri.joinPath(
    folder.uri,
    ".algo-sync-cache",
    "templates",
    context.site,
    sanitizePathPart(context.problemId, "problem", 100)
  );
  const uri = vscode.Uri.joinPath(directory, `${context.language}.txt`);
  let existing: string | undefined;
  try {
    existing = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    // The template may be created below.
  }
  const initialCode = resolveInitialTemplate(
    context.initialCode,
    context.site
  );
  if (initialCode !== undefined && initialCode !== existing) {
    await vscode.workspace.fs.createDirectory(directory);
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(initialCode));
    log(`已更新初始代码模板：${context.site}/${context.problemId}/${context.language}`);
  }
  return uri;
}

async function handleSavedDocument(document: vscode.TextDocument): Promise<void> {
  const saveKey = normalizedPathKey(document.uri.fsPath);
  if (suppressedSavePaths.delete(saveKey)) {
    log(`保存未同步（由 acm refresh 管理）：${document.uri.fsPath}`);
    return;
  }
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
  success?: boolean,
  allAccepted?: boolean,
  testPoints?: TestPointResult[]
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
    success,
    allAccepted,
    testPoints
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

function normalizedPathKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function browserDisplayName(userAgent?: string): string {
  return userAgent && /\bEdg\//i.test(userAgent) ? "Edge"
    : userAgent && /\bChrome\//i.test(userAgent) ? "Chrome"
      : "浏览器";
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
