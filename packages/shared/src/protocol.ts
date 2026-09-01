export const PROTOCOL_VERSION = 7 as const;
export const DEFAULT_PORT = 27121;
export const BROWSER_EXTENSION_ID = "bpbicpjghnomlgogenedfkflejaggmfo";
export const CLI_ORIGIN = "algo-sync-cli://local";

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
  initialCode?: string;
  statementMarkdown?: string;
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

export type SubmissionPhase = "preparing" | "attention" | "submitted" | "judging" | "finished" | "completed" | "error";

export interface TestPointResult {
  id: string;
  verdict: string;
  time?: string;
  memory?: string;
}

export interface SubmitCodeMessage {
  type: "submitCode";
  protocolVersion: number;
  requestId: string;
  tabId: number;
  site: Site;
  problemId: string;
  language: Language;
  code: string;
}

export interface SubmissionUpdateMessage {
  type: "submissionUpdate";
  protocolVersion: number;
  requestId: string;
  tabId: number;
  phase: SubmissionPhase;
  status: string;
  success?: boolean;
  allAccepted?: boolean;
  testPoints?: TestPointResult[];
}

export interface ResetCodeMessage extends Omit<SavedCodeMessage, "type"> {
  type: "resetCode";
  requestId: string;
}

export interface NavigateToProblemMessage {
  type: "navigateToProblem";
  protocolVersion: number;
  requestId: string;
  problemCode: string;
}

export interface ReloadPageMessage {
  type: "reloadPage";
  protocolVersion: number;
  requestId: string;
}

export interface BrowserActionResultMessage {
  type: "browserActionResult";
  protocolVersion: number;
  requestId: string;
  ok: boolean;
  message: string;
}

export interface RemoteProblemSummary {
  tabId: number;
  active: boolean;
  site: Site;
  problemId: string;
  title: string;
  language: Language;
  url: string;
}

export interface ListRemoteProblemsMessage {
  type: "listRemoteProblems";
  protocolVersion: number;
  requestId: string;
}

export interface RemoteProblemsResultMessage {
  type: "remoteProblemsResult";
  protocolVersion: number;
  requestId: string;
  problems: RemoteProblemSummary[];
}

export interface SwitchLanguageMessage {
  type: "switchLanguage";
  protocolVersion: number;
  requestId: string;
  tabId: number;
  site: Site;
  problemId: string;
  language: Language;
}

export interface CliPushMessage {
  type: "cliPush";
  protocolVersion: number;
  requestId: string;
  cwd: string;
}

export interface CliRefreshMessage {
  type: "cliRefresh";
  protocolVersion: number;
  requestId: string;
  cwd: string;
}

export interface CliFetchMessage {
  type: "cliFetch";
  protocolVersion: number;
  requestId: string;
  cwd: string;
  problemCode: string;
}

export interface CliBrowserRefreshMessage {
  type: "cliBrowserRefresh";
  protocolVersion: number;
  requestId: string;
  cwd: string;
  browser: "edge" | "chrome";
}

export interface CliRemoteMessage {
  type: "cliRemote";
  protocolVersion: number;
  requestId: string;
  cwd: string;
}

export interface CliSwitchMessage {
  type: "cliSwitch";
  protocolVersion: number;
  requestId: string;
  cwd: string;
  language: Language;
}

