import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import WebSocket from "ws";
import {
  CLI_ORIGIN,
  DEFAULT_PORT,
  PROTOCOL_VERSION,
  type CliUpdateMessage
} from "@algo-sync/shared";
import { formatUpdate, isFinalUpdate } from "./core";

const CLI_VERSION = "0.4.0";
const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-v")) {
  console.log(CLI_VERSION);
} else if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  printHelp(false);
} else if (args.length !== 1 || args[0] !== "push") {
  printHelp(args.length > 0);
} else {
  void push().catch((error) => {
    console.error(`[错误] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

async function push(): Promise<void> {
  const cwd = process.cwd();
  const marker = await findMarker(cwd);
  if (!marker) throw new Error("当前目录不在包含 .algo-sync.json 的工作空间中");
  const config = JSON.parse(await readFile(marker, "utf8")) as Record<string, unknown>;
  if (config.enabled === false) throw new Error("当前工作空间已禁用 Algo Sync");
  const configuredPort = typeof config.port === "number" && Number.isInteger(config.port) ? config.port : DEFAULT_PORT;
  const port = configuredPort >= DEFAULT_PORT && configuredPort <= DEFAULT_PORT + 9 ? configuredPort : DEFAULT_PORT;
  const requestId = randomUUID();

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let opened = false;
    let lastLine = "";
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin: CLI_ORIGIN });
    const connectionTimer = setTimeout(() => finishError("连接 VS Code 超时，请确认已打开该 Algo Sync 工作空间"), 5_000);
    const resultTimer = setTimeout(() => finishError("等待评测结果超时"), 10 * 60_000 + 30_000);

    socket.once("open", () => {
      opened = true;
      clearTimeout(connectionTimer);
      socket.send(JSON.stringify({ type: "cliPush", protocolVersion: PROTOCOL_VERSION, requestId, cwd }));
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
      const line = formatUpdate(message);
      if (line !== lastLine) {
        console.log(line);
        lastLine = line;
      }
      if (isFinalUpdate(message)) {
        process.exitCode = message.phase === "finished" && message.success ? 0 : 1;
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
      if (!settled) finishError("与 VS Code 的连接在评测完成前断开");
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
    "Algo Sync CLI 0.4.0",
    "",
    "用法:",
    "  acm push       提交浏览器当前题目的本地代码并等待评测结果",
    "  acm --version  显示版本"
  ].join("\n");
  (invalid ? console.error : console.log)(output);
  if (invalid) process.exitCode = 2;
}
