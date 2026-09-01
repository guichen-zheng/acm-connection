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
  python: /(?:python\s*3?|pypy\s*3?)/i,
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
    // ACM problem pages use a numeric route segment. Keep the match exact so
    // collection pages such as /acm/problem/list are never treated as problems.
    const match = url.pathname.match(/^\/acm\/problem\/(\d+)\/?$/);
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
  return normalizeLanguage(detectLanguageLabel(doc));
}

export function detectLanguageLabel(doc = document): string | undefined {
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
  const semanticCandidates = deepQueryAll<HTMLElement>(doc, selectors.join(","))
    .filter(isVisible)
    .map((element) => ({
      element,
      label: element instanceof HTMLInputElement
        ? element.value
        : textOf(element) || element.getAttribute("aria-label") || element.getAttribute("title") || ""
    }))
    .filter(({ label }) => label.length <= 100 && normalizeLanguage(label) !== undefined)
    .sort((left, right) =>
      languageControlPreference(left.element) - languageControlPreference(right.element) ||
      Number(isAdjacentToCodeEditor(right.element, doc)) - Number(isAdjacentToCodeEditor(left.element, doc)) ||
      elementDepth(right.element) - elementDepth(left.element));
  if (semanticCandidates[0]) return semanticCandidates[0].label;

  for (const select of deepQueryAll<HTMLSelectElement>(doc, "select").filter(isVisible)) {
    const options = Array.from(select.options).map((option) => option.textContent ?? "");
    if (options.filter((value) => normalizeLanguage(value)).length < 1) continue;
    const selected = select.selectedOptions[0]?.textContent ?? select.value;
    if (normalizeLanguage(selected)) return selected;
  }
  const nowcoderHeader = doc.querySelector(
    ".subject-eidt-header, .subject-edit-header, .subject-editor-header, #jsCodeEditor"
  );
  if (nowcoderHeader) {
    for (const element of Array.from(nowcoderHeader.querySelectorAll<HTMLElement>("input, button, span, div"))) {
      // Hidden dropdown options often contain every supported language. Only
      // inspect rendered controls so the selected compiler wins.
      if (!isVisible(element)) continue;
      const label = element instanceof HTMLInputElement
        ? element.value
        : element.children.length <= 2 ? textOf(element) : undefined;
      if (!label || label.length > 60) continue;
      if (normalizeLanguage(label)) return label;
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
  // Nowcoder's compiler picker is an Element UI Select. Its option components
  // stay mounted under this dedicated popper even while the menu is closed,
  // and the Vue click handler lives directly on each li. Clicking that exact
  // row once is both more reliable and less disruptive than synthesizing a
  // full pointer sequence through the selector and its animated popper.
  const mountedNowcoderOption = findMountedNowcoderLanguageOption(language, doc);
  if (mountedNowcoderOption) {
    mountedNowcoderOption.click();
    return true;
  }

  const nativeSelect = deepQueryAll<HTMLSelectElement>(doc, "select")
    .map((select) => {
      const option = Array.from(select.options)
      .map((item) => ({ item, score: languageOptionPreference(language, item.textContent ?? "") }))
      .filter(({ score }) => Number.isFinite(score))
      .sort((left, right) => left.score - right.score)[0]?.item;
      const supportedLanguages = new Set(Array.from(select.options)
        .map((item) => normalizeLanguage(item.textContent ?? ""))
        .filter((item): item is Language => item !== undefined)).size;
      return { select, option, supportedLanguages };
    })
    .filter((item): item is { select: HTMLSelectElement; option: HTMLOptionElement; supportedLanguages: number } =>
      item.option !== undefined)
    .sort((left, right) =>
      Number(!isAdjacentToCodeEditor(left.select, doc)) - Number(!isAdjacentToCodeEditor(right.select, doc)) ||
      Number(!isVisible(left.select)) - Number(!isVisible(right.select)) ||
      right.supportedLanguages - left.supportedLanguages)[0];
  if (nativeSelect) {
    // Luogu places a transparent native select over its styled compiler
    // button. It is intentionally invisible but still owns the real value and
    // change handler, so visibility must not exclude it from switching.
    const prototype = Object.getPrototypeOf(nativeSelect.select) as object;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(nativeSelect.select, nativeSelect.option.value);
    else nativeSelect.select.value = nativeSelect.option.value;
    nativeSelect.select.dispatchEvent(new Event("input", { bubbles: true }));
    nativeSelect.select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  // A previous attempt may have left the menu open. Select from it before
  // toggling the control, otherwise the first click would close the menu.
  const openOption = findOpenLanguageOption(language, doc);
  if (openOption) {
    activateLanguageElement(openOption);
    return true;
  }

  const semanticControls = deepQueryAll<HTMLElement>(doc, [
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
  ].join(",")).filter(isVisible);
  // Nowcoder does not mount its language menu until the compact compiler
  // label in the editor header is clicked. Some releases give that label no
  // combobox role or stable select class, so find exact language labels inside
  // the known editor-header containers as explicit trigger candidates.
  const nowcoderHeaderControls = deepQueryAll<HTMLElement>(doc, [
    ".subject-eidt-header *",
    ".subject-edit-header *",
    ".subject-editor-header *",
    "#jsCodeEditor > [class*='header'] *",
    "#jsCodeEditor [class*='toolbar'] *"
  ].join(","))
    .filter(isVisible)
    .filter((element) => {
      const label = elementLabel(element);
      return label.length <= 60 && normalizeLanguage(label) !== undefined;
    })
    .sort((left, right) => elementDepth(right) - elementDepth(left));
  const editorAdjacentControls = deepQueryAll<HTMLElement>(doc, "button, [role='button'], div, span, input")
    .filter(isVisible)
    .filter((element) => {
      const label = elementLabel(element);
      return label.length <= 60 && normalizeLanguage(label) !== undefined && isAdjacentToCodeEditor(element, doc);
    })
    .sort((left, right) => elementDepth(right) - elementDepth(left));
  // LeetCode's current editor renders this trigger as an otherwise unmarked
  // plain button whose complete label is just the selected language (for
  // example "C++"). Include exact language-labelled buttons without making
  // arbitrary buttons or language names in the statement clickable.
  const languageButtons = deepQueryAll<HTMLButtonElement>(doc, "button")
    .filter(isVisible)
    .filter((button) => {
      const label = elementLabel(button);
      return label.length <= 40 && normalizeLanguage(label) !== undefined;
    });
  const controls = Array.from(new Set([
    ...nowcoderHeaderControls,
    ...editorAdjacentControls,
    ...semanticControls,
    ...languageButtons
  ]));
  for (const control of controls) {
    const visibleBefore = new Set(visibleLanguageCandidates(doc).map((item) => item.element));
    activateLanguageElement(control);
    // LeetCode mounts this popover through React after the click. Do not click
    // the selector again while it is still being mounted, since that closes it.
    const option = await waitForLanguageOption(language, doc, visibleBefore);
    if (option) {
      activateLanguageElement(option);
      return true;
    }
  }
  return false;
}

function isAdjacentToCodeEditor(element: HTMLElement, doc: Document): boolean {
  let current: HTMLElement | null = element;
  for (let level = 0; current && level < 8; level += 1, current = parentElementAcrossShadow(current)) {
    if (current.querySelector(".monaco-editor, .cm-editor, .CodeMirror, .ace_editor")) return true;
  }
  const editor = doc.querySelector<HTMLElement>(".monaco-editor, .cm-editor, .CodeMirror, .ace_editor");
  if (!editor) return false;
  const controlRect = element.getBoundingClientRect();
  const editorRect = editor.getBoundingClientRect();
  if (controlRect.width === 0 || controlRect.height === 0 || editorRect.width === 0 || editorRect.height === 0) return false;
  const overlapsHorizontally = controlRect.right >= editorRect.left && controlRect.left <= editorRect.right;
  return overlapsHorizontally && controlRect.bottom <= editorRect.top + 80 && editorRect.top - controlRect.bottom < 250;
}

function activateLanguageElement(element: HTMLElement): void {
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
  const pointerEvent = element.ownerDocument.defaultView?.PointerEvent;
  element.dispatchEvent(pointerEvent
    ? new pointerEvent("pointerdown", { ...init, pointerType: "mouse", isPrimary: true })
    : new MouseEvent("pointerdown", init));
  element.dispatchEvent(new MouseEvent("mousedown", init));
  element.focus();
  element.dispatchEvent(pointerEvent
    ? new pointerEvent("pointerup", { ...init, buttons: 0, pointerType: "mouse", isPrimary: true })
    : new MouseEvent("pointerup", { ...init, buttons: 0 }));
  element.dispatchEvent(new MouseEvent("mouseup", { ...init, buttons: 0 }));
  element.click();
}

export function describeVisibleLanguageOptions(doc = document): string[] {
  const nativeOptions = deepQueryAll<HTMLSelectElement>(doc, "select")
    .flatMap((select) => Array.from(select.options))
    .map((option) => (option.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter((label) => normalizeLanguage(label) !== undefined);
  return Array.from(new Set([
    ...visibleLanguageCandidates(doc).map((item) => item.label),
    ...nativeOptions
  ]));
}

async function waitForLanguageOption(
  language: Language,
  doc: Document,
  visibleBefore: Set<HTMLElement>,
  timeoutMilliseconds = 2_000
): Promise<HTMLElement | undefined> {
  const deadline = Date.now() + timeoutMilliseconds;
  do {
    const nowcoderOption = findMountedNowcoderLanguageOption(language, doc);
    if (nowcoderOption) return nowcoderOption;
    const options = deepQueryAll<HTMLElement>(doc,
      "[role='option'], [role='menuitem'], .ant-select-item-option, li")
      .filter(isVisible)
      .filter(isHitTestVisible);
    const semanticOption = options
      .map((item) => ({ item, score: languageOptionPreference(language, elementLabel(item)) }))
      .filter(({ score }) => Number.isFinite(score))
      .sort((left, right) => left.score - right.score)[0]?.item;
    const option = semanticOption ?? findOpenLanguageOption(language, doc, visibleBefore);
    if (option) return resolveLanguageOptionTarget(option);
    await delay(100);
  } while (Date.now() < deadline);
  return undefined;
}

function findMountedNowcoderLanguageOption(language: Language, doc: Document): HTMLElement | undefined {
  if (!doc.querySelector("#jsCodeEditor, .subject-eidt-box, .subject-edit-box, .btn-language")) return undefined;
  return Array.from(doc.querySelectorAll<HTMLElement>(
    ".language-select .el-select-dropdown__item"
  ))
    .map((item, index) => ({
      item,
      index,
      score: languageOptionPreference(language, elementLabel(item))
    }))
    .filter(({ item, score }) => !item.classList.contains("is-disabled") && Number.isFinite(score))
    .sort((left, right) =>
      left.score - right.score ||
      Number(!isVisible(left.item)) - Number(!isVisible(right.item)) ||
      right.index - left.index)[0]?.item;
}

function findOpenLanguageOption(
  language: Language,
  doc: Document,
  visibleBefore?: Set<HTMLElement>
): HTMLElement | undefined {
  const candidates = visibleLanguageCandidates(doc).filter((item) => isHitTestVisible(item.element));
  const menuCandidates = candidates;
  // A single visible language is normally just the closed selector. Two or
  // more hit-testable languages indicate that a dropdown/popover is open.
  // Closed popovers frequently remain mounted in the page DOM, so node
  // identity alone cannot tell whether the menu opened.
  if (new Set(menuCandidates.map((item) => item.language)).size < 2) return undefined;
  return menuCandidates
    .filter((item) => item.language === language && Number.isFinite(languageOptionPreference(language, item.label)))
    .sort((left, right) =>
      Number(visibleBefore?.has(left.element) ?? false) - Number(visibleBefore?.has(right.element) ?? false) ||
      languageOptionPreference(language, left.label) - languageOptionPreference(language, right.label) ||
      elementDepth(right.element) - elementDepth(left.element))
    .map((item) => resolveLanguageOptionTarget(item.element))[0];
}

function visibleLanguageCandidates(doc: Document): Array<{
  element: HTMLElement;
  label: string;
  language: Language;
}> {
  return deepQueryAll<HTMLElement>(doc,
    "[role='option'], [role='menuitem'], .ant-select-item-option, li, button, span, div, input")
    .filter(isVisible)
    .map((element) => ({ element, label: elementLabel(element) }))
    .filter(({ label }) => label.length > 0 && label.length <= 40)
    .map(({ element, label }) => ({ element, label, language: normalizeLanguage(label) }))
    .filter((item): item is { element: HTMLElement; label: string; language: Language } => item.language !== undefined);
}

function elementLabel(element: HTMLElement): string {
  return (element instanceof HTMLInputElement ? element.value : element.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function languageControlPreference(element: HTMLElement): number {
  if (element.matches("[role='combobox'], [aria-expanded], button[data-e2e-locator*='lang'], button[data-cy*='lang']")) return 0;
  if (element.matches("input[readonly], .ant-select-selection-item, [class*='select-view-value'], [class*='select-selection'], [class*='select-value']")) return 1;
  if (element.getAttribute("aria-selected") === "true" || /(?:^|[-_ ])(?:selected|active)(?:$|[-_ ])/i.test(element.className)) return 2;
  return 3;
}

function resolveLanguageOptionTarget(element: HTMLElement): HTMLElement {
  return element.closest<HTMLElement>(
    "[role='option'], [role='menuitem'], li, .ant-select-item-option, [class*='menu-item'], [class*='dropdown-item'], [class*='select-item']"
  ) ?? element;
}

function isHitTestVisible(element: HTMLElement): boolean {
  const doc = element.ownerDocument;
  if (typeof doc.elementFromPoint !== "function") return true;
  const rect = element.getBoundingClientRect();
  const view = doc.defaultView;
  if (!view || rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 ||
    rect.left >= view.innerWidth || rect.top >= view.innerHeight) return false;
  const x = Math.max(0, Math.min(view.innerWidth - 1, rect.left + rect.width / 2));
  const y = Math.max(0, Math.min(view.innerHeight - 1, rect.top + rect.height / 2));
  const hit = doc.elementFromPoint(x, y);
  if (!(hit instanceof Element)) return false;
  if (hit === element || element.contains(hit) || hit.contains(element)) return true;
  for (let current: Element | null = hit; current; ) {
    const root = current.getRootNode();
    if (!("host" in root) || !(root.host instanceof Element)) break;
    if (root.host === element || element.contains(root.host)) return true;
    current = root.host;
  }
  return false;
}

function deepQueryAll<T extends Element>(doc: Document, selector: string): T[] {
  const roots: ParentNode[] = [doc];
  const result: T[] = [];
  const seen = new Set<Element>();
  for (let index = 0; index < roots.length; index += 1) {
    const root = roots[index];
    for (const element of Array.from(root.querySelectorAll(selector))) {
      if (!seen.has(element)) {
        seen.add(element);
        result.push(element as T);
      }
    }
    for (const element of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
      if (element.shadowRoot) roots.push(element.shadowRoot);
    }
  }
  return result;
}

function languageOptionPreference(language: Language, label: string): number {
  const normalized = label.replace(/（/g, "(").replace(/\s+/g, " ").trim();
  if (!LANGUAGE_LABELS[language].test(normalized)) return Number.POSITIVE_INFINITY;
  if (language === "cpp") return /clang\+\+\s*18/i.test(normalized) ? 0 : 1;
  if (language !== "python") return 0;
  if (/^python\s*3(?:\b|\s|\()/i.test(normalized)) return 0;
  if (/^pypy\s*3(?:\b|\s|\()/i.test(normalized)) return 1;
  if (/^(?:python|pypy)\s*2(?:\b|\s|\()/i.test(normalized)) return Number.POSITIVE_INFINITY;
  if (/^python(?:\s|$|\()/i.test(normalized)) return 2;
  if (/^pypy(?:\s|$|\()/i.test(normalized)) return 3;
  return Number.POSITIVE_INFINITY;
}

function elementDepth(element: HTMLElement): number {
  let depth = 0;
  for (let current: HTMLElement | null = element; current; current = parentElementAcrossShadow(current)) depth += 1;
  return depth;
}

function identity(site: Site, problemId: string, title: string, url: URL): ProblemIdentity {
  const cleanUrl = new URL(url);
  cleanUrl.searchParams.delete("algo_sync_fetch");
  return {
    site,
    problemId: decodeURIComponent(problemId).trim(),
    title: cleanTitle(title, problemId),
    url: cleanUrl.href
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
  for (let current: HTMLElement | null = element; current; current = parentElementAcrossShadow(current)) {
    const style = getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden" || current.hidden ||
      current.getAttribute("aria-hidden") === "true" || (style.opacity !== "" && Number(style.opacity) === 0) ||
      style.pointerEvents === "none") return false;
  }
  // JSDOM has no layout engine and reports zero for every rectangle. In an
  // actual browser, a mounted-but-closed dropdown normally has no client rect
  // or a zero-size rect and must not be treated as an open menu.
  const doc = element.ownerDocument;
  if (doc.documentElement.clientWidth > 0 || doc.documentElement.clientHeight > 0) {
    const rects = element.getClientRects();
    const rect = element.getBoundingClientRect();
    if (rects.length === 0 || rect.width <= 0 || rect.height <= 0) return false;
  }
  return true;
}

function parentElementAcrossShadow(element: HTMLElement): HTMLElement | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return "host" in root && root.host instanceof HTMLElement ? root.host : null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
