import {
  PROTOCOL_VERSION,
  problemKey,
  type Language,
  type ProblemContext,
  type Site,
  type SubmissionPhase
} from "@algo-sync/shared";
import {
  canCreateWithoutReadableEditor,
  detectLanguage,
  detectProblem,
  isEditorDomPresent,
  languageWithSiteFallback,
  normalizeLanguage,
  switchLanguage
} from "./adapters";
import { extractStatementMarkdown } from "./statement";
import {
  findConfirmationControl,
  findSubmitControl,
  readSubmissionStatus,
  type SubmissionStatus
} from "./submission";

interface BridgeResponse {
  ok: boolean;
  code?: string;
  editor?: string;
  language?: string;
  message?: string;
}

let bridgeToken: string | undefined;
let lastPageKey = "";
let lastReportedKey = "";
let didInitialLanguageCheck = false;
let scanTimer: number | undefined;
let workspaceEnabled = false;
let defaultLanguage: Language = "cpp";
let lastDiagnostic = "";
const submissionWatchers = new Set<string>();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "requestContext") {
    lastReportedKey = "";
    void scan();
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "workspaceState") {
    workspaceEnabled = message.enabled === true;
    if (message.language) defaultLanguage = message.language as Language;
    if (workspaceEnabled) {
      lastReportedKey = "";
      void scan();
    }
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === "applyCode") {
    void applyCode(message).then(sendResponse);
    return true;
  }
  if (message?.type === "submitCode") {
    sendResponse({ ok: true });
    void submitCode(message);
    return false;
  }
  if (message?.type === "resumeSubmission" && typeof message.requestId === "string" &&
    (message.site === "luogu" || message.site === "nowcoder" || message.site === "leetcode" || message.site === "ybt")) {
    sendResponse({ ok: true });
    void watchSubmission(message.requestId, message.site);
    return false;
  }
  return false;
});

void initialize();

async function initialize(): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: "bridge:init" }) as {
    ok?: boolean;
    token?: string;
    enabled?: boolean;
    defaultLanguage?: Language;
  };
  if (!response?.ok || !response.token) return;
  bridgeToken = response.token;
  workspaceEnabled = response.enabled === true;
  if (response.defaultLanguage) defaultLanguage = response.defaultLanguage;
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  window.addEventListener("popstate", scheduleScan);
  setInterval(() => void scan(), 2_000);
  await scan();
}

function scheduleScan(): void {
  if (scanTimer !== undefined) window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => void scan(), 350);
}

