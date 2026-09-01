import type { Site, SubmissionPhase, TestPointResult } from "@algo-sync/shared";

export interface SubmissionStatus {
  phase: SubmissionPhase;
  status: string;
  success?: boolean;
  allAccepted?: boolean;
  testPoints?: TestPointResult[];
}

export interface SubmissionFeedback {
  kind: "progress" | "error";
  text: string;
}

export interface SubmissionTransitionObserver {
  hasChanged(): boolean;
  disconnect(): void;
}

const SUBMIT_LABELS: Record<Site, RegExp> = {
  luogu: /^(?:提交评测|提交代码|提交)(?!记录|历史|列表)(?:\s*[(（]?(?:Ctrl|⌘|Alt|Shift).*)?$/i,
  nowcoder: /^(?:保存并提交|提交代码|提交)$/i,
  leetcode: /^(?:提交|submit)$/i,
  ybt: /(?:提交|submit)/i
};

const RESULT_SELECTORS: Record<Site, string[]> = {
  luogu: ["[class*='record-status']", "[class*='judge-status']", "[class*='result']", "[class*='status']"],
  nowcoder: [
    ".workbench .composite-panel",
    ".answer-module .composite-panel",
    "[class*='result']",
    "[class*='judge']",
    "[class*='status']",
    ".result-status"
  ],
  leetcode: [
    "[data-e2e-locator='console-result']",
    "[data-e2e-locator='submission-result']",
    "[data-e2e-locator*='submission-result']",
    "[data-e2e-locator*='result']",
    "[data-cy*='result']",
    "[class*='submission-result']",
    "[class*='result']"
  ],
  ybt: ["#result", "#status", "[class*='result']", "[class*='status']", "body"]
};

export function findSubmitControl(site: Site, doc = document): HTMLElement | undefined {
  if (site === "nowcoder") {
    return findNowcoderSubmitControl(doc);
  }
  if (site === "leetcode") {
    const located = doc.querySelector<HTMLElement>(
      "[data-e2e-locator='console-submit-button'], [data-e2e-locator*='submit-button']"
    );
    if (located && isUsable(located)) return located;
  }
  // Luogu's current frontend may render actions as links or custom div/span
  // components. Inspect short exact labels, then click the nearest actionable
  // ancestor (or the labelled child itself so its click event bubbles).
  const labelled = Array.from(doc.querySelectorAll<HTMLElement>("body *"))
    .map((element) => ({ element, label: controlLabel(element) }))
    .filter(({ element, label }) => label.length <= 100 && isUsable(element) && SUBMIT_LABELS[site].test(label))
    .sort((left, right) => left.label.length - right.label.length || elementDepth(right.element) - elementDepth(left.element));
  for (const { element } of labelled) {
    const actionable = element.closest<HTMLElement>(
      "button, a, input[type='submit'], input[type='button'], [role='button'], [class*='button'], [class*='btn']"
    ) ?? element;
    if (isUsable(actionable)) return actionable;
  }
  return undefined;
}

function findNowcoderSubmitControl(doc: Document): HTMLElement | undefined {
  const direct = Array.from(doc.querySelectorAll<HTMLElement>(
    ".workbench button.btn-submit, .answer-module button.btn-submit, button.btn-submit"
  ));
  const labelled = Array.from(doc.querySelectorAll<HTMLElement>("body *"))
    .filter((element) => SUBMIT_LABELS.nowcoder.test(controlLabel(element)))
    .map((element) => element.closest<HTMLElement>(
      "button, a, input[type='submit'], input[type='button'], [role='button'], [class*='button'], [class*='btn']"
    ) ?? element);
  return [...direct, ...labelled]
    .filter((element, index, all) => all.indexOf(element) === index)
    .filter((element) => isUsable(element) && SUBMIT_LABELS.nowcoder.test(controlLabel(element)))
    .map((element) => ({ element, score: nowcoderSubmitControlScore(element) }))
    .sort((left, right) => right.score - left.score)[0]?.element;
}

function nowcoderSubmitControlScore(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  const hasGeometry = rect.width > 1 && rect.height > 1;
  const inViewport = hasGeometry && rect.bottom >= 0 && rect.right >= 0 &&
    rect.top <= (element.ownerDocument.defaultView?.innerHeight ?? Number.POSITIVE_INFINITY) &&
    rect.left <= (element.ownerDocument.defaultView?.innerWidth ?? Number.POSITIVE_INFINITY);
  let score = 0;
  if (/^保存并提交$/i.test(controlLabel(element))) score += 1_000;
  if (element.matches("button, input[type='submit'], input[type='button']")) score += 250;
  if (element.matches("button.btn-submit, [class~='btn-submit']")) score += 600;
  if (element.closest(".workbench, .answer-module")) score += 300;
  if (element.closest("[class*='shortcut' i], [class*='popover' i], [class*='tooltip' i], [class*='help' i]")) {
    score -= 20_000;
  }
  if (hasGeometry) score += 2_000 + Math.max(0, rect.left) + Math.max(0, rect.top) / 10;
  if (inViewport) score += 500;
  return score;
}

export function describeSubmitCandidates(doc = document): string {
  const labels = Array.from(doc.querySelectorAll<HTMLElement>("body *"))
    .map(controlLabel)
    .filter((label) => /提交/.test(label) && label.length <= 100)
    .filter((label, index, all) => all.indexOf(label) === index)
    .slice(0, 8);
  return labels.length > 0 ? labels.join("；") : "页面中没有包含“提交”的可见文字";
}

export function findConfirmationControl(doc = document): HTMLElement | undefined {
  const dialogs = Array.from(doc.querySelectorAll<HTMLElement>(
    "[role='dialog'], [aria-modal='true'], .modal, [class*='dialog']"
  ));
  for (const dialog of dialogs) {
    const controls = Array.from(dialog.querySelectorAll<HTMLElement>("button, [role='button'], input[type='button']"));
    const match = controls.find((control) => {
      const label = control instanceof HTMLInputElement ? control.value : control.textContent ?? "";
      return isUsable(control) && /^(?:确认提交|确认|确定|提交)$/i.test(normalize(label));
    });
    if (match) return match;
  }
  return undefined;
}

export function findNowcoderPostSubmissionDismissControl(doc = document): HTMLElement | undefined {
  const successHeading = /恭喜(?:你)?(?:(?:已)?通过|.*\bAC\b).*(?:本题|题目)/i;
  const markers = deepQueryAll<HTMLElement>(doc, "body *, *")
    .filter(isUsable)
    .map((element) => ({ element, text: normalize(element.innerText || element.textContent || "") }))
    .filter(({ text }) => text.length > 0 && successHeading.test(text))
    .sort((left, right) => left.text.length - right.text.length);

  for (const { element } of markers) {
    let container: HTMLElement | null = element;
    for (let depth = 0; container && depth < 10; depth++, container = container.parentElement) {
      const controls = deepQueryAll<HTMLElement>(container,
        "button, [role='button'], input[type='button'], [aria-label], [title], [class*='close' i]"
      ).filter(isUsable);
      const labelledClose = controls.find((control) =>
        /^(?:关闭|取消|稍后再说|close)$/i.test(controlLabel(control)));
      if (labelledClose) return labelledClose;
      const iconClose = controls.find((control) =>
        /(?:close|关闭)/i.test([
          control.getAttribute("aria-label"),
          control.getAttribute("title"),
          control.className
        ].filter((value): value is string => typeof value === "string").join(" ")));
      if (iconClose) return iconClose;
    }
  }
  return undefined;
}

export function activateSubmissionControl(element: HTMLElement): void {
  const view = element.ownerDocument.defaultView;
  const rect = element.getBoundingClientRect();
  const init: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    buttons: 1,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2
  };
  const Pointer = view?.PointerEvent;
  const Mouse = view?.MouseEvent ?? MouseEvent;
  element.dispatchEvent(Pointer
    ? new Pointer("pointerdown", { ...init, pointerType: "mouse", isPrimary: true })
    : new Mouse("pointerdown", init));
  element.dispatchEvent(new Mouse("mousedown", init));
  element.focus();
  element.dispatchEvent(Pointer
    ? new Pointer("pointerup", { ...init, buttons: 0, pointerType: "mouse", isPrimary: true })
    : new Mouse("pointerup", { ...init, buttons: 0 }));
  element.dispatchEvent(new Mouse("mouseup", { ...init, buttons: 0 }));
  HTMLElement.prototype.click.call(element);
}

