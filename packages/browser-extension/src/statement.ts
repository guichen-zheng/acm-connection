import type { Site } from "@algo-sync/shared";

const SITE_SELECTORS: Record<Site, string[]> = {
  luogu: [".problem-card", "article", "[class*='problem-content']", "main"],
  nowcoder: [".js-left .terminal-topic", ".subject-question", ".question-detail", ".terminal-topic"],
  leetcode: ["[data-track-load='description_content']", "[data-cy='question-content']", "article", "main"],
  ybt: ["#problem", ".problem", "body"]
};

const BLOCKED_TAGS = new Set([
  "script", "style", "iframe", "object", "embed", "form", "input", "textarea", "select",
  "option", "link", "meta", "noscript", "template", "canvas", "svg"
]);

export function extractStatementMarkdown(
  site: Site,
  doc = document,
  pageUrl = window.location.href
): string | undefined {
  // Luogu exposes the authoring Markdown in its hydration state. Prefer it so
  // formulas, code fences and links do not have to be reconstructed from DOM.
  if (site === "luogu") {
    const originalMarkdown = extractLuoguContext(doc);
    if (originalMarkdown) return originalMarkdown;
  }
  const root = SITE_SELECTORS[site]
    .map((selector) => doc.querySelector(selector))
    .find((element) => (element?.textContent?.trim().length ?? 0) >= 20);
  if (!root) return undefined;

  const clone = root.cloneNode(true) as Element;
  // Read KaTeX before removing its visual layer. Some LeetCode pages omit the
  // MathML annotation, in which case katex-html is the only place that still
  // contains a base/subscript digit such as log₂.
  for (const katex of Array.from(clone.querySelectorAll<HTMLElement>(".katex"))) {
    const tex = katex.querySelector("annotation")?.textContent?.trim();
    const fallback = katex.getAttribute("aria-label")?.trim() || katex.textContent?.trim();
    const math = normalizeMathTex(tex || fallback || "");
    if (math) katex.replaceWith(doc.createTextNode(katex.closest("code") ? math : `$${math}$`));
  }
  if (site === "nowcoder") prepareNowcoderStatement(clone, doc);
  for (const unwanted of Array.from(clone.querySelectorAll([
    "nav", "header", "footer", "aside", "[role='navigation']", ".monaco-editor", ".CodeMirror", ".cm-editor",
    ".ace_editor", "[class*='code-editor']", ".code-copy-btn", ".js-clipboard", ".js-full-question",
    ".js-small-question", ".katex-html"
  ].join(",")))) unwanted.remove();
  let markdown = normalizeMarkdown(Array.from(clone.childNodes)
    .map((node) => nodeToMarkdown(node, pageUrl))
    .join(""));
  if (site === "nowcoder") markdown = normalizeNowcoderMarkdown(markdown);
  if (!markdown) return undefined;
  return markdown.length <= 900_000 ? markdown : `${markdown.slice(0, 300_000)}\n\n> 题面过长，内容已截断。`;
}

function extractLuoguContext(doc: Document): string | undefined {
  const raw = doc.querySelector<HTMLScriptElement>("#lentille-context")?.textContent;
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as {
      data?: {
        problem?: {
          content?: Record<string, unknown>;
          contenu?: Record<string, unknown>;
          samples?: unknown;
        };
      };
    };
    const problem = parsed.data?.problem;
    if (!problem) return undefined;
    const content = problem.content ?? problem.contenu;
    if (!content) return undefined;
    const sections: string[] = [];
    const append = (title: string, value: unknown, fenced = false) => {
      if (typeof value !== "string" || !value.trim()) return;
      sections.push(`## ${title}\n\n${fenced ? fencedCode(value.trim()) : value.trim()}`);
    };
    append("题目背景", content.background);
    append("题目描述", content.description);
    append("输入格式", content.formatI);
    append("输出格式", content.formatO);
    if (Array.isArray(problem.samples)) {
      problem.samples.forEach((sample, index) => {
        if (!Array.isArray(sample)) return;
        append(`样例 ${index + 1} 输入`, sample[0], true);
        append(`样例 ${index + 1} 输出`, sample[1], true);
      });
    }
    append("说明与提示", content.hint);
    return sections.length ? normalizeMarkdown(sections.join("\n\n")) : undefined;
  } catch {
    return undefined;
  }
}

