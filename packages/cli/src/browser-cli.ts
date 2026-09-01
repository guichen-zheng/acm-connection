import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const executable = path.basename(process.argv[1] ?? "").toLowerCase();
const browser = executable.startsWith("edge") ? "edge" : "chrome";
const args = process.argv.slice(2);

if (args.length !== 1 || args[0] !== "refresh") {
  console.error(`用法: ${browser} refresh`);
  process.exitCode = 2;
} else {
  const result = spawnSync(process.execPath, [path.join(__dirname, "acm.cjs"), "_browser-refresh", browser], {
    stdio: "inherit"
  });
  process.exitCode = result.status ?? 1;
}