export function isCaptchaChallengePresent(doc = document): boolean {
  const explicitInputs = Array.from(doc.querySelectorAll<HTMLInputElement>([
    "input[placeholder*='验证码']",
    "input[aria-label*='验证码']",
    "input[name*='captcha' i]",
    "input[id*='captcha' i]"
  ].join(","))).some((input) => input.type !== "hidden" && isUsable(input));
  if (explicitInputs) return true;

  // LeetCode and other SPAs keep passive reCAPTCHA badge/iframe scaffolding in
  // the DOM even when no challenge is open. A class/id containing “captcha” is
  // therefore not evidence on its own: require an actual visible dialog with
  // verification wording and an interactive field/frame.
  const containers = Array.from(doc.querySelectorAll<HTMLElement>([
    "[role='dialog']",
    "[aria-modal='true']",
    ".modal",
    "[class*='dialog' i]",
    "[class*='popup' i]",
    "[class*='captcha' i]",
    "[id*='captcha' i]"
  ].join(","))).filter(isUsable);
  return containers.some((container) => {
    const text = normalize(container.innerText || container.textContent || "");
    if (!/(?:验证码|captcha|人机验证|安全验证|验证(?:身份|真人))/i.test(text)) return false;
    return Array.from(container.querySelectorAll<HTMLElement>(
      "input:not([type='hidden']), textarea, iframe, button, [role='button']"
    )).some(isUsable);
  });
}

