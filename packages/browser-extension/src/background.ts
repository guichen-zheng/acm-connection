import {
  DEFAULT_PORT,
  PROTOCOL_VERSION,
  isLanguage,
  isSite,
  problemKey,
  type ProblemContext,
  type ResetCodeMessage,
  type Site,
  type SubmitCodeMessage,
  type WorkspaceToBrowserMessage
} from "@algo-sync/shared";
import { mainBridgeBootstrap } from "./main-bridge";
import {
  isMarkedFetchTabUrl,
  isPotentialProblemUrl,
  markFetchTabUrl,
  problemCodeMatchesContext,
  resolveProblemUrl
} from "./navigation";

interface TabState {
  context: ProblemContext;
  fingerprint: string;
  announcementKey: string;
}

interface PendingBrowserSubmission {
  requestId: string;
  site: Site;
}

const tabs = new Map<number, TabState>();
const pendingSubmissions = new Map<number, PendingBrowserSubmission>();
let activeTabId: number | undefined;
let socket: WebSocket | undefined;
let connectedPort: number | undefined;
let nextPortOffset = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let lastSentFingerprint = "";
let workspaceReady = false;
let defaultLanguage: ProblemContext["language"] = "cpp";
const FETCH_TAB_ID_KEY = "algoSyncFetchTabId";

chrome.runtime.onInstalled.addListener(() => {
  void chrome.alarms.create("algo-sync-reconnect", { periodInMinutes: 0.5 });
  ensureConnection();
});
chrome.runtime.onStartup.addListener(ensureConnection);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "algo-sync-reconnect") ensureConnection();
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "bridge:init" && sender.tab?.id !== undefined) {
    const pendingSubmission = pendingSubmissions.get(sender.tab.id);
    const token = crypto.randomUUID();
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: "MAIN",
      func: mainBridgeBootstrap,
      args: [token]
    }).then(() => sendResponse({ ok: true, token, enabled: workspaceReady, defaultLanguage, pendingSubmission }),
      (error) => sendResponse({ ok: false, message: String(error) }));
    return true;
  }
  if (message?.type === "contextDetected" && sender.tab?.id !== undefined && isProblemContextLike(message.context)) {
    const tabId = sender.tab.id;
    const context = message.context as ProblemContext;
    tabs.set(tabId, {
      context,
      fingerprint: problemKey(context),
      announcementKey: `${problemKey(context)}:${hashText(context.statementMarkdown ?? "")}`
    });
    if (sender.tab.active) {
      activeTabId = tabId;
      announceActiveContext();
    }
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "applyResult" && sender.tab?.id !== undefined) {
    sendSocket({
      type: "applyResult",
      protocolVersion: PROTOCOL_VERSION,
      tabId: sender.tab.id,
      ok: message.ok === true,
      message: typeof message.message === "string" ? message.message : undefined
    });
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "submissionUpdate" && sender.tab?.id !== undefined &&
    typeof message.requestId === "string" && pendingSubmissions.get(sender.tab.id)?.requestId === message.requestId) {
    if (message.phase === "attention") void focusCaptchaTab(sender.tab.id, sender.tab.windowId);
    sendSocket({
      type: "submissionUpdate",
      protocolVersion: PROTOCOL_VERSION,
      requestId: message.requestId,
      tabId: sender.tab.id,
      phase: message.phase,
      status: message.status,
      success: message.success,
      allAccepted: message.allAccepted,
      testPoints: message.testPoints
    });
    if (message.phase === "finished" || message.phase === "error") pendingSubmissions.delete(sender.tab.id);
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  activeTabId = tabId;
  lastSentFingerprint = "";
  void chrome.tabs.sendMessage(tabId, { type: "requestContext" }).catch(() => undefined);
  announceActiveContext();
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading") tabs.delete(tabId);
  if (changeInfo.status === "complete" && tab.active) {
    activeTabId = tabId;
    lastSentFingerprint = "";
    void chrome.tabs.sendMessage(tabId, { type: "requestContext" }).catch(() => undefined);
  }
  if (changeInfo.status === "complete") {
    const pending = pendingSubmissions.get(tabId);
    if (pending) void chrome.tabs.sendMessage(tabId, {
      type: "resumeSubmission",
      requestId: pending.requestId,
      site: pending.site
    }).catch(() => undefined);
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.get(FETCH_TAB_ID_KEY).then((stored) => {
    if (stored[FETCH_TAB_ID_KEY] === tabId) return chrome.storage.session.remove(FETCH_TAB_ID_KEY);
    return undefined;
  });
  tabs.delete(tabId);
  const pending = pendingSubmissions.get(tabId);
  if (pending) {
    sendSocket({
      type: "submissionUpdate",
      protocolVersion: PROTOCOL_VERSION,
      requestId: pending.requestId,
      tabId,
      phase: "error",
      status: "评测完成前浏览器标签页已关闭",
      success: false
    });
    pendingSubmissions.delete(tabId);
  }
  if (activeTabId === tabId) {
    activeTabId = undefined;
    lastSentFingerprint = "";
  }
});
chrome.windows.onFocusChanged.addListener(() => void refreshActiveTab());

