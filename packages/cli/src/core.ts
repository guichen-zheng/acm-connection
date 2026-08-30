import type { CliUpdateMessage } from "@algo-sync/shared";

export function formatUpdate(message: CliUpdateMessage): string {
  const label = message.phase === "preparing" ? "准备"
    : message.phase === "submitted" ? "已提交"
      : message.phase === "judging" ? "评测"
        : message.phase === "finished" && message.success ? "通过"
          : message.phase === "finished" ? "未通过"
            : "错误";
  const target = message.site && message.problemId && message.language
    ? ` ${message.site}/${message.problemId}/${message.language}`
    : "";
  return `[${label}]${target} ${message.status}`.trimEnd();
}

export function isFinalUpdate(message: CliUpdateMessage): boolean {
  return message.phase === "finished" || message.phase === "error";
}