export function readCaptchaError(doc = document): string | undefined {
  return Array.from(doc.querySelectorAll<HTMLElement>("body *"))
    .map((element) => normalize(element.textContent ?? ""))
    .filter((text) => text.length > 0 && text.length <= 100)
    .filter((text) => /(?:验证码|验证).*(?:错误|不正确|无效|失败|过期|不合法)|(?:错误|不正确|无效|失败|过期|不合法).*(?:验证码|验证)|invalid\s+captcha/i.test(text))
    .sort((left, right) => left.length - right.length)[0];
}

export function readSubmissionStatus(site: Site, doc = document): SubmissionStatus | undefined {
  if (site === "luogu") {
    const compileFailure = readLuoguCompileFailure(doc);
    if (compileFailure) return compileFailure;
    const recordStatus = readLuoguTestPoints(doc);
    if (recordStatus) return recordStatus;
  }
  if (site === "nowcoder") {
    const workbenchStatus = readNowcoderWorkbenchStatus(doc);
    if (workbenchStatus) return workbenchStatus;
  }
  if (site === "leetcode") {
    const leetcodeStatus = readLeetcodeStatus(doc);
    if (leetcodeStatus) return leetcodeStatus;
  }
  const candidates: string[] = [];
  for (const selector of RESULT_SELECTORS[site]) {
    for (const element of Array.from(doc.querySelectorAll<HTMLElement>(selector))) {
      const text = normalize(element.innerText || element.textContent || "");
      if (text && text.length <= 2_000) candidates.push(text);
    }
  }
  return candidates
    .sort((left, right) => left.length - right.length)
    .map(classifySubmissionStatus)
    .find((status): status is SubmissionStatus => status !== undefined);
}

/**
 * Records a result-region mutation even when the old and new verdict text are
 * identical (for example AC followed by another AC). Polling text alone cannot
 * distinguish that very common LeetCode sequence.
 */
export function observeSubmissionTransition(site: Site, doc = document): SubmissionTransitionObserver {
  const selector = RESULT_SELECTORS[site].join(",");
  const baseline = new Set(Array.from(doc.querySelectorAll<HTMLElement>(selector)));
  let changed = false;
  const Observer = doc.defaultView?.MutationObserver ?? MutationObserver;
  const observer = new Observer((mutations) => {
    if (changed) return;
    if (Array.from(baseline).some((element) => !element.isConnected)) {
      changed = true;
      return;
    }
    for (const mutation of mutations) {
      const target = mutation.target;
      if (Array.from(baseline).some((element) => element === target || element.contains(target))) {
        changed = true;
        return;
      }
      if (mutation.type !== "childList") continue;
      const touched = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)]
        .some((node) => node instanceof Element && (node.matches(selector) || node.querySelector(selector)));
      if (touched) {
        changed = true;
        return;
      }
    }
  });
  if (doc.body) observer.observe(doc.body, { childList: true, subtree: true, characterData: true });
  return {
    hasChanged: () => changed,
    disconnect: () => observer.disconnect()
  };
}