ensureConnection();

function ensureConnection(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  const port = DEFAULT_PORT + nextPortOffset;
  nextPortOffset = (nextPortOffset + 1) % 10;
  const candidate = new WebSocket(`ws://127.0.0.1:${port}`);
  socket = candidate;
  candidate.addEventListener("open", () => {
    connectedPort = port;
    nextPortOffset = 0;
    lastSentFingerprint = "";
    setBadge("ON", "#238636", `已连接 VS Code（端口 ${port}）`);
    sendSocket({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      extensionVersion: chrome.runtime.getManifest().version,
      browser: navigator.userAgent
    });
  });
  candidate.addEventListener("message", (event) => handleWorkspaceMessage(event.data));
  candidate.addEventListener("close", () => {
    if (socket === candidate) socket = undefined;
    connectedPort = undefined;
    workspaceReady = false;
    broadcastWorkspaceState(false);
    setBadge("--", "#6e7781", "未检测到启用 Algo Sync 的 VS Code 工作区");
    reconnectTimer = setTimeout(ensureConnection, nextPortOffset === 0 ? 3_000 : 250);
  });
  candidate.addEventListener("error", () => candidate.close());
}

function handleWorkspaceMessage(raw: unknown): void {
  let message: WorkspaceToBrowserMessage | undefined;
  try {
    message = JSON.parse(String(raw)) as WorkspaceToBrowserMessage;
  } catch {
    return;
  }
  if (!message || message.protocolVersion !== PROTOCOL_VERSION) return;
  if (message.type === "ready") {
    if (isLanguage(message.defaultLanguage)) defaultLanguage = message.defaultLanguage;
    workspaceReady = true;
    console.info(`[Algo Sync] 已连接工作空间：${message.workspaceName}`);
    broadcastWorkspaceState(true);
    void refreshActiveTab();
    return;
  }
  if (message.type === "ping") {
    sendSocket({ type: "pong", protocolVersion: PROTOCOL_VERSION });
    return;
  }
  if (message.type === "savedCode") {
    const state = tabs.get(message.tabId);
    if (!state || state.fingerprint !== problemKey(message)) {
      console.warn("[Algo Sync] 保存目标已变化", { message, state });
      sendSocket({
        type: "applyResult",
        protocolVersion: PROTOCOL_VERSION,
        tabId: message.tabId,
        ok: false,
        message: "活动网页题目或语言已经改变"
      });
      return;
    }
    console.info(`[Algo Sync] 正在写入标签 ${message.tabId}：${message.site}/${message.problemId}/${message.language}`);
    void chrome.tabs.sendMessage(message.tabId, { ...message, type: "applyCode" }).catch((error) => {
      sendSocket({
        type: "applyResult",
        protocolVersion: PROTOCOL_VERSION,
        tabId: message.tabId,
        ok: false,
        message: String(error)
      });
    });
    return;
  }
  if (message.type === "submitCode") {
    void beginSubmission(message);
    return;
  }
  if (message.type === "resetCode") {
    void resetCode(message);
    return;
  }
  if (message.type === "navigateToProblem") {
    void navigateToProblem(message.requestId, message.problemCode);
    return;
  }
  if (message.type === "reloadPage") {
    void reloadCurrentPage(message.requestId);
    return;
  }
  if (message.type === "listRemoteProblems") {
    void sendRemoteProblems(message.requestId);
    return;
  }
  if (message.type === "switchLanguage") {
    void switchRemoteLanguage(message);
    return;
  }
  if (message.type === "error") setBadge("!", "#cf222e", message.message);
}

