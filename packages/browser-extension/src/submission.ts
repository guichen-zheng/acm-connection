import type { Site, SubmissionPhase } from "@algo-sync/shared";

export interface SubmissionStatus {
  phase: SubmissionPhase;
  status: string;
  success?: boolean;
}

const SUBMIT_LABELS: Record<Site, RegExp> = {
  luogu: /^(?:提交评测|提交代码|提交)$/i,
  nowcoder: /^(?:保存并提交|提交代码|提交)$/i,
  leetcode: /^(?:提交|submit)$/i,
  ybt: /(?:提交|submit)/i
};

const RESULT_SELECTORS: Record<Site, string[]> = {
  luogu: ["[class*='record-status']", "[class*='judge-status']", "[class*='result']", "[class*='status']"],
  nowcoder: ["[class*='result']", "[class*='judge']", "[class*='status']", ".result-status"],
  leetcode: [
    "[data-e2e-locator*='submission-result']",
    "[data-e2e-locator*='result']",
    "[data-cy*='result']",
    "[class*='submission-result']",
    "[class*='result']"
  ],
  ybt: ["#result", "#status", "[class*='result']", "[class*='status']", "body"]
};

export function findSubmitControl(site: Site, doc = document): HTMLElement | undefined {
  if (site === "leetcode") {
    const located = doc.querySelector<HTMLElement>(
      "[data-e2e-locator='console-submit-button'], [data-e2e-locator*='submit-button']"
    );
    if (located && isUsable(located)) return located;
  }
  const controls = Array.from(doc.querySelectorAll<HTMLElement>(
    "button, input[type='submit'], input[type='button'], [role='button']"
  ));
  return controls.find((control) => {
    const label = control instanceof HTMLInputElement
      ? control.value
      : control.textContent ?? control.getAttribute("aria-label") ?? "";
    return isUsable(control) && SUBMIT_LABELS[site].test(normalize(label));
  });
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

export function readSubmissionStatus(site: Site, doc = document): SubmissionStatus | undefined {
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

export function classifySubmissionStatus(value: string): SubmissionStatus | undefined {
  const text = normalize(value);
  if (!text) return undefined;
  if (/(?:\bAccepted\b|答案正确|全部通过|通过所有测试用例|执行通过|已通过|^通过(?:\s|$))/i.test(text)) {
    return { phase: "finished", status: extractVerdict(text), success: true };
  }
  if (/(?:Wrong Answer|答案错误|编译错误|Compilation Error|Runtime Error|运行错误|运行超时|Time Limit|超出时间限制|内存超限|Memory Limit|输出超限|Presentation Error|段错误|系统错误|未通过|解答错误)/i.test(text)) {
    return { phase: "finished", status: extractVerdict(text), success: false };
  }
  if (/(?:Judging|Pending|Running|Compiling|评测中|判题中|等待评测|正在运行|运行中|提交中)/i.test(text)) {
    return { phase: "judging", status: extractVerdict(text) };
  }
  return undefined;
}

function extractVerdict(text: string): string {
  const line = text.split(/\r?\n| {2,}/).map((item) => item.trim()).find(Boolean) ?? text;
  return line.slice(0, 500);
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isUsable(element: HTMLElement): boolean {
  const disabled = element instanceof HTMLButtonElement || element instanceof HTMLInputElement
    ? element.disabled
    : element.getAttribute("aria-disabled") === "true";
  return !disabled && !element.hidden;
}
