import {
  DEFAULT_PORT,
  PROTOCOL_VERSION,
  isLanguage,
  isSite,
  problemKey,
  type ProblemContext,
  type Site,
  type WorkspaceToBrowserMessage
} from "@algo-sync/shared";
import { mainBridgeBootstrap } from "./main-bridge";

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
    const token = crypto.randomUUID();
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: "MAIN",
      func: mainBridgeBootstrap,
      args: [token]
    }).then(() => sendResponse({ ok: true, token, enabled: workspaceReady, defaultLanguage }),
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
    sendSocket({
      type: "submissionUpdate",
      protocolVersion: PROTOCOL_VERSION,
      requestId: message.requestId,
      tabId: sender.tab.id,
      phase: message.phase,
      status: message.status,
      success: message.success
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
    const state = tabs.get(message.tabId);
    if (!state || state.fingerprint !== problemKey(message)) {
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
    void chrome.tabs.sendMessage(message.tabId, { ...message, type: "submitCode" }).catch((error) => {
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
    });
    return;
  }
  if (message.type === "error") setBadge("!", "#cf222e", message.message);
}

function announceActiveContext(): void {
  if (activeTabId === undefined || socket?.readyState !== WebSocket.OPEN) return;
  const state = tabs.get(activeTabId);
  if (!state) return;
  const fingerprint = `${activeTabId}:${state.announcementKey}`;
  if (fingerprint === lastSentFingerprint) return;
  lastSentFingerprint = fingerprint;
  console.info(`[Algo Sync] 活动题目：${state.fingerprint}（标签 ${activeTabId}）`);
  sendSocket({
    type: "activeEditorChanged",
    protocolVersion: PROTOCOL_VERSION,
    tabId: activeTabId,
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