async function beginSubmission(message: SubmitCodeMessage): Promise<void> {
  if (!await ensureMatchingContext(message)) {
    sendSocket({
      type: "submissionUpdate",
      protocolVersion: PROTOCOL_VERSION,
      requestId: message.requestId,
      tabId: message.tabId,
      phase: "error",
      status: "活动网页题目或语言已经改变",
      success: false
    });
    return;
  }
  const previous = pendingSubmissions.get(message.tabId);
  if (previous && previous.requestId !== message.requestId) {
    sendSocket({
      type: "submissionUpdate",
      protocolVersion: PROTOCOL_VERSION,
      requestId: message.requestId,
      tabId: message.tabId,
      phase: "error",
      status: "当前标签页已有一个提交正在等待评测",
      success: false
    });
    return;
  }
  pendingSubmissions.set(message.tabId, { requestId: message.requestId, site: message.site });
  try {
    await chrome.tabs.sendMessage(message.tabId, { ...message, type: "submitCode" });
  } catch (error) {
    pendingSubmissions.delete(message.tabId);
    sendSocket({
      type: "submissionUpdate",
      protocolVersion: PROTOCOL_VERSION,
      requestId: message.requestId,
      tabId: message.tabId,
      phase: "error",
      status: String(error),
      success: false
    });
  }
}

async function resetCode(message: ResetCodeMessage): Promise<void> {
  if (!await ensureMatchingContext(message)) {
    sendBrowserActionResult(message.requestId, false, "活动网页题目或语言已经改变");
    return;
  }
  try {
    const result = await chrome.tabs.sendMessage(message.tabId, { ...message, type: "applyCode" }) as
      { ok?: boolean; message?: string } | undefined;
    sendBrowserActionResult(
      message.requestId,
      result?.ok === true,
      result?.ok === true ? "初始代码已同步到本地和网页" : result?.message ?? "网页代码恢复失败"
    );
  } catch (error) {
    sendBrowserActionResult(message.requestId, false, String(error));
  }
}

async function ensureMatchingContext(
  message: Pick<SubmitCodeMessage, "tabId" | "site" | "problemId" | "language">
): Promise<boolean> {
  const expected = problemKey(message);
  if (tabs.get(message.tabId)?.fingerprint === expected) return true;
  try {
    await chrome.tabs.sendMessage(message.tabId, { type: "requestContext" });
  } catch {
    return false;
  }
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (tabs.get(message.tabId)?.fingerprint === expected) return true;
  }
  return false;
}

async function navigateToProblem(requestId: string, problemCode: string): Promise<void> {
  try {
    const url = await resolveProblemUrl(problemCode);
    if (!url) {
      sendBrowserActionResult(requestId, false, `未找到或不支持题号 ${problemCode}`);
      return;
    }
    const markedUrl = markFetchTabUrl(url);
    const existing = await findFetchTab();
    let tabId: number;
    let resultPrefix: string;
    if (existing?.id !== undefined) {
      await chrome.tabs.update(existing.id, { url: markedUrl, active: true });
      tabId = existing.id;
      resultPrefix = "已在专用后台标签页打开并连接";
    } else {
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      let created: chrome.tabs.Tab | undefined;
      if (activeTab?.windowId !== undefined) {
        created = await chrome.tabs.create({ windowId: activeTab.windowId, url: markedUrl, active: true });
      } else {
        const createdWindow = await chrome.windows.create({ url: markedUrl, focused: false, state: "minimized" });
        created = createdWindow?.tabs?.[0];
      }
      if (created?.id === undefined) throw new Error("浏览器没有返回新建专用标签页的信息");
      tabId = created.id;
      resultPrefix = "已新建专用后台标签页并连接";
    }
    await chrome.storage.session.set({ [FETCH_TAB_ID_KEY]: tabId });
    const detected = await waitForFetchedProblem(tabId, problemCode);
    if (!detected) {
      sendBrowserActionResult(
        requestId,
        false,
        `页面已经打开，但浏览器扩展未能识别 ${problemCode}；请刷新该题目页后重试`
      );
      return;
    }
    sendBrowserActionResult(requestId, true, `${resultPrefix} ${problemCode}`);
  } catch (error) {
    sendBrowserActionResult(requestId, false, error instanceof Error ? error.message : String(error));
  }
}

