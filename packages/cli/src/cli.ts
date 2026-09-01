import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import WebSocket from "ws";
import {
  CLI_ORIGIN,
  DEFAULT_PORT,
  PROTOCOL_VERSION,
  type CliToWorkspaceMessage,
  type CliUpdateMessage
} from "@algo-sync/shared";
import { formatUpdate, isFinalUpdate, normalizeSwitchLanguage } from "./core";
import { cleanSiteDirectories, normalizeProblemCode } from "./workspace";

const CLI_VERSION = "0.6.20";
const args = process.argv.slice(2);

void main().catch((error) => {
  console.error(`[错误] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  if (args.includes("--version") || args.includes("-v")) {
    console.log(CLI_VERSION);
    return;
  }
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printHelp(false);
    return;
  }
  if (args.length === 1 && args[0] === "push") {
    await sendWorkspaceCommand("cliPush", {}, 10 * 60_000 + 30_000);
    return;
  }
  if (args.length === 1 && args[0] === "refresh") {
    await sendWorkspaceCommand("cliRefresh", {}, 30_000);
    return;
  }
  if (args.length === 1 && args[0] === "remote") {
    await sendWorkspaceCommand("cliRemote", {}, 30_000);
    return;
  }
  if (args.length === 2 && args[0] === "switch") {
    const language = normalizeSwitchLanguage(args[1]);
    if (!language) throw new Error("不支持该语言；可用 python/python3/java/cpp/c++/c");
    await sendWorkspaceCommand("cliSwitch", { language }, 30_000);
    return;
  }
  if (args.length === 2 && args[0] === "fetch") {
    const problemCode = normalizeProblemCode(args[1]);
    if (!problemCode) throw new Error("不支持该题号；可用 P/B/U/T/CF/AT_/SP/UVA/NC/LC 开头的规定格式");
    await sendWorkspaceCommand("cliFetch", { problemCode }, 60_000);
    return;
  }
  if (args.length === 2 && args[0] === "clean") {
    await clean(args[1]);
    return;
  }
  if (args.length === 2 && args[0] === "_browser-refresh" && (args[1] === "edge" || args[1] === "chrome")) {
    await sendWorkspaceCommand("cliBrowserRefresh", { browser: args[1] }, 30_000);
    return;
  }
  printHelp(true);
}

async function clean(selector: string): Promise<void> {
  const marker = await findMarker(process.cwd());
  if (!marker) throw new Error("当前目录不在包含 .algo-sync.json 的工作空间中");
  const config = await readConfig(marker);
  const results = await cleanSiteDirectories(path.dirname(marker), config, selector);
  for (const result of results) {
    console.log(result.removed
      ? `[清理] 已删除 ${result.relativePath}`
      : `[清理] ${result.relativePath} 不存在，无需删除`);
  }
}

async function sendWorkspaceCommand(
  type: "cliPush" | "cliRefresh" | "cliFetch" | "cliBrowserRefresh" | "cliRemote" | "cliSwitch",
  extra: Record<string, unknown>,
  resultTimeoutMs: number
): Promise<void> {
  const cwd = process.cwd();
  const marker = await findMarker(cwd);
  if (!marker) throw new Error("当前目录不在包含 .algo-sync.json 的工作空间中");
  const config = await readConfig(marker);
  if (config.enabled === false) throw new Error("当前工作空间已禁用 Algo Sync");
  const configuredPort = typeof config.port === "number" && Number.isInteger(config.port) ? config.port : DEFAULT_PORT;
  const port = configuredPort >= DEFAULT_PORT && configuredPort <= DEFAULT_PORT + 9 ? configuredPort : DEFAULT_PORT;
  const requestId = randomUUID();

  await new Promise<void>((resolve) => {
    let settled = false;
    let opened = false;
    let lastLine = "";
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin: CLI_ORIGIN });
    const connectionTimer = setTimeout(() => finishError("连接 VS Code 超时，请确认已打开该 Algo Sync 工作空间"), 5_000);
    const resultTimer = setTimeout(() => finishError(type === "cliPush" ? "等待评测结果超时" : "等待操作完成超时"), resultTimeoutMs);

    socket.once("open", () => {
      opened = true;
      clearTimeout(connectionTimer);
      const message = { type, protocolVersion: PROTOCOL_VERSION, requestId, cwd, ...extra } as CliToWorkspaceMessage;
      socket.send(JSON.stringify(message));
    });
    socket.on("message", (data) => {
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(data.toString()) as Record<string, unknown>;
      } catch {
        finishError("VS Code 返回了无法解析的响应");
        return;
      }
      if (raw.type === "error") {
        finishError(typeof raw.message === "string" ? raw.message : "CLI 请求被拒绝");
        return;
      }
      if (raw.type !== "cliUpdate" || raw.protocolVersion !== PROTOCOL_VERSION || raw.requestId !== requestId) return;
      const message = raw as unknown as CliUpdateMessage;
      const line = formatUpdate(message, process.env.NO_COLOR === undefined && process.env.TERM !== "dumb");
      if (line !== lastLine) {
        console.log(line);
        lastLine = line;
      }
      if (message.phase === "attention") void focusBrowserWindow(message.problemId);
      if (isFinalUpdate(message)) {
        process.exitCode = message.success ? 0 : 1;
        finish();
      }
    });
    socket.once("unexpected-response", (_request, response) => {
      finishError(`连接被拒绝（HTTP ${response.statusCode}），请更新并重启 VS Code 扩展`);
    });
    socket.once("error", (error) => {
      if (!settled) finishError(opened ? error.message : "无法连接 VS Code，请确认已打开该 Algo Sync 工作空间");
    });
    socket.once("close", () => {
      if (!settled) finishError("与 VS Code 的连接在操作完成前断开");
    });

    function finish(): void {
      if (settled) return;
      settled = true;
      clearTimeout(connectionTimer);
      clearTimeout(resultTimer);
      socket.close();
      resolve();
    }

    function finishError(message: string): void {
      if (settled) return;
      console.error(`[错误] ${message}`);
      process.exitCode = 1;
      finish();
    }
  });
}

async function readConfig(marker: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(marker, "utf8")) as Record<string, unknown>;
  } catch {
    throw new Error(`无法读取工作空间配置 ${marker}`);
  }
}

async function focusBrowserWindow(problemId?: string): Promise<void> {
  if (process.platform !== "win32") return;
  const script = [
    `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class AlgoSyncFocus { [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); }'`,
    "$all = @(Get-Process -Name msedge,chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })",
    "$wanted = $env:ALGO_SYNC_FOCUS_PROBLEM",
    "$target = $all | Where-Object { $wanted -and $_.MainWindowTitle -like ('*' + $wanted + '*') } | Select-Object -First 1",
    "if (-not $target) { $target = $all | Sort-Object StartTime -Descending | Select-Object -First 1 }",
    "if ($target) { [AlgoSyncFocus]::ShowWindowAsync([IntPtr]$target.MainWindowHandle, 9) | Out-Null; (New-Object -ComObject WScript.Shell).AppActivate($target.Id) | Out-Null; [AlgoSyncFocus]::SetForegroundWindow([IntPtr]$target.MainWindowHandle) | Out-Null }"
  ].join("; ");
  await new Promise<void>((resolve) => {
    execFile("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-Command",
      script
    ], {
      windowsHide: true,
      env: { ...process.env, ALGO_SYNC_FOCUS_PROBLEM: problemId ?? "" }
    }, () => resolve());
  });
}

async function findMarker(start: string): Promise<string | undefined> {
  let current = path.resolve(start);
  while (true) {
    const candidate = path.join(current, ".algo-sync.json");
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Continue with the parent directory.
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function printHelp(invalid: boolean): void {
  const output = [
    `Algo Sync CLI ${CLI_VERSION}`,
    "",
    "用法:",
    "  acm push          提交浏览器当前题目的本地代码并等待评测结果",
    "  acm refresh       将当前题目的网页和本地代码恢复为初始模板",
    "  acm remote        显示浏览器中远程连接的题目",
    "  acm switch <语言> 切换活动题目的语言；支持 python/python3/java/cpp/c++/c",
    "  acm fetch <题号>  在已连接的浏览器中打开题目",
    "  acm clean <站点>  删除整个站点目录；站点可为 luogu/nowcoder/leetcode/ybt/*",
    "  edge refresh      刷新已连接的 Edge 当前页面",
    "  chrome refresh    刷新已连接的 Chrome 当前页面",
    "  acm --version     显示版本"
  ].join("\n");
  (invalid ? console.error : console.log)(output);
  if (invalid) process.exitCode = 2;
}
