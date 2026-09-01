import {
  PROTOCOL_VERSION,
  problemKey,
  type Language,
  type ProblemContext,
  type Site,
  type SubmissionPhase,
  type TestPointResult
} from "@algo-sync/shared";
import {
  canCreateWithoutReadableEditor,
  describeVisibleLanguageOptions,
  detectLanguage,
  detectLanguageLabel,
  detectProblem,
  isEditorDomPresent,
  languageWithSiteFallback,
  normalizeLanguage,
  switchLanguage
} from "./adapters";
import { languageSwitchHasSettled } from "./language-switch";
import { extractStatementMarkdown } from "./statement";
import {
  describeSubmitCandidates,
  findConfirmationControl,
  findSubmitControl,
  isCaptchaChallengePresent,
  observeSubmissionTransition,
  readCaptchaError,
  readSubmissionFeedback,
  readSubmissionStatus,
  type SubmissionFeedback,
  type SubmissionStatus,
  type SubmissionTransitionObserver
} from "./submission";

interface BridgeResponse {
  ok: boolean;
  code?: string;
  editor?: string;
  language?: string;
  template?: string;
  message?: string;
}

let bridgeToken: string | undefined;
let lastPageKey = "";
let lastReportedKey = "";
let didInitialLanguageCheck = false;
let scanTimer: number | undefined;
let workspaceEnabled = false;
let defaultLanguage: Language = "cpp";
let commandLanguageSwitch: Language | undefined;
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
  if (message?.type === "switchLanguage") {
    void switchProblemLanguage(message).then(sendResponse);
    return true;
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
    pendingSubmission?: { requestId: string; site: Site };
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
  if (response.pendingSubmission) {
    void watchSubmission(response.pendingSubmission.requestId, response.pendingSubmission.site);
  }
}

function scheduleScan(): void {
  if (scanTimer !== undefined) window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => void scan(), 350);
}

async function scan(): Promise<void> {
  if (!bridgeToken || !workspaceEnabled || commandLanguageSwitch) return;
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

  const editor = await bridgeRequest("read", detectLanguage());
  if ((!editor.ok || typeof editor.code !== "string") && !isEditorDomPresent() &&
    !canCreateWithoutReadableEditor(identity.site)) {
    diagnostic("未识别代码编辑器", editor.message ?? "无编辑器 DOM");
    return;
  }
  const controlLanguage = detectLanguage();
  const editorLanguage = normalizeLanguage(editor.language);
  // A background Nowcoder tab can retain the previous Monaco model after its
  // compiler selector has already changed. Never initialize the new language
  // file with code from that stale model; an official template is safe, and an
  // empty file is preferable when the page has not exposed one yet.
  const hasStaleNowcoderModel = identity.site === "nowcoder" &&
    controlLanguage !== undefined && editorLanguage !== undefined &&
    controlLanguage !== editorLanguage && editor.editor !== "nowcoder-vue";
  const editorCode = hasStaleNowcoderModel
    ? editor.template ?? ""
    : editor.ok && typeof editor.code === "string" ? editor.code : "";
  let detectedLanguage = controlLanguage ?? editorLanguage;
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
  detectedLanguage = detectLanguage() ?? normalizeLanguage(editor.language);
  language = detectedLanguage ?? language;
  if (!language) {
    diagnostic("未识别编程语言", document.body.innerText.slice(0, 300));
    return;
  }
  const statementMarkdown = extractStatementMarkdown(identity.site);
  const context: ProblemContext = {
    ...identity,
    language,
    code: editorCode,
    initialCode: editor.template,
    statementMarkdown
  };
  const key = problemKey(context);
  const reportKey = `${key}:${hashText(statementMarkdown ?? "")}:${hashText(editor.template ?? "")}`;
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
  const editor = await bridgeRequest("read", detectLanguage() ?? message.language);
  // Saving must use a positively detected language. The C++ creation fallback
  // must never authorize writing into a differently selected compiler.
  const language = identity
    ? detectLanguage() ?? normalizeLanguage(editor.language)
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

async function switchProblemLanguage(message: {
  site: Site;
  problemId: string;
  language: Language;
}): Promise<{ ok: boolean; message: string }> {
  const identity = detectProblem();
  if (!identity || identity.site !== message.site || identity.problemId !== message.problemId) {
    return { ok: false, message: "切换前网页题目已经改变" };
  }
  commandLanguageSwitch = message.language;
  let completed = false;
  try {
    const before = await bridgeRequest("read", detectLanguage());
    const currentLanguage = detectLanguage() ?? normalizeLanguage(before.language);
    const needsPreferredVariant = !hasPreferredLanguageVariant(identity.site, message.language, before);
    let switched = currentLanguage === message.language && !needsPreferredVariant;
    // Nowcoder keeps its Element UI options mounted, while Luogu owns its IDE
    // language in Vue state. Let the main-world bridge update the site's real
    // component before falling back to isolated-DOM controls.
    if (!switched && (identity.site === "nowcoder" || identity.site === "luogu")) {
      switched = (await bridgeRequest("switchLanguage", message.language)).ok;
    }
    if (!switched) switched = await switchLanguage(message.language);
    if (!switched) {
      const candidates = describeVisibleLanguageOptions();
      const detail = candidates.length > 0 ? `；页面候选：${candidates.join("、")}` : "；页面候选：未识别到任何语言";
      return { ok: false, message: `当前题目不支持或未找到 ${message.language} 语言选项${detail}` };
    }
    let lastEditor = before;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await delay(150);
      const editor = await bridgeRequest("read", message.language);
      lastEditor = editor;
      if (!languageSwitchHasSettled(identity.site, message.language, detectLanguageLabel(), editor.language)) continue;
      // Give the site time to replace its starter code after changing the
      // language label. Mutation-driven scans remain paused until then.
      await delay(500);
      const settledEditor = await bridgeRequest("read", message.language);
      lastEditor = settledEditor;
      if (!languageSwitchHasSettled(identity.site, message.language, detectLanguageLabel(), settledEditor.language)) continue;
      didInitialLanguageCheck = true;
      lastReportedKey = "";
      commandLanguageSwitch = undefined;
      completed = true;
      await scan();
      return { ok: true, message: `已切换到 ${message.language}` };
    }
    return {
      ok: false,
      message: `网页没有确认切换到 ${message.language}（控件=${detectLanguageLabel() ?? "未知"}，编辑器=${lastEditor.language ?? "未知"}）`
    };
  } finally {
    if (!completed && commandLanguageSwitch === message.language) {
      commandLanguageSwitch = undefined;
      scheduleScan();
    }
  }
}