async function waitForFetchedProblem(tabId: number, problemCode: string, timeoutMilliseconds = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMilliseconds;
  let requestedContext = false;
  while (Date.now() < deadline) {
    const state = tabs.get(tabId);
    if (state && problemCodeMatchesContext(problemCode, state.context.site, state.context.problemId)) return true;
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete" && !requestedContext) {
        requestedContext = true;
        await requestTabContext(tabId, true);
      }
    } catch {
      return false;
    }
    await delay(100);
  }
  return false;
}

async function findFetchTab(): Promise<chrome.tabs.Tab | undefined> {
  const stored = await chrome.storage.session.get(FETCH_TAB_ID_KEY);
  const tabId = stored[FETCH_TAB_ID_KEY];
  if (typeof tabId === "number") {
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      await chrome.storage.session.remove(FETCH_TAB_ID_KEY);
    }
  }
  return (await chrome.tabs.query({})).find((tab) => isMarkedFetchTabUrl(tab.url));
}

async function reloadCurrentPage(requestId: string): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id === undefined) {
      sendBrowserActionResult(requestId, false, "没有可刷新的活动浏览器标签页");
      return;
    }
    await chrome.tabs.reload(tab.id);
    sendBrowserActionResult(requestId, true, "当前浏览器页面已刷新");
  } catch (error) {
    sendBrowserActionResult(requestId, false, error instanceof Error ? error.message : String(error));
  }
}

async function sendRemoteProblems(requestId: string): Promise<void> {
  await refreshRemoteProblemContexts();
  const problems = Array.from(tabs.entries())
    .map(([tabId, state]) => ({
      tabId,
      active: tabId === activeTabId,
      site: state.context.site,
      problemId: state.context.problemId,
      title: state.context.title,
      language: state.context.language,
      url: state.context.url
    }))
    .sort((left, right) => Number(right.active) - Number(left.active) ||
      left.site.localeCompare(right.site) || left.problemId.localeCompare(right.problemId, undefined, { numeric: true }));
  sendSocket({
    type: "remoteProblemsResult",
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    problems
  });
}

async function refreshRemoteProblemContexts(): Promise<void> {
  const candidates = (await chrome.tabs.query({ url: [
    "https://www.luogu.com.cn/problem/*",
    "https://ac.nowcoder.com/acm/problem/*",
    "https://www.nowcoder.com/practice/*",
    "https://leetcode.cn/problems/*",
    "http://ybt.ssoier.cn:8088/*",
    "https://ybt.ssoier.cn/*"
  ] })).filter((tab) => tab.id !== undefined && tab.status === "complete" && isPotentialProblemUrl(tab.url));
  const candidateIds = candidates.map((tab) => tab.id!);
  await Promise.all(candidateIds.map((tabId) => requestTabContext(tabId, true)));
  if (candidateIds.length === 0) return;
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline && !candidateIds.every((tabId) => tabs.has(tabId))) {
    await delay(100);
  }
}

async function requestTabContext(tabId: number, injectWhenMissing: boolean): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "requestContext" });
  } catch {
    if (!injectWhenMissing) return;
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    } catch {
      // The tab may have navigated or become restricted while it was queried.
    }
  }
}