function nodeToMarkdown(node: Node, pageUrl: string, listDepth = 0): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeInline(node.textContent ?? "");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();
  if (BLOCKED_TAGS.has(tag)) return "";
  if (tag === "table") return tableToMarkdown(element, pageUrl);
  if (tag === "pre") return `\n\n${fencedCode(textWithBreaks(element))}\n\n`;
  if (tag === "br") return "\n";
  if (tag === "hr") return "\n\n---\n\n";
  if (tag === "img") {
    const src = safeUrl(element.getAttribute("src"), pageUrl, true);
    return src ? `![${escapeLinkText(element.getAttribute("alt") ?? "图片")}](${src})` : "";
  }
  if (tag === "a") {
    const label = childrenToMarkdown(element, pageUrl, listDepth).trim();
    if (!label) return "";
    const href = safeUrl(element.getAttribute("href"), pageUrl, false);
    return href ? `[${label}](${href})` : label;
  }
  if (tag === "code") {
    const value = codeText(element);
    if (/[_^]\{[^}]+\}|\blog\s*\d+\s*\(/i.test(value)) return `$${toInlineMath(value)}$`;
    const fence = value.includes("`") ? "``" : "`";
    return `${fence}${value}${fence}`;
  }
  if (tag === "math") {
    const tex = element.querySelector("annotation")?.textContent?.trim() ?? element.textContent?.trim();
    return tex ? `$${tex}$` : "";
  }
  if (tag === "ul" || tag === "ol") {
    const ordered = tag === "ol";
    const items = Array.from(element.children).filter((child) => child.tagName.toLowerCase() === "li");
    return `\n${items.map((item, index) => {
      const prefix = ordered ? `${index + 1}. ` : "- ";
      const indent = "  ".repeat(listDepth);
      return `${indent}${prefix}${childrenToMarkdown(item as HTMLElement, pageUrl, listDepth + 1).trim()}`;
    }).join("\n")}\n`;
  }

  const children = childrenToMarkdown(element, pageUrl, listDepth);
  if (/^h[1-6]$/.test(tag)) return `\n\n${"#".repeat(Number(tag[1]))} ${children.trim()}\n\n`;
  if (tag === "blockquote") {
    return `\n\n${children.trim().split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
  }
  if (tag === "strong" || tag === "b") return `<strong>${children.trim()}</strong>`;
  if (tag === "em" || tag === "i") return `<em>${children.trim()}</em>`;
  if (tag === "s") return `~~${children.trim()}~~`;
  if (tag === "sub" || tag === "sup") return scriptToMarkdown(tag, element.textContent ?? "");
  if (["p", "div", "section", "article", "details", "summary"].includes(tag)) {
    return `\n\n${children.trim()}\n\n`;
  }
  return children;
}

function childrenToMarkdown(element: Element, pageUrl: string, listDepth: number): string {
  return Array.from(element.childNodes)
    .map((child) => nodeToMarkdown(child, pageUrl, listDepth))
    .reduce((result, part) => {
      // Adjacent **bold** and *italic* fragments otherwise collapse into an
      // ambiguous *** sequence such as **目标值***`target`*.
      const separator = result.endsWith("*") && part.startsWith("*") ? " " : "";
      return `${result}${separator}${part}`;
    }, "");
}

function tableToMarkdown(table: HTMLElement, pageUrl: string): string {
  const rows = Array.from(table.querySelectorAll("tr")).map((row) =>
    Array.from(row.querySelectorAll(":scope > th, :scope > td"))
      .map((cell) => childrenToMarkdown(cell, pageUrl, 0).trim().replace(/\|/g, "\\|").replace(/\s*\n\s*/g, "<br>"))
  ).filter((row) => row.length);
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => [...row, ...Array(width - row.length).fill("")]);
  const lines = [normalized[0], Array(width).fill("---"), ...normalized.slice(1)]
    .map((row) => `| ${row.join(" | ")} |`);
  return `\n\n${lines.join("\n")}\n\n`;
}

function fencedCode(value: string): string {
  const normalized = value.replace(/\r\n?/g, "\n").replace(/\n+$/g, "");
  const longest = Math.max(0, ...Array.from(normalized.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}\n${normalized}\n${fence}`;
}

