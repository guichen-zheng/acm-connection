import path from "node:path";
import process from "node:process";
import { execFileSync, spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("无法定位 npm CLI，请使用 npm run install:cli 执行此脚本");

run(repoRoot, ["run", "build", "--workspace", "@algo-sync/cli"]);
run(path.join(repoRoot, "packages/cli"), ["link"]);
if (process.platform === "win32") {
  const globalPrefix = execFileSync(process.execPath, [npmCli, "prefix", "--global"], { encoding: "utf8" }).trim();
  // If PowerShell's execution policy blocks npm's .ps1 shim, command lookup
  // can still use the equivalent .cmd launcher without changing user policy.
  await rm(path.join(globalPrefix, "acm.ps1"), { force: true });
}

function run(cwd, args) {
  const result = spawnSync(process.execPath, [npmCli, ...args], { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