export interface CliUpdateMessage {
  type: "cliUpdate";
  protocolVersion: number;
  requestId: string;
  phase: SubmissionPhase;
  status: string;
  site?: Site;
  problemId?: string;
  language?: Language;
  success?: boolean;
  allAccepted?: boolean;
  testPoints?: TestPointResult[];
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
  | SubmissionUpdateMessage
  | BrowserActionResultMessage
  | RemoteProblemsResultMessage
  | PingMessage;

export type WorkspaceToBrowserMessage =
  | ReadyMessage
  | LocalFileReadyMessage
  | SavedCodeMessage
  | SubmitCodeMessage
  | ResetCodeMessage
  | NavigateToProblemMessage
  | ReloadPageMessage
  | ListRemoteProblemsMessage
  | SwitchLanguageMessage
  | ErrorMessage
  | PingMessage;

export type CliToWorkspaceMessage = CliPushMessage | CliRefreshMessage | CliFetchMessage | CliBrowserRefreshMessage |
  CliRemoteMessage | CliSwitchMessage | PingMessage;
export type WorkspaceToCliMessage = CliUpdateMessage | ErrorMessage | PingMessage;

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
    value.code.length <= 2_000_000 &&
    (value.initialCode === undefined ||
      (typeof value.initialCode === "string" && value.initialCode.length <= 2_000_000)) &&
    (value.statementMarkdown === undefined ||
      (typeof value.statementMarkdown === "string" && value.statementMarkdown.length <= 1_000_000))
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
  if (raw.type === "submissionUpdate") {
    return isRequestId(raw.requestId) && Number.isInteger(raw.tabId) && isSubmissionPhase(raw.phase) &&
      isBoundedText(raw.status, 2_000) && (raw.success === undefined || typeof raw.success === "boolean") &&
      (raw.allAccepted === undefined || typeof raw.allAccepted === "boolean") &&
      (raw.testPoints === undefined || isTestPointResults(raw.testPoints))
      ? (raw as unknown as SubmissionUpdateMessage)
      : undefined;
  }
  if (raw.type === "browserActionResult") {
    return isRequestId(raw.requestId) && typeof raw.ok === "boolean" && isBoundedText(raw.message, 2_000)
      ? (raw as unknown as BrowserActionResultMessage)
      : undefined;
  }
  if (raw.type === "remoteProblemsResult") {
    return isRequestId(raw.requestId) && Array.isArray(raw.problems) && raw.problems.length <= 200 &&
      raw.problems.every(isRemoteProblemSummary)
      ? (raw as unknown as RemoteProblemsResultMessage)
      : undefined;
  }
  if (raw.type === "ping" || raw.type === "pong") return raw as unknown as PingMessage;
  return undefined;
}

export function parseCliMessage(raw: unknown): CliToWorkspaceMessage | undefined {
  if (!isRecord(raw) || raw.protocolVersion !== PROTOCOL_VERSION || typeof raw.type !== "string") return undefined;
  if (raw.type === "cliPush" || raw.type === "cliRefresh" || raw.type === "cliRemote") {
    return isRequestId(raw.requestId) && isBoundedText(raw.cwd, 4_096)
      ? (raw as unknown as CliPushMessage | CliRefreshMessage | CliRemoteMessage)
      : undefined;
  }
  if (raw.type === "cliFetch") {
    return isRequestId(raw.requestId) && isBoundedText(raw.cwd, 4_096) && isBoundedText(raw.problemCode, 80)
      ? (raw as unknown as CliFetchMessage)
      : undefined;
  }
  if (raw.type === "cliBrowserRefresh") {
    return isRequestId(raw.requestId) && isBoundedText(raw.cwd, 4_096) &&
      (raw.browser === "edge" || raw.browser === "chrome")
      ? (raw as unknown as CliBrowserRefreshMessage)
      : undefined;
  }
  if (raw.type === "cliSwitch") {
    return isRequestId(raw.requestId) && isBoundedText(raw.cwd, 4_096) && isLanguage(raw.language)
      ? (raw as unknown as CliSwitchMessage)
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

function isBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{16,64}$/i.test(value);
}

function isSubmissionPhase(value: unknown): value is SubmissionPhase {
  return value === "preparing" || value === "attention" || value === "submitted" || value === "judging" ||
    value === "finished" || value === "completed" || value === "error";
}

function isTestPointResults(value: unknown): value is TestPointResult[] {
  return Array.isArray(value) && value.length <= 1_000 && value.every((point) => isRecord(point) &&
    isBoundedText(point.id, 32) && isBoundedText(point.verdict, 32) &&
    (point.time === undefined || isBoundedText(point.time, 64)) &&
    (point.memory === undefined || isBoundedText(point.memory, 64)));
}

function isRemoteProblemSummary(value: unknown): value is RemoteProblemSummary {
  return isRecord(value) && Number.isInteger(value.tabId) && typeof value.active === "boolean" &&
    isSite(value.site) && isSafeText(value.problemId, 160) && isSafeText(value.title, 300) &&
    isLanguage(value.language) && isHttpUrl(value.url);
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
