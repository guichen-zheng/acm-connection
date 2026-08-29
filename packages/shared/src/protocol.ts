export const PROTOCOL_VERSION = 1 as const;
export const DEFAULT_PORT = 27121;
export const BROWSER_EXTENSION_ID = "bpbicpjghnomlgogenedfkflejaggmfo";

export const SITES = ["luogu", "nowcoder", "leetcode", "ybt"] as const;
export type Site = (typeof SITES)[number];

export const LANGUAGE_EXTENSIONS = {
  cpp: ".cpp",
  c: ".c",
  python: ".py",
  java: ".java",
  javascript: ".js",
  go: ".go",
  rust: ".rs"
} as const;

export type Language = keyof typeof LANGUAGE_EXTENSIONS;
export const LANGUAGES = Object.keys(LANGUAGE_EXTENSIONS) as Language[];

export interface ProblemContext {
  site: Site;
  problemId: string;
  title: string;
  url: string;
  language: Language;
  code: string;
}

export interface HelloMessage {
  type: "hello";
  protocolVersion: number;
  extensionVersion: string;
  browser: string;
}

export interface ReadyMessage {
  type: "ready";
  protocolVersion: number;
  workspaceName: string;
  defaultLanguage: Language;
}

export interface ActiveEditorChangedMessage {
  type: "activeEditorChanged";
  protocolVersion: number;
  tabId: number;
  context: ProblemContext;
}

export interface LocalFileReadyMessage {
  type: "localFileReady";
  protocolVersion: number;
  tabId: number;
  relativePath: string;
  created: boolean;
}

export interface SavedCodeMessage {
  type: "savedCode";
  protocolVersion: number;
  tabId: number;
  site: Site;
  problemId: string;
  language: Language;
  code: string;
}

export interface ApplyResultMessage {
  type: "applyResult";
  protocolVersion: number;
  tabId: number;
  ok: boolean;
  message?: string;
}

export interface ErrorMessage {
  type: "error";
  protocolVersion: number;
  code: string;
  message: string;
}

export interface PingMessage {
  type: "ping" | "pong";
  protocolVersion: number;
}

export type BrowserToWorkspaceMessage =
  | HelloMessage
  | ActiveEditorChangedMessage
  | ApplyResultMessage
  | PingMessage;

export type WorkspaceToBrowserMessage =
  | ReadyMessage
  | LocalFileReadyMessage
  | SavedCodeMessage
  | ErrorMessage
  | PingMessage;

export function isSite(value: unknown): value is Site {
  return typeof value === "string" && (SITES as readonly string[]).includes(value);
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

export function isProblemContext(value: unknown): value is ProblemContext {
  if (!isRecord(value)) return false;
  return (
    isSite(value.site) &&
    isSafeText(value.problemId, 160) &&
    isSafeText(value.title, 300) &&
    isHttpUrl(value.url) &&
    isLanguage(value.language) &&
    typeof value.code === "string" &&
    value.code.length <= 2_000_000
  );
}

export function parseBrowserMessage(raw: unknown): BrowserToWorkspaceMessage | undefined {
  if (!isRecord(raw) || raw.protocolVersion !== PROTOCOL_VERSION || typeof raw.type !== "string") {
    return undefined;
  }
  if (raw.type === "hello") {
    return typeof raw.extensionVersion === "string" && typeof raw.browser === "string"
      ? (raw as unknown as HelloMessage)
      : undefined;
  }
  if (raw.type === "activeEditorChanged") {
    return Number.isInteger(raw.tabId) && isProblemContext(raw.context)
      ? (raw as unknown as ActiveEditorChangedMessage)
      : undefined;
  }
  if (raw.type === "applyResult") {
    return Number.isInteger(raw.tabId) && typeof raw.ok === "boolean" &&
      (raw.message === undefined || typeof raw.message === "string")
      ? (raw as unknown as ApplyResultMessage)
      : undefined;
  }
  if (raw.type === "ping" || raw.type === "pong") return raw as unknown as PingMessage;
  return undefined;
}

export function problemKey(context: Pick<ProblemContext, "site" | "problemId" | "language">): string {
  return `${context.site}:${context.problemId}:${context.language}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