/** Reads only submission UI feedback, never the problem statement. */
export function readSubmissionFeedback(site: Site, doc = document): SubmissionFeedback | undefined {
  if (site !== "nowcoder") return undefined;
  const selectors = [
    ".workbench .composite-panel",
    ".answer-module .composite-panel",
    "[role='alert']",
    ".alert",
    ".el-message",
    ".nc-alert",
    "[class*='toast' i]",
    "[role='dialog']"
  ];
  const texts = Array.from(doc.querySelectorAll<HTMLElement>(selectors.join(",")))
    .filter(isUsable)
    .map((element) => normalize(element.innerText || element.textContent || ""))
    .filter((text) => text.length > 0 && text.length <= 2_000)
    .sort((left, right) => left.length - right.length);
  const error = texts.find((text) => /(?:代码提交失败|提交失败|代码不能为空|代码不符合规范|请先登录|尚未登录|登录后|验证码(?:错误|无效|过期)|请求失败|网络(?:错误|异常)|出现错误)/i.test(text));
  if (error) return { kind: "error", text: error.slice(0, 500) };
  // “正在提交代码” is emitted before the HTTP request. It is deliberately
  // not enough to claim success; “查询结果/判题” means a submissionId exists.
  const progress = texts.find((text) => /(?:正在查询结果|正在判题|正在评测|评测中|判题中|等待评测)/i.test(text));
  if (progress) return { kind: "progress", text: progress.slice(0, 500) };
  return undefined;
}

function readNowcoderWorkbenchStatus(doc: Document): SubmissionStatus | undefined {
  const roots = Array.from(doc.querySelectorAll<HTMLElement>(
    ".workbench .composite-panel, .answer-module .composite-panel"
  )).filter(isUsable);
  const compileFailure = readNowcoderCompileFailure(roots);
  if (compileFailure) return compileFailure;
  for (const root of roots) {
    const candidates = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]
      .filter(isUsable)
      .map((element) => normalize(element.innerText || element.textContent || ""))
      .filter((text) => text.length > 0 && text.length <= 2_000)
      .sort((left, right) => left.length - right.length);
    const status = candidates.map(classifySubmissionStatus)
      .find((candidate): candidate is SubmissionStatus => candidate !== undefined);
    if (!status) continue;
    if (status.phase !== "finished") return status;
    const metrics = readNowcoderMetrics(root);
    return {
      ...status,
      status: `${status.status}\n编译成功${metrics ? ` · ${metrics}` : ""}`
    };
  }
  return undefined;
}

function readNowcoderCompileFailure(roots: HTMLElement[]): SubmissionStatus | undefined {
  const marker = roots.find((root) =>
    /(?:编译失败|编译错误|编译出错|Compilation Error|Compile Error)/i.test(
      normalize(root.innerText || root.textContent || "")
    ));
  if (!marker) return undefined;
  const preferred = Array.from(marker.querySelectorAll<HTMLElement>([
    "pre",
    "code",
    "textarea",
    "[class*='compile' i]",
    "[class*='compiler' i]",
    "[class*='error-message' i]",
    "[class*='error-info' i]"
  ].join(","))).map(readMultilineText);
  const fallback = [marker, ...Array.from(marker.querySelectorAll<HTMLElement>("*"))]
    .map(readMultilineText)
    .filter((text) => text.length <= 20_000);
  const detail = [...preferred, ...fallback]
    .map(cleanNowcoderCompilerOutput)
    .filter(isUsefulCompilerOutput)
    .sort((left, right) => compilerOutputScore(right) - compilerOutputScore(left))[0] ?? "";
  return {
    phase: "finished",
    status: detail ? `CE Compilation Error\n${detail.slice(0, 1_800)}` : "CE Compilation Error",
    success: false,
    allAccepted: false
  };
}

