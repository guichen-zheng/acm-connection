import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { SITES, type Site } from "@algo-sync/shared";

const DEFAULT_DIRECTORIES: Record<Site, string> = {
  luogu: "luogu",
  nowcoder: "nowcoder",
  leetcode: "leetcode",
  ybt: "ybt"
};

export interface CleanResult {
  site: Site;
  relativePath: string;
  removed: boolean;
}

export async function cleanSiteDirectories(
  workspaceRoot: string,
  config: Record<string, unknown>,
  selector: string
): Promise<CleanResult[]> {
  const requested = selector === "*" || selector.toLowerCase() === "all"
    ? [...SITES]
    : SITES.includes(selector.toLowerCase() as Site) ? [selector.toLowerCase() as Site] : [];
  if (requested.length === 0) {
    throw new Error(`只能清理 ${SITES.join("、")} 或 *，不能删除站点目录内部的路径`);
  }
  const solutionRoot = safeRelativeDirectory(config.solutionRoot, ".");
  const configured = isRecord(config.siteDirectories) ? config.siteDirectories : {};
  const seen = new Set<string>();
  const results: CleanResult[] = [];
  for (const site of requested) {
    const siteDirectory = safeRelativeDirectory(configured[site], DEFAULT_DIRECTORIES[site]);
    const relativePath = path.join(solutionRoot, siteDirectory);
    const target = path.resolve(workspaceRoot, relativePath);
    assertExactSiteTarget(workspaceRoot, target);
    const key = process.platform === "win32" ? target.toLowerCase() : target;
    if (seen.has(key)) continue;
    seen.add(key);
    let removed = true;
    try {
      await stat(target);
      await rm(target, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") removed = false;
      else throw error;
    }
    results.push({ site, relativePath: path.relative(workspaceRoot, target) || siteDirectory, removed });
  }
  return results;
}

export function normalizeProblemCode(value: string): string | undefined {
  const input = value.trim();
  if (/^(?:P|B|U|T|SP|UVA)\d+$/i.test(input)) return input.toUpperCase();
  if (/^CF\d+[A-Z]\d?$/i.test(input)) return input.toUpperCase();
  if (/^AT_[A-Z0-9_]+$/i.test(input)) return `AT_${input.slice(3).toLowerCase()}`;
  if (/^NC\d+$/i.test(input)) return input.toUpperCase();
  if (/^LC\d+$/i.test(input)) return input.toUpperCase();
  return undefined;
}

function safeRelativeDirectory(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (!normalized || path.posix.isAbsolute(normalized) || /^[a-z]:\//i.test(normalized) ||
    normalized.split("/").includes("..")) return fallback;
  return normalized;
}

function assertExactSiteTarget(workspaceRoot: string, target: string): void {
  const relative = path.relative(path.resolve(workspaceRoot), target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("清理目标不是工作空间内的独立站点目录，已拒绝删除");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