async function scan(): Promise<void> {
  if (!bridgeToken || !workspaceEnabled) return;
  const identity = detectProblem();
  if (!identity) {
    diagnostic("未识别题目 URL", location.href);
    return;
  }
  const pageKey = `${identity.site}:${identity.problemId}`;
  if (pageKey !== lastPageKey) {
    lastPageKey = pageKey;
    lastReportedKey = "";
    didInitialLanguageCheck = false;
  }

  const editor = await bridgeRequest("read");
  if ((!editor.ok || typeof editor.code !== "string") && !isEditorDomPresent() &&
    !canCreateWithoutReadableEditor(identity.site)) {
    diagnostic("未识别代码编辑器", editor.message ?? "无编辑器 DOM");
    return;
  }
  const editorCode = editor.ok && typeof editor.code === "string" ? editor.code : "";
  let detectedLanguage = normalizeLanguage(editor.language) ?? detectLanguage();
  // The default C++ fallback is allowed only during the first scan, so an
  // unreadable language control cannot keep falsely reporting C++ forever.
  let language = !didInitialLanguageCheck
    ? languageWithSiteFallback(identity.site, detectedLanguage, defaultLanguage)
    : detectedLanguage;
  if (!didInitialLanguageCheck) {
    didInitialLanguageCheck = true;
    if (language !== defaultLanguage && await switchLanguage(defaultLanguage)) {
      window.setTimeout(() => {
        lastReportedKey = "";
        void scan();
      }, 500);
      return;
    }
  }
  detectedLanguage = normalizeLanguage(editor.language) ?? detectLanguage();
  language = detectedLanguage ?? language;
  if (!language) {
    diagnostic("未识别编程语言", document.body.innerText.slice(0, 300));
    return;
  }
  const statementMarkdown = extractStatementMarkdown(identity.site);
  const context: ProblemContext = { ...identity, language, code: editorCode, statementMarkdown };
  const key = problemKey(context);
  const reportKey = `${key}:${hashText(statementMarkdown ?? "")}`;
  if (reportKey === lastReportedKey) return;
  lastReportedKey = reportKey;
  diagnostic(
    "已识别并发送题目",
    `${key}，编辑器=${editor.editor ?? editor.message ?? "空白兜底"}，网页语言=${editor.language ?? "DOM/默认值"}`
  );
  await chrome.runtime.sendMessage({ type: "contextDetected", protocolVersion: PROTOCOL_VERSION, context });
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function diagnostic(stage: string, detail: string): void {
  const message = `${stage}：${detail}`;
  if (message === lastDiagnostic) return;
  lastDiagnostic = message;
  console.info(`[Algo Sync] ${message}`);
}

async function applyCode(message: {
  site: string;
  problemId: string;
  language: Language;
  code: string;
}): Promise<{ ok: boolean; message?: string }> {
  const identity = detectProblem();
  const editor = await bridgeRequest("read");
  // Saving must use a positively detected language. The C++ creation fallback
  // must never authorize writing into a differently selected compiler.
  const language = identity
    ? normalizeLanguage(editor.language) ?? detectLanguage()
    : undefined;
  if (!identity || identity.site !== message.site || identity.problemId !== message.problemId || language !== message.language) {
    console.warn("[Algo Sync] 网页上下文与保存目标不匹配", { identity, language, message });
    return { ok: false, message: "网页当前题目或语言已经改变" };
  }
  const result = await bridgeRequest("write", message.code);
  console.info("[Algo Sync] 网页编辑器写入结果", result);
  await chrome.runtime.sendMessage({
    type: "applyResult",
    protocolVersion: PROTOCOL_VERSION,
    ok: result.ok,
    message: result.message
  });
  return { ok: result.ok, message: result.message };
}

async function submitCode(message: {
  requestId: string;
  site: Site;
  problemId: string;
  language: Language;
  code: string;
}): Promise<void> {
  await emitSubmissionUpdate(message.requestId, "preparing", "正在把本地代码写入网页编辑器");
  const applied = await applyCode(message);
  if (!applied.ok) {
    await emitSubmissionUpdate(message.requestId, "error", applied.message ?? "代码写入网页失败", false);
    return;
  }
  const identity = detectProblem();
  if (!identity || identity.site !== message.site || identity.problemId !== message.problemId) {
    await emitSubmissionUpdate(message.requestId, "error", "提交前网页题目已经改变", false);
    return;
  }
  const baseline = readSubmissionStatus(message.site);
  const control = findSubmitControl(message.site);
  if (!control) {
    await emitSubmissionUpdate(message.requestId, "error", "没有找到当前网站的提交按钮，请确认已登录且提交区域可见", false);
    return;
  }
  control.click();
  await delay(350);
  findConfirmationControl()?.click();
  await emitSubmissionUpdate(message.requestId, "submitted", "代码已提交，正在等待评测结果");
  await watchSubmission(message.requestId, message.site, baseline, location.href);
}

async function watchSubmission(
  requestId: string,
  site: Site,
  baseline?: SubmissionStatus,
  initialUrl = location.href
): Promise<void> {
  if (submissionWatchers.has(requestId)) return;
  submissionWatchers.add(requestId);
  const startedAt = Date.now();
  const baselineKey = baseline ? `${baseline.phase}:${baseline.status}` : "";
  let sawTransition = baseline === undefined;
  let lastStatus = "";
  try {
    while (Date.now() - startedAt < 10 * 60_000) {
      await delay(750);
      const result = readSubmissionStatus(site);
      if (!result) continue;
      const key = `${result.phase}:${result.status}`;
      if (location.href !== initialUrl || key !== baselineKey) sawTransition = true;
      if (result.phase === "judging") sawTransition = true;
      if (key !== lastStatus && (sawTransition || result.phase === "judging")) {
        lastStatus = key;
        await emitSubmissionUpdate(requestId, result.phase, result.status, result.success);
      }
      if (result.phase === "finished" && (sawTransition || Date.now() - startedAt > 8_000)) return;
    }
    await emitSubmissionUpdate(requestId, "error", "等待评测结果超时，请在网站提交记录中查看", false);
  } finally {
    submissionWatchers.delete(requestId);
  }
}

async function emitSubmissionUpdate(
  requestId: string,
  phase: SubmissionPhase,
  status: string,
  success?: boolean
): Promise<void> {
  await chrome.runtime.sendMessage({
    type: "submissionUpdate",
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    phase,
    status,
    success
  }).catch(() => undefined);
}

function bridgeRequest(action: "read" | "write", code?: string): Promise<BridgeResponse> {
  if (!bridgeToken) return Promise.resolve({ ok: false, message: "编辑器桥接尚未初始化" });
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", listener);
      resolve({ ok: false, message: "编辑器响应超时" });
    }, 2_000);
    const listener = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown> | undefined;
      if (event.source !== window || !data || data.source !== "algo-sync-main" || data.token !== bridgeToken || data.requestId !== requestId) return;
      window.clearTimeout(timeout);
      window.removeEventListener("message", listener);
      resolve(data as unknown as BridgeResponse);
    };
    window.addEventListener("message", listener);
    window.postMessage({ source: "algo-sync-content", token: bridgeToken, requestId, action, code }, "*");
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