function cleanNowcoderCompilerOutput(text: string): string {
  const raw = text.replace(/\r/g, "").trim();
  if (!raw) return "";
  const detailedHeading = raw.match(/编译(?:错误|失败|出错)\s*[:：]\s*(?:您提交的代码)?[^\n]*/i);
  const lineHeading = raw.match(/(?:^|\n)\s*(?:编译失败|编译错误|编译出错|Compilation Error|Compile Error)\s*(?:\n|$)/i);
  const diagnostic = raw.match(/(?:^|\n)\s*(?:[^\n]*\.(?:c|cc|cpp|cxx|java|py):\d+(?::\d+)?:|(?:fatal\s+)?error:|warning:|note:|undefined reference|Traceback)/i);
  const start = detailedHeading?.index ?? lineHeading?.index ?? diagnostic?.index ?? 0;
  const cropped = raw.slice(start).replace(/^\s+/, "");
  return (detailedHeading ? cropped : cleanCompilerOutput(cropped))
    .split("\n")
    .filter((line) => !/^(?:运行结果|自测输入|自测运行|保存并提交|您的代码已保存)\s*$/i.test(line.trim()))
    .join("\n")
    .trim();
}

function readNowcoderMetrics(root: HTMLElement): string {
  const text = normalize(root.innerText || root.textContent || "");
  const time = text.match(/运行时间\s*[:：]?\s*(\d+(?:\.\d+)?\s*(?:ms|s))/i)?.[1]?.replace(/\s+/g, "");
  const memory = text.match(/(?:占用内存|内存消耗|使用内存)\s*[:：]?\s*(\d+(?:\.\d+)?\s*(?:KB|MB|GB|B))/i)?.[1]
    ?.replace(/\s+/g, "");
  return [time ? `运行时间 ${time}` : "", memory ? `占用内存 ${memory}` : ""].filter(Boolean).join(" · ");
}

function readLeetcodeStatus(doc: Document): SubmissionStatus | undefined {
  const direct = Array.from(doc.querySelectorAll<HTMLElement>(
    "[data-e2e-locator='console-result'], [data-e2e-locator='submission-result']"
  ));
  for (const root of direct.filter(isUsable)) {
    const compileFailure = readLeetcodeCompileFailure(root);
    if (compileFailure) return compileFailure;
    const candidates = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]
      .filter(isUsable)
      .map((element) => normalize(element.innerText || element.textContent || ""))
      .filter(Boolean)
      .sort((left, right) => left.length - right.length);
    const classified = candidates.map(classifySubmissionStatus)
      .find((status): status is SubmissionStatus => status !== undefined);
    if (classified) return enrichLeetcodeStatus(classified, root, doc);
    // console-result/submission-result are terminal result components in the
    // current LeetCode UI. Treat an unfamiliar non-empty verdict as a failure
    // so a future translation cannot leave the CLI locked forever.
    const text = readMultilineText(root);
    if (text) return { phase: "finished", status: text.slice(0, 1_800), success: false };
  }
  const exactStatus = /^(?:通过|执行通过|Accepted|错误解答|答案错误|Wrong Answer|违反限制|超出内存限制|内存超限|超出输出限制|输出超限|超出时间限制|运行超时|执行出错|运行错误|内部出错|系统错误|编译出错|编译错误|超时|Restrictions Failed|校验中|校验完成|正在准备执行环境|正在编译代码|正在运行测试用例|评测中|等待评测)$/i;
  const fallback = Array.from(doc.querySelectorAll<HTMLElement>("body *"))
    .filter((element) => element.children.length === 0 && isUsable(element))
    .map((element) => normalize(element.innerText || element.textContent || ""))
    .filter((text) => exactStatus.test(text));
  const fallbackStatus = fallback
    .map(classifySubmissionStatus)
    .find((status): status is SubmissionStatus => status !== undefined);
  return fallbackStatus ? enrichLeetcodeStatus(fallbackStatus, undefined, doc) : undefined;
}

