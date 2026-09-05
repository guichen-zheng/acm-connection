import type { CliUpdateMessage, Language } from "@algo-sync/shared";

const COLORS = {
  green: 32,
  red: 31,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36
} as const;

export function normalizeSwitchLanguage(value: string): Language | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "c++" || normalized === "cpp") return "cpp";
  if (normalized === "python3") return "python";
  if (normalized === "python" || normalized === "java" || normalized === "c") return normalized;
  return undefined;
}

export function formatUpdate(message: CliUpdateMessage, useColor = true): string {
  const target = message.site && message.problemId && message.language
    ? ` ${message.site}/${message.problemId}/${message.language}`
    : "";
  if (message.phase === "finished" && message.allAccepted) {
    return paint(`[通过]${target} all subtask accepted`.trimEnd(), "green", useColor);
  }
  if (message.phase === "finished" && message.testPoints?.length) {
    const heading = `${paint("[未通过]", "red", useColor)}${target}`.trimEnd();
    return [heading, ...message.testPoints.map((point) => formatTestPoint(point, useColor))].join("\n");
  }
  if (message.phase === "finished" && /^(?:CE\b|Compilation Error|Compile Error)/i.test(message.status)) {
    const [summary, ...detail] = message.status.split(/\r?\n/);
    const description = summary.replace(/^CE\s*/i, "").trim() || "Compilation Error";
    const heading = `${paint("[未通过]", "red", useColor)}${target} ${paint("CE", "yellow", useColor)} ${description}`.trimEnd();
    return [heading, ...detail].join("\n");
  }
  const label = message.phase === "preparing" ? paint("[准备]", "cyan", useColor)
    : message.phase === "attention" ? paint("[注意]", "yellow", useColor)
      : message.phase === "submitted" ? paint("[已提交]", "cyan", useColor)
        : message.phase === "judging" ? paint("[评测]", "yellow", useColor)
          : message.phase === "completed" && message.success ? paint("[完成]", "green", useColor)
            : message.phase === "completed" ? paint("[错误]", "red", useColor)
              : message.phase === "finished" && message.success ? paint("[通过]", "green", useColor)
                : message.phase === "finished" ? paint("[未通过]", "red", useColor)
                  : paint("[错误]", "red", useColor);
  return `${label}${target} ${message.status}`.trimEnd();
}

export function isFinalUpdate(message: CliUpdateMessage): boolean {
  return message.phase === "finished" || message.phase === "completed" || message.phase === "error";
}

function formatTestPoint(point: NonNullable<CliUpdateMessage["testPoints"]>[number], useColor: boolean): string {
  const verdict = point.verdict.toUpperCase();
  const padding = " ".repeat(Math.max(1, 6 - verdict.length));
  const metrics = point.time || point.memory
    ? `${point.time ?? "-"}/${point.memory ?? "-"}`
    : "";
  const detail = point.detail ? ` · ${point.detail.replace(/\s+/g, " ").trim()}` : "";
  return `[#${point.id}] ${paint(verdict, verdictColor(verdict), useColor)}${padding}${metrics}${detail}`.trimEnd();
}

function verdictColor(verdict: string): keyof typeof COLORS {
  if (verdict === "AC") return "green";
  if (verdict === "WA") return "red";
  if (verdict === "TLE" || verdict === "MLE") return "blue";
  if (verdict === "RE" || verdict === "UKE") return "magenta";
  if (verdict === "CE" || verdict === "PC") return "yellow";
  return "cyan";
}

function paint(value: string, color: keyof typeof COLORS, enabled: boolean): string {
  return enabled ? `\u001b[${COLORS[color]}m${value}\u001b[0m` : value;
}