async function switchRemoteLanguage(message: Extract<WorkspaceToBrowserMessage, { type: "switchLanguage" }>): Promise<void> {
  const state = tabs.get(message.tabId);
  if (!state || state.context.site !== message.site || state.context.problemId !== message.problemId) {
    sendBrowserActionResult(message.requestId, false, "活动网页题目已经改变");
    return;
  }
  try {
    const result = await chrome.tabs.sendMessage(message.tabId, {
      type: "switchLanguage",
      site: message.site,
      problemId: message.problemId,
      language: message.language
    }) as { ok?: boolean; message?: string } | undefined;
    if (result?.ok === true) {
      lastSentFingerprint = "";
      announceTabContext(message.tabId);
    }
    sendBrowserActionResult(
      message.requestId,
      result?.ok === true,
      `${result?.message ?? (result?.ok === true ? `已切换到 ${message.language}` : "网页语言切换失败")}` +
        (result?.ok === true ? "" : `（浏览器扩展 ${chrome.runtime.getManifest().version}）`)
    );
  } catch (error) {
    sendBrowserActionResult(message.requestId, false, error instanceof Error ? error.message : String(error));
  }
}

function sendBrowserActionResult(requestId: string, ok: boolean, message: string): void {
  sendSocket({ type: "browserActionResult", protocolVersion: PROTOCOL_VERSION, requestId, ok, message });
}

function announceActiveContext(): void {
  if (activeTabId === undefined) return;
  announceTabContext(activeTabId);
}

function announceTabContext(tabId: number): void {
  if (socket?.readyState !== WebSocket.OPEN) return;
  const state = tabs.get(tabId);
  if (!state) return;
  const fingerprint = `${tabId}:${state.announcementKey}`;
  if (fingerprint === lastSentFingerprint) return;
  lastSentFingerprint = fingerprint;
  console.info(`[Algo Sync] 活动题目：${state.fingerprint}（标签 ${tabId}）`);
  sendSocket({
    type: "activeEditorChanged",
    protocolVersion: PROTOCOL_VERSION,
    tabId,
    context: state.context
  });
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function refreshActiveTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined) return;
  activeTabId = tab.id;
  lastSentFingerprint = "";
  await chrome.tabs.sendMessage(tab.id, { type: "requestContext" }).catch(() => undefined);
  announceActiveContext();
}

function sendSocket(message: Record<string, unknown>): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function setBadge(text: string, color: string, title: string): void {
  void chrome.action.setBadgeText({ text });
  void chrome.action.setBadgeBackgroundColor({ color });
  void chrome.action.setTitle({ title: `Algo Sync：${title}` });
}

function broadcastWorkspaceState(enabled: boolean): void {
  void chrome.tabs.query({}).then((allTabs) => Promise.all(allTabs
    .filter((tab) => tab.id !== undefined)
    .map((tab) => chrome.tabs.sendMessage(tab.id!, {
      type: "workspaceState",
      enabled,
      language: defaultLanguage
    }).catch(() => undefined))));
}

async function focusCaptchaTab(tabId: number, windowId: number): Promise<void> {
  try {
    await chrome.tabs.update(tabId, { active: true });
    const browserWindow = await chrome.windows.get(windowId);
    await chrome.windows.update(windowId, {
      focused: true,
      ...(browserWindow.state === "minimized" ? { state: "normal" as const } : {})
    });
  } catch (error) {
    console.warn("[Algo Sync] 无法自动前置验证码标签页", error);
  }
}

function isProblemContextLike(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const context = value as Record<string, unknown>;
  return isSite(context.site) && typeof context.problemId === "string" && context.problemId.length > 0 &&
    typeof context.title === "string" && typeof context.url === "string" && isLanguage(context.language) &&
    typeof context.code === "string" && context.code.length <= 2_000_000 &&
    (context.statementMarkdown === undefined ||
      (typeof context.statementMarkdown === "string" && context.statementMarkdown.length <= 1_000_000));
}

setInterval(() => {
  if (socket?.readyState === WebSocket.OPEN) {
    sendSocket({ type: "ping", protocolVersion: PROTOCOL_VERSION, port: connectedPort });
  }
}, 20_000);