function readLeetcodeCompileFailure(root: HTMLElement): SubmissionStatus | undefined {
  const rootText = normalize(root.innerText || root.textContent || "");
  if (!/(?:编译失败|编译错误|编译出错|Compilation Error|Compile Error)/i.test(rootText)) return undefined;
  const preferred = Array.from(root.querySelectorAll<HTMLElement>([
    "pre",
    "code",
    "textarea",
    "[class*='compile' i]",
    "[class*='compiler' i]",
    "[class*='error-message' i]"
  ].join(","))).map(readMultilineText).map(cleanCompilerOutput).filter(isUsefulCompilerOutput);
  const fallback = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]
    .map(readMultilineText)
    .map(cleanCompilerOutput)
    .filter((text) => text.length <= 20_000 && isUsefulCompilerOutput(text))
    .sort((left, right) => compilerOutputScore(right) - compilerOutputScore(left));
  const detail = preferred.sort((left, right) => compilerOutputScore(right) - compilerOutputScore(left))[0] ?? fallback[0] ?? "";
  return {
    phase: "finished",
    status: detail ? `CE Compilation Error\n${detail.slice(0, 1_800)}` : "CE Compilation Error",
    success: false,
    allAccepted: false
  };
}

function enrichLeetcodeStatus(status: SubmissionStatus, root: HTMLElement | undefined, doc: Document): SubmissionStatus {
  if (status.phase !== "finished") return status;
  const restriction = /(?:违反限制|Restrictions Failed)/i.test(status.status)
    ? readLeetcodeRestrictionDetail(doc, root)
    : "";
  const metrics = readLeetcodeMetrics(root, doc);
  const compiled = status.success === true || /(?:错误解答|答案错误|Wrong Answer|Runtime Error|运行错误|执行出错|运行超时|Time Limit|内存超限|Memory Limit|输出超限|Output Limit)/i.test(status.status);
  const details = restriction || (root ? readLeetcodeResultDetails(root, status.status) : "");
  return {
    ...status,
    status: [
      status.status,
      compiled ? `编译成功${metrics ? ` · ${metrics}` : ""}` : metrics,
      details
    ].filter(Boolean).join("\n").slice(0, 1_900)
  };
}

function readLeetcodeMetrics(root: HTMLElement | undefined, doc: Document): string {
  const rootText = normalize(root?.innerText || root?.textContent || "");
  const metricTexts = [rootText, ...Array.from(doc.querySelectorAll<HTMLElement>("body *"))
    .filter(isUsable)
    .map((element) => normalize(element.innerText || element.textContent || ""))
    .filter((text) => text.length > 0 && text.length <= 500)]
    .filter((text, index, all) => all.indexOf(text) === index)
    .sort((left, right) => left.length - right.length);
  const time = metricTexts
    .map((text) => text.match(/(?:执行用时(?:分布)?|运行时间)\s*[:：]?\s*(\d+(?:\.\d+)?\s*(?:ms|s))/i)?.[1])
    .find((value): value is string => typeof value === "string")
    ?.replace(/\s+/g, "");
  const memory = metricTexts
    .map((text) => text.match(/(?:消耗内存(?:分布)?|内存消耗|占用内存|使用内存)\s*[:：]?\s*(\d+(?:\.\d+)?\s*(?:KB|MB|GB|B))/i)?.[1])
    .find((value): value is string => typeof value === "string")
    ?.replace(/\s+/g, "");
  return [time ? `执行用时 ${time}` : "", memory ? `内存消耗 ${memory}` : ""].filter(Boolean).join(" · ");
}

function readLeetcodeRestrictionDetail(doc: Document, root?: HTMLElement): string {
  const preferred = Array.from(doc.querySelectorAll<HTMLElement>([
    "[role='alert']",
    "[class*='violation' i]",
    "[class*='error-message' i]",
    "[class*='error-info' i]",
    "[class*='danger' i]"
  ].join(",")));
  const candidates = [
    ...(root ? [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))] : []),
    ...preferred,
    ...Array.from(doc.querySelectorAll<HTMLElement>("body *"))
  ].filter((element, index, all) => all.indexOf(element) === index)
    .filter(isUsable)
    .map(readMultilineText)
    .map((text) => text.trim())
    .filter((text) => text.length > 0 && text.length <= 2_000)
    .filter((text) => /(?:^|\b)Line\s+\d+(?::\d+)?:|used but not defined|causing a compilation error|校验.*(?:错误|失败)/i.test(text))
    .sort((left, right) => left.length - right.length);
  return candidates[0]?.slice(0, 1_400) ?? "";
}

function readLeetcodeResultDetails(root: HTMLElement, verdict: string): string {
  const verdictText = normalize(verdict);
  return readMultilineText(root)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => normalize(line) !== verdictText)
    .filter((line) => !/^(?:执行用时|运行时间|内存消耗|占用内存|使用内存)\s*[:：]?/i.test(line))
    .filter((line) => !/^(?:提交|运行|控制台|测试结果)\s*$/i.test(line))
    .filter((line, index, all) => all.indexOf(line) === index)
    .join("\n")
    .slice(0, 1_400);
}

