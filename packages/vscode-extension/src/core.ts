import path from "node:path";
import { LANGUAGE_EXTENSIONS, type Language, type ProblemContext, type Site } from "@algo-sync/shared";

export interface WorkspaceConfig {
  enabled: boolean;
  port: number;
  solutionRoot: string;
  defaultLanguage: Language;
  statementPreview: boolean;
  siteDirectories: Record<Site, string>;
}

export const DEFAULT_SITE_DIRECTORIES: Record<Site, string> = {
  luogu: "luogu",
  nowcoder: "nowcoder",
  leetcode: "leetcode",
  ybt: "ybt"
};

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function sanitizePathPart(input: string, fallback: string, maxLength = 100): string {
  let value = input
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-+/g, "-")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, maxLength)
    .replace(/[. ]+$/g, "");
  if (!value) value = fallback;
  if (WINDOWS_RESERVED.test(value)) value = `_${value}`;
  return value;
}

export function solutionFilename(problemId: string, title: string, language: Language): string {
  const safeId = sanitizePathPart(problemId, "problem", 80);
  const safeTitle = sanitizePathPart(title, "untitled", 100);
  return `${safeId}-${safeTitle}${LANGUAGE_EXTENSIONS[language]}`;
}

export function problemDirectoryName(problemId: string, title: string): string {
  const safeId = sanitizePathPart(problemId, "problem", 80);
  const safeTitle = sanitizePathPart(title, "untitled", 100);
  return `${safeId}-${safeTitle}`;
}

export const STATEMENT_FILENAME = "题目.md";
export const GENERATED_START = "<!-- algo-sync:generated:start -->";
export const GENERATED_END = "<!-- algo-sync:generated:end -->";

export function generatedStatementBlock(context: ProblemContext): string {
  const title = `${context.problemId} · ${context.title}`.replace(/[\r\n]+/g, " ").trim();
  const source = context.url.replace(/[\s<>]/g, "");
  const statement = context.statementMarkdown?.trim() || "> 尚未从网页读取到题面，请保持题目网页打开并等待加载。";
  return [
    GENERATED_START,
    `# ${title}`,
    "",
    `> 来源：${context.site} · [在浏览器中打开原题](${source})`,
    "",
    statement,
    GENERATED_END
  ].join("\n");
}

export function mergeStatementMarkdown(existing: string, context: ProblemContext): string {
  const generated = generatedStatementBlock(context);
  const start = existing.indexOf(GENERATED_START);
  const end = existing.indexOf(GENERATED_END, start + GENERATED_START.length);
  if (start >= 0 && end >= start) {
    const after = end + GENERATED_END.length;
    const remainder = removeLegacyNotesHeading(existing.slice(after));
    return `${existing.slice(0, start)}${generated}${remainder}`;
  }
  if (!existing.trim()) return `${generated}\n`;
  return `${generated}\n\n${existing}`;
}

function removeLegacyNotesHeading(value: string): string {
  const withoutHeading = value.replace(/^\s*## 个人笔记[ \t]*(?:\r?\n|$)/, "");
  if (withoutHeading !== value) return withoutHeading.trim() ? `\n\n${withoutHeading.trimStart()}` : "\n";
  return value;
}

export function existingFilePrefix(problemId: string): string {
  return `${sanitizePathPart(problemId, "problem", 80)}-`;
}

export function normalizeRelativeDirectory(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (path.posix.isAbsolute(normalized) || /^[a-zA-Z]:\//.test(normalized) || normalized.split("/").includes("..")) return fallback;
  return normalized || fallback;
}

export function sameFile(left: string, right: string, platform = process.platform): boolean {
  const normalize = (value: string) => path.resolve(value).replace(/\\/g, "/");
  const a = normalize(left);
  const b = normalize(right);
  return platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function shouldSyncSavedFile(savedPath: string, activePath: string | undefined, platform = process.platform): boolean {
  return activePath !== undefined && sameFile(savedPath, activePath, platform);
}