function hasPreferredLanguageVariant(site: Site, wanted: Language, editor: BridgeResponse): boolean {
  if (site !== "nowcoder" || wanted !== "python") return true;
  const labels = [detectLanguageLabel(), editor.language]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.replace(/（/g, "(").replace(/\s+/g, " ").trim());
  if (labels.some((value) => /^(?:python|pypy)\s*2(?:\b|\s|\()/i.test(value))) return false;
  return labels.some((value) => /^(?:python|pypy)\s*3(?:\b|\s|\()/i.test(value));
}

async function submitCode(message: {
  requestId: string;
  site: Site;
  problemId: string;
  language: Language;
  code: string;
}): Promise<void> {
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
  const baselineFeedback = readSubmissionFeedback(message.site);
  const initialUrl = location.href;
  const control = findSubmitControl(message.site);
  if (!control) {
    await emitSubmissionUpdate(
      message.requestId,
      "error",
      `没有找到当前网站的提交按钮。${describeSubmitCandidates()}。请确认已登录且提交区域可见`,
      false
    );
    return;
  }
  const transitionObserver = observeSubmissionTransition(message.site);
  control.click();
  await delay(350);
  findConfirmationControl()?.click();
  await delay(500);
  if (isCaptchaChallengePresent()) {
    await emitSubmissionUpdate(message.requestId, "attention", "提交需要前往题目页面输入验证码");
    const captchaResult = await waitForCaptchaCompletion();
    if (!captchaResult.ok) {
      transitionObserver.disconnect();
      await emitSubmissionUpdate(message.requestId, "error", captchaResult.message, false);
      return;
    }
  }
  if (message.site === "nowcoder") {
    let start = await waitForNowcoderSubmissionStart(baseline, baselineFeedback, initialUrl);
    if (start.kind === "captcha") {
      await emitSubmissionUpdate(message.requestId, "attention", "提交需要前往题目页面输入验证码");
      const captchaResult = await waitForCaptchaCompletion();
      if (!captchaResult.ok) {
        transitionObserver.disconnect();
        await emitSubmissionUpdate(message.requestId, "error", captchaResult.message, false);
        return;
      }
      start = await waitForNowcoderSubmissionStart(baseline, baselineFeedback, initialUrl);
    }
    if (start.kind === "error") {
      transitionObserver.disconnect();
      await emitSubmissionUpdate(message.requestId, "error", start.message, false);
      return;
    }
    if (start.kind === "timeout") {
      transitionObserver.disconnect();
      await emitSubmissionUpdate(
        message.requestId,
        "error",
        "牛客页面没有响应提交操作，请确认已登录且代码页的“保存并提交”按钮可用",
        false
      );
      return;
    }
  }
  await emitSubmissionUpdate(message.requestId, "submitted", "代码已提交，正在等待评测结果");
  await watchSubmission(
    message.requestId,
    message.site,
    baseline,
    initialUrl,
    baselineFeedback,
    transitionObserver
  );
}

async function waitForNowcoderSubmissionStart(
  baseline?: SubmissionStatus,
  baselineFeedback?: SubmissionFeedback,
  initialUrl = location.href
): Promise<{ kind: "started" } | { kind: "captcha" } | { kind: "error"; message: string } | { kind: "timeout" }> {
  const startedAt = Date.now();
  const baselineStatusKey = statusKey(baseline);
  const baselineFeedbackKey = feedbackKey(baselineFeedback);
  while (Date.now() - startedAt < 10_000) {
    if (isCaptchaChallengePresent()) return { kind: "captcha" };
    const feedback = readSubmissionFeedback("nowcoder");
    if (feedback?.kind === "error" && feedbackKey(feedback) !== baselineFeedbackKey) {
      return { kind: "error", message: feedback.text };
    }
    const status = readSubmissionStatus("nowcoder");
    if (location.href !== initialUrl || (status && (status.phase === "judging" || statusKey(status) !== baselineStatusKey)) ||
      (feedback?.kind === "progress" && feedbackKey(feedback) !== baselineFeedbackKey)) {
      return { kind: "started" };
    }
    await delay(200);
  }
  return { kind: "timeout" };
}

async function watchSubmission(
  requestId: string,
  site: Site,
  baseline?: SubmissionStatus,
  initialUrl = location.href,
  baselineFeedback?: SubmissionFeedback,
  transitionObserver?: SubmissionTransitionObserver
): Promise<void> {
  if (submissionWatchers.has(requestId)) return;
  submissionWatchers.add(requestId);
  const startedAt = Date.now();
  const baselineKey = baseline ? `${baseline.phase}:${baseline.status}` : "";
  const baselineFeedbackKey = feedbackKey(baselineFeedback);
  let sawTransition = baseline === undefined || transitionObserver?.hasChanged() === true;
  let lastStatus = "";
  try {
    while (Date.now() - startedAt < 10 * 60_000) {
      await delay(750);
      if (transitionObserver?.hasChanged()) sawTransition = true;
      const feedback = readSubmissionFeedback(site);
      if (feedback?.kind === "error" && feedbackKey(feedback) !== baselineFeedbackKey) {
        await emitSubmissionUpdate(requestId, "error", feedback.text, false);
        return;
      }
      const result = readSubmissionStatus(site);
      if (!result) {
        // The old result panel disappearing is itself a transition. This also
        // covers LeetCode's judging phase, which replaces console-result with
        // an unlabelled progress component.
        if (baseline) sawTransition = true;
        continue;
      }
      const key = `${result.phase}:${result.status}`;
      if (location.href !== initialUrl || key !== baselineKey) sawTransition = true;
      if (result.phase === "judging") sawTransition = true;
      if (key !== lastStatus && (sawTransition || result.phase === "judging")) {
        lastStatus = key;
        await emitSubmissionUpdate(
          requestId,
          result.phase,
          result.status,
          result.success,
          result.allAccepted,
          result.testPoints
        );
      }
      if (result.phase === "finished" && (sawTransition || Date.now() - startedAt > 8_000)) return;
    }
    await emitSubmissionUpdate(requestId, "error", "等待评测结果超时，请在网站提交记录中查看", false);
  } finally {
    transitionObserver?.disconnect();
    submissionWatchers.delete(requestId);
  }
}

function statusKey(status?: SubmissionStatus): string {
  return status ? `${status.phase}:${status.status}` : "";
}

function feedbackKey(feedback?: SubmissionFeedback): string {
  return feedback ? `${feedback.kind}:${feedback.text}` : "";
}

async function emitSubmissionUpdate(
  requestId: string,
  phase: SubmissionPhase,
  status: string,
  success?: boolean,
  allAccepted?: boolean,
  testPoints?: TestPointResult[]
): Promise<void> {
  await chrome.runtime.sendMessage({
    type: "submissionUpdate",
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    phase,
    status,
    success,
    allAccepted,
    testPoints
  }).catch(() => undefined);
}

async function waitForCaptchaCompletion(): Promise<{ ok: true } | { ok: false; message: string }> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 3 * 60_000) {
    const captchaError = readCaptchaError();
    if (captchaError) return { ok: false, message: captchaError };
    if (!isCaptchaChallengePresent()) {
      for (let settle = 0; settle < 8; settle++) {
        await delay(250);
        const lateError = readCaptchaError();
        if (lateError) return { ok: false, message: lateError };
        if (isCaptchaChallengePresent()) break;
        if (settle === 7) return { ok: true };
      }
    }
    // Never infer that a captcha is complete from a partially filled input.
    // The user confirms it on the website; we only observe success or failure.
    await delay(250);
  }
  return { ok: false, message: "等待输入验证码超时，已取消本次提交" };
}

function bridgeRequest(action: "read" | "write" | "switchLanguage", value?: string): Promise<BridgeResponse> {
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
    window.postMessage({
      source: "algo-sync-content",
      token: bridgeToken,
      requestId,
      action,
      ...(action === "write"
        ? { code: value }
        : (action === "switchLanguage" || action === "read") && value
          ? { language: value }
          : {})
    }, "*");
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