function readLuoguCompileFailure(doc: Document): SubmissionStatus | undefined {
  const pageText = normalize(doc.body?.textContent ?? "");
  if (!/(?:编译失败|编译错误|Compilation Error|Compile Error)/i.test(pageText)) return undefined;

  const preferred = Array.from(doc.querySelectorAll<HTMLElement>([
    "pre",
    "code",
    "textarea",
    "[class*='compile-info' i]",
    "[class*='compile-result' i]",
    "[class*='compiler' i]",
    "[class*='error-message' i]"
  ].join(","))).map(readMultilineText).filter(isUsefulCompilerOutput);
  const fallback = Array.from(doc.querySelectorAll<HTMLElement>("body *"))
    .map(readMultilineText)
    .filter((text) => text.length <= 20_000 && isUsefulCompilerOutput(text))
    .sort((left, right) => compilerOutputScore(right) - compilerOutputScore(left));
  const detail = cleanCompilerOutput(preferred[0] ?? fallback[0] ?? "");
  return {
    phase: "finished",
    status: detail ? `CE Compilation Error\n${detail.slice(0, 1_800)}` : "CE Compilation Error",
    success: false,
    allAccepted: false
  };
}

function readMultilineText(element: HTMLElement): string {
  return (element.innerText || element.textContent || "").replace(/\r/g, "").trim();
}

function isUsefulCompilerOutput(text: string): boolean {
  return text.length >= 8 && /(?:error|错误|undefined reference|compiler|collect2|ld:|executable)/i.test(text) &&
    !/^(?:编译失败|编译错误|Compilation Error|Compile Error)$/i.test(text.trim());
}

function compilerOutputScore(text: string): number {
  const keywords = text.match(/(?:error|错误|undefined reference|compiler|collect2|ld:|executable)/gi)?.length ?? 0;
  return keywords * 1_000 + Math.min(text.length, 5_000);
}