function normalizeMarkdown(value: string): string {
  return value
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function prepareNowcoderStatement(root: Element, doc: Document): void {
  for (const source of Array.from(root.querySelectorAll<HTMLScriptElement>("script[type^='math/tex']"))) {
    const tex = normalizeMathTex(source.textContent ?? "");
    const rendered = source.previousElementSibling;
    const preview = rendered?.previousElementSibling;
    if (preview?.classList.contains("MathJax_Preview")) preview.remove();
    if (rendered?.classList.contains("MathJax")) {
      if (tex) rendered.replaceWith(doc.createTextNode(`$${tex}$`));
      else rendered.remove();
      source.remove();
    } else if (tex) {
      source.replaceWith(doc.createTextNode(`$${tex}$`));
    } else {
      source.remove();
    }
  }
  for (const math of Array.from(root.querySelectorAll<HTMLElement>("math"))) {
    const tex = normalizeMathTex(math.querySelector("annotation")?.textContent ?? math.textContent ?? "");
    if (tex) math.replaceWith(doc.createTextNode(`$${tex}$`));
  }
  for (const button of Array.from(root.querySelectorAll("button"))) button.remove();
  for (const image of Array.from(root.querySelectorAll<HTMLImageElement>("img"))) {
    const rawSource = image.getAttribute("src") || image.getAttribute("data-src") || "";
    if (!/(?:equation|latex|math|tex)/i.test(`${rawSource} ${image.className}`)) continue;
    let tex = "";
    try {
      tex = new URL(rawSource, "https://ac.nowcoder.com/").searchParams.get("tex") ?? "";
    } catch {
      // Fall back to the accessible label below.
    }
    tex ||= image.getAttribute("alt")?.trim() ?? "";
    tex = normalizeMathTex(tex);
    if (tex) image.replaceWith(doc.createTextNode(`$${tex}$`));
  }
  for (const pre of Array.from(root.querySelectorAll("pre"))) {
    const text = textWithBreaks(pre).trim();
    if (!/[\u3400-\u9fff]/u.test(text)) continue;
    const lines = text
      .replace(/([。；])(?=第[一二三四五六七八九十]+行)/g, "$1\n")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const replacement = doc.createElement("div");
    lines.forEach((line, index) => {
      if (index) replacement.append(doc.createElement("br"));
      replacement.append(doc.createTextNode(line));
    });
    pre.replaceWith(replacement);
  }
}

function normalizeMathTex(value: string): string {
  return value
    .trim()
    .replace(/\\\\(?=[A-Za-z])/g, "\\")
    .replace(/\\_/g, "_");
}

function normalizeNowcoderMarkdown(value: string): string {
  return value
    .replace(/^[ \t]+(?=(?:题号|时间限制|空间限制|64bit\s+IO\s+Format)\s*[:：])/gim, "")
    .replace(/^\s*链接\s*$/gim, "")
    .replace(/^示例\s*(\d+)\s*[:：]?$/gim, "## 示例 $1")
    .replace(/^##\s*(输入|输出)\s*$/gim, "<strong>$1</strong>")
    .replace(/\s*\\\[((?:"[^"\n]*"\s*,\s*)+"[^"\n]*")\\\]\s*/g, (_match, items: string) =>
      ` [${items.split(/\s*,\s*/).join(", ")}] `)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function textWithBreaks(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  for (const br of Array.from(clone.querySelectorAll("br"))) br.replaceWith(clone.ownerDocument.createTextNode("\n"));
  return clone.textContent ?? "";
}

function codeText(element: Element): string {
  return Array.from(element.childNodes).map((node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const child = node as Element;
    const tag = child.tagName.toLowerCase();
    const content = codeText(child);
    if (tag === "sup") return `^{${content}}`;
    if (tag === "sub") return `_{${content}}`;
    if (tag === "math") return child.querySelector("annotation")?.textContent?.trim() ?? content;
    return content;
  }).join("");
}

function toInlineMath(value: string): string {
  return value
    .replace(/\blog\s*(\d+)\s*(?=\()/gi, "\\log_{$1}")
    .replace(/\^([+-]?\w)/g, "^{$1}")
    .replace(/_([+-]?\w)/g, "_{$1}")
    .replace(/<=/g, "\\le")
    .replace(/>=/g, "\\ge");
}

function escapeInline(value: string): string {
  // Some judges leave Markdown emphasis (for example **进阶**) as a text
  // node. Keep asterisks meaningful instead of turning them into visible \*.
  const escapePlainText = (plain: string) => plain
    .replace(/([\\`_[\]])/g, "\\$1")
    // LeetCode sometimes ships Markdown emphasis as literal text inside its
    // HTML. Normalize both inner and outer spacing so it remains valid next to
    // Chinese characters.
    .replace(/\*\*\s*([^*\n]*?\S)\s*\*\*/g, " <strong>$1</strong> ");
  let result = "";
  let cursor = 0;
  for (const match of value.matchAll(/(\${1,2})([\s\S]*?)\1/g)) {
    const index = match.index ?? 0;
    result += escapePlainText(value.slice(cursor, index));
    result += match[0].replace(/\\_/g, "_");
    cursor = index + match[0].length;
  }
  return result + escapePlainText(value.slice(cursor));
}

function scriptToMarkdown(tag: "sub" | "sup", value: string): string {
  const source = value.trim();
  if (!source) return "";
  const superscript: Record<string, string> = {
    "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
    "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", "n": "ⁿ"
  };
  const subscript: Record<string, string> = {
    "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
    "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎", "i": "ᵢ", "j": "ⱼ", "n": "ₙ"
  };
  const mapping = tag === "sup" ? superscript : subscript;
  const converted = Array.from(source).map((character) => mapping[character]);
  if (converted.every((character) => character !== undefined)) return converted.join("");
  return `<${tag}>${escapeHtmlText(source)}</${tag}>`;
}

function escapeLinkText(value: string): string {
  return value.replace(/([\\\]])/g, "\\$1");
}

function escapeHtmlText(value: string): string {
  return value.replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]!);
}

function safeUrl(raw: string | null, pageUrl: string, allowImageData: boolean): string | undefined {
  if (!raw) return undefined;
  if (allowImageData && /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(raw)) return raw;
  try {
    const url = new URL(raw, pageUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
