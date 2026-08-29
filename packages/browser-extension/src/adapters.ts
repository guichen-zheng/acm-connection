import type { Language, Site } from "@algo-sync/shared";

export interface ProblemIdentity {
  site: Site;
  problemId: string;
  title: string;
  url: string;
}

const LANGUAGE_ALIASES: Array<[Language, RegExp]> = [
  ["cpp", /^(?:c\+\+|cpp|g\+\+|gnu\s*c\+\+|clang\s*c\+\+)(?:\s*\d.*|\s*[（(].*)?$/i],
  ["javascript", /^(?:javascript|java\s*script|node(?:\.js)?|js)(?:\s*\d.*|\s*[（(].*)?$/i],
  ["python", /^(?:python|python3|py|pypy|pypy3)(?:\s*\d.*|\s*[（(].*)?$/i],
  ["java", /^java(?:\s*\d.*|\s*[（(].*)?$/i],
  ["rust", /^rust(?:\s*\d.*|\s*[（(].*)?$/i],
  ["go", /^(?:go|golang)(?:\s*\d.*|\s*[（(].*)?$/i],
  ["c", /^(?:c|gnu\s*c|clang\s*c)(?:\s*\d.*|\s*[（(].*)?$/i]
];

const LANGUAGE_LABELS: Record<Language, RegExp> = {
  cpp: /(?:c\+\+|cpp|g\+\+|gnu\s*c\+\+)/i,
  c: /^(?:c|gnu\s*c|clang\s*c)(?:\s*\d.*)?$/i,
  python: /(?:python3?|pypy3?)/i,
  java: /^java(?:\s*\d.*)?$/i,
  javascript: /(?:javascript|node(?:\.js)?|^js$)/i,
  go: /(?:^go$|golang)/i,
  rust: /^rust/i
};

export function normalizeLanguage(label: string | null | undefined): Language | undefined {
  if (!label) return undefined;
  const normalized = label.replace(/\s+/g, " ").trim();
  return LANGUAGE_ALIASES.find(([, pattern]) => pattern.test(normalized))?.[0];
}

export function detectProblem(locationUrl = window.location.href, doc = document): ProblemIdentity | undefined {
  const url = new URL(locationUrl);
  if (url.hostname === "www.luogu.com.cn") {
    const match = url.pathname.match(/^\/problem\/([^/?#]+)/);
    if (!match) return undefined;
    return identity("luogu", match[1], titleFrom(doc, ["h1", ".lfe-h1", "title"], match[1]), url);
  }
  if (url.hostname === "ac.nowcoder.com") {
    const match = url.pathname.match(/^\/acm\/problem\/([^/?#]+)/);
    if (!match) return undefined;
    const displayedId = (doc.body.textContent ?? "").match(/题号\s*[:：]\s*([A-Z]{1,8}\d+)/i)?.[1];
    return identity(
      "nowcoder",
      displayedId ?? match[1],
      titleFrom(doc, [".question-title", ".problem-title", "title", "h1"], displayedId ?? match[1]),
      url
    );
  }
  if (url.hostname === "www.nowcoder.com") {
    const match = url.pathname.match(/^\/practice\/([^/?#]+)/);
    if (!match) return undefined;
    const visibleNumber = textOf(doc.querySelector("[class*='question-title'], h1"))?.match(/(?:题号|编号)[:：]?\s*([\w-]+)/)?.[1];
    return identity("nowcoder", visibleNumber ?? match[1], titleFrom(doc, ["h1", "[class*='question-title']", "title"], match[1]), url);
  }
  if (url.hostname === "leetcode.cn") {
    const match = url.pathname.match(/^\/problems\/([^/?#]+)/);
    if (!match) return undefined;
    const rawTitle = titleFrom(doc, ["[data-cy='question-title']", "[class*='text-title-large']", "h1", "title"], match[1]);
    const numbered = rawTitle.match(/^\s*(\d+)\s*[.、]\s*(.+)$/);
    return identity("leetcode", numbered?.[1] ?? match[1], numbered?.[2] ?? rawTitle, url);
  }
  if (url.hostname === "ybt.ssoier.cn") {
    const problemId = url.searchParams.get("pid") ?? url.searchParams.get("id");
    if (!problemId || !/(?:problem_show|submit)\.php$/i.test(url.pathname)) return undefined;
    return identity("ybt", problemId, titleFrom(doc, ["h1", "h2", ".problem_title", "title"], problemId), url);
  }
  return undefined;
}

export function detectLanguage(doc = document): Language | undefined {
  for (const select of Array.from(doc.querySelectorAll("select"))) {
    const options = Array.from(select.options).map((option) => option.textContent ?? "");
    if (options.filter((value) => normalizeLanguage(value)).length < 1) continue;
    const selected = select.selectedOptions[0]?.textContent ?? select.value;
    const language = normalizeLanguage(selected);
    if (language) return language;
  }
  const selectors = [
    "[data-e2e-locator*='lang']",
    "[data-cy*='lang']",
    "[aria-label*='language' i]",
    "[class*='language-select']",
    "[class*='lang-select']",
    ".ant-select-selection-item",
    "[class*='select-view-value']",
    "[class*='select-selection']",
    "[class*='select-value']",
    "[class*='compiler']",
    "[role='combobox']",
    "#jsCodeEditor input[readonly]",
    "#jsCodeEditor [class*='lang'] input"
  ];
  for (const element of Array.from(doc.querySelectorAll(selectors.join(",")))) {
    const inputValue = element instanceof HTMLInputElement ? element.value : undefined;
    const label = inputValue || textOf(element) || element.getAttribute("aria-label") || element.getAttribute("title");
    if (label && label.length > 100) continue;
    const language = normalizeLanguage(label);
    if (language) return language;
  }
  const nowcoderHeader = doc.querySelector(".subject-eidt-header, #jsCodeEditor");
  if (nowcoderHeader) {
    for (const element of Array.from(nowcoderHeader.querySelectorAll<HTMLElement>("input, button, span, div"))) {
      // Hidden dropdown options often contain every supported language. Only
      // inspect rendered controls so the selected compiler wins.
      if (element.getClientRects().length === 0) continue;
      const label = element instanceof HTMLInputElement
        ? element.value
        : element.children.length <= 2 ? textOf(element) : undefined;
      if (!label || label.length > 60) continue;
      const language = normalizeLanguage(label);
      if (language) return language;
    }
  }
  return undefined;
}

export function isEditorDomPresent(doc = document): boolean {
  return doc.querySelector(
    ".monaco-editor, .cm-editor, .CodeMirror, .ace_editor, [data-mode-id], textarea[class*='editor'], textarea[name*='code']"
  ) !== null;
}

export function canCreateWithoutReadableEditor(site: Site): boolean {
  return site === "nowcoder";
}

export function languageWithSiteFallback(
  site: Site,
  detected: Language | undefined,
  defaultLanguage: Language
): Language | undefined {
  return detected ?? (site === "nowcoder" ? defaultLanguage : undefined);
}

export async function switchLanguage(language: Language, doc = document): Promise<boolean> {
  const wanted = LANGUAGE_LABELS[language];
  for (const select of Array.from(doc.querySelectorAll("select"))) {
    const option = Array.from(select.options).find((item) => wanted.test((item.textContent ?? "").trim()));
    if (!option) continue;
    select.value = option.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  const controls = Array.from(doc.querySelectorAll<HTMLElement>([
    "[data-e2e-locator*='lang']",
    "[data-cy*='lang']",
    "[aria-label*='language' i]",
    "[class*='language-select']",
    "[class*='lang-select']",
    ".ant-select-selector",
    "[class*='select-view']",
    "[class*='select-selection']",
    "[class*='select-value']",
    "[class*='compiler']",
    "[role='combobox']"
  ].join(","))).filter(isVisible);
  for (const control of controls) {
    control.click();
    await delay(150);
    const options = Array.from(doc.querySelectorAll<HTMLElement>(
      "[role='option'], [role='menuitem'], .ant-select-item-option, li"
    )).filter(isVisible);
    const option = options.find((item) => wanted.test((item.textContent ?? "").trim()));
    if (option) {
      option.click();
      return true;
    }
  }
  return false;
}

function identity(site: Site, problemId: string, title: string, url: URL): ProblemIdentity {
  return {
    site,
    problemId: decodeURIComponent(problemId).trim(),
    title: cleanTitle(title, problemId),
    url: url.href
  };
}

function titleFrom(doc: Document, selectors: string[], fallback: string): string {
  for (const selector of selectors) {
    const value = selector === "title" ? doc.title : textOf(doc.querySelector(selector));
    if (value?.trim()) return value.trim();
  }
  return fallback;
}

function cleanTitle(value: string, problemId: string): string {
  return value
    .replace(new RegExp(`^\\s*${escapeRegex(problemId)}\\s*[-—:：.、]?\\s*`, "i"), "")
    .replace(/\s*[-|_]\s*(洛谷|牛客网?|力扣|LeetCode|信息学奥赛一本通).*$/i, "")
    .trim() || problemId;
}

function textOf(element: Element | null): string | undefined {
  return element?.textContent?.replace(/\s+/g, " ").trim();
}

function isVisible(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && !element.hidden;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