function cleanCompilerOutput(text: string): string {
  return text
    .replace(/^\s*(?:编译信息|编译失败|编译错误|编译出错|Compilation Error|Compile Error)\s*/i, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function classifySubmissionStatus(value: string): SubmissionStatus | undefined {
  const text = normalize(value);
  if (!text) return undefined;
  if (/(?:^AC$|\bAccepted\b|答案正确|全部通过|通过所有测试用例|执行通过|已通过|^通过(?:\s|$))/i.test(text)) {
    return { phase: "finished", status: extractVerdict(text), success: true };
  }
  if (/(?:^(?:WA|CE|RE|TLE|MLE|OLE|UKE|PC)$|Wrong Answer|答案错误|错误解答|违反限制|编译错误|编译出错|Compilation Error|Runtime Error|运行错误|执行出错|运行超时|超时|Time Limit|超出时间限制|内存超限|超出内存限制|Memory Limit|输出超限|超出输出限制|Presentation Error|段错误|系统错误|内部出错|Restrictions Failed|未通过|解答错误)/i.test(text)) {
    return { phase: "finished", status: extractVerdict(text), success: false };
  }
  if (/(?:Judging|Pending|Running|Compiling|评测中|判题中|等待评测|正在运行|运行中|提交中|校验中|校验完成|正在准备执行环境|正在编译代码|正在运行测试用例)/i.test(text)) {
    return { phase: "judging", status: extractVerdict(text) };
  }
  return undefined;
}

function readLuoguTestPoints(doc: Document): SubmissionStatus | undefined {
  const verdictElements = Array.from(doc.querySelectorAll<HTMLElement>("body *"))
    .filter((element) => !Array.from(element.children).some((child) =>
      /^(?:AC|WA|CE|RE|TLE|MLE|OLE|UKE|PC)$/.test(normalize(child.textContent ?? "").toUpperCase())))
    .filter((element) => /^(?:AC|WA|CE|RE|TLE|MLE|OLE|UKE|PC)$/.test(
      normalize(element.textContent ?? "").toUpperCase()
    ));
  if (verdictElements.length === 0) return undefined;
  const parsedPoints = verdictElements.map((element, index) => parseLuoguTestPoint(element, index + 1));
  const byId = new Map<string, TestPointResult>();
  for (const point of parsedPoints) {
    const existing = byId.get(point.id);
    if (!existing || point.time || point.memory) byId.set(point.id, point);
  }
  const testPoints = Array.from(byId.values()).sort((left, right) =>
    left.id.localeCompare(right.id, undefined, { numeric: true }));
  const verdicts = testPoints.map((point) => point.verdict);
  const failed = verdicts.find((verdict) => verdict !== "AC");
  if (failed) {
    return {
      phase: "finished",
      status: `${expandLuoguVerdict(failed)}（${verdicts.join(" / ")}）`,
      success: false,
      allAccepted: false,
      testPoints
    };
  }
  return {
    phase: "finished",
    status: `Accepted（${verdicts.length} 个测试点全部 AC）`,
    success: true,
    allAccepted: true,
    testPoints
  };
}

function parseLuoguTestPoint(verdictElement: HTMLElement, fallbackId: number): TestPointResult {
  const verdict = normalize(verdictElement.textContent ?? "").toUpperCase();
  let current: HTMLElement | null = verdictElement;
  let cardText = "";
  for (let depth = 0; current && depth < 7; depth++, current = current.parentElement) {
    const text = normalize(current.textContent ?? "");
    if (/#\s*\d+/.test(text) && /\d+(?:\.\d+)?\s*ms/i.test(text) && /\d+(?:\.\d+)?\s*(?:KB|MB|GB)/i.test(text)) {
      cardText = text;
      break;
    }
  }
  const id = cardText.match(/#\s*(\d+)/)?.[1] ?? String(fallbackId);
  const time = cardText.match(/(\d+(?:\.\d+)?\s*ms)/i)?.[1]?.replace(/\s+/g, "");
  const memory = cardText.match(/(\d+(?:\.\d+)?\s*(?:KB|MB|GB))/i)?.[1]?.replace(/\s+/g, "");
  return { id, verdict, time, memory };
}

function expandLuoguVerdict(verdict: string): string {
  return ({
    WA: "Wrong Answer",
    CE: "Compilation Error",
    RE: "Runtime Error",
    TLE: "Time Limit Exceeded",
    MLE: "Memory Limit Exceeded",
    OLE: "Output Limit Exceeded",
    UKE: "Unknown Error",
    PC: "Partially Correct"
  } as Record<string, string>)[verdict] ?? verdict;
}

function extractVerdict(text: string): string {
  const line = text.split(/\r?\n| {2,}/).map((item) => item.trim()).find(Boolean) ?? text;
  return line.slice(0, 500);
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function controlLabel(element: HTMLElement): string {
  const value = element instanceof HTMLInputElement ? element.value : "";
  return normalize(value || element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent || "");
}

function elementDepth(element: HTMLElement): number {
  let depth = 0;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) depth++;
  return depth;
}

function deepQueryAll<T extends Element>(root: ParentNode, selector: string): T[] {
  const roots: ParentNode[] = [root];
  const result: T[] = [];
  const seen = new Set<Element>();
  for (let index = 0; index < roots.length; index += 1) {
    const currentRoot = roots[index];
    for (const element of Array.from(currentRoot.querySelectorAll(selector))) {
      if (seen.has(element)) continue;
      seen.add(element);
      result.push(element as T);
    }
    for (const element of Array.from(currentRoot.querySelectorAll<HTMLElement>("*"))) {
      if (element.shadowRoot) roots.push(element.shadowRoot);
    }
  }
  return result;
}

function isUsable(element: HTMLElement): boolean {
  const disabled = element instanceof HTMLButtonElement || element instanceof HTMLInputElement
    ? element.disabled
    : element.getAttribute("aria-disabled") === "true";
  if (disabled) return false;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = current.getAttribute("style") ?? "";
    const computed = typeof getComputedStyle === "function" ? getComputedStyle(current) : undefined;
    if (current.hidden || current.getAttribute("aria-hidden") === "true" ||
      /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(style) ||
      computed?.display === "none" || computed?.visibility === "hidden" ||
      computed?.opacity === "0" || computed?.pointerEvents === "none") return false;
  }
  return true;
}
