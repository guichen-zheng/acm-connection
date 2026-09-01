import type { Site } from "@algo-sync/shared";

export interface ProblemDestination {
  code: string;
  url?: string;
  needsLeetCodeLookup: boolean;
}

export const FETCH_TAB_MARKER = "algo_sync_fetch";

export function markFetchTabUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.searchParams.set(FETCH_TAB_MARKER, "1");
  return url.toString();
}

export function isMarkedFetchTabUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  try {
    return new URL(rawUrl).searchParams.get(FETCH_TAB_MARKER) === "1";
  } catch {
    return false;
  }
}

export function isPotentialProblemUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    if (url.hostname === "www.luogu.com.cn") {
      const match = url.pathname.match(/^\/problem\/([^/]+)\/?$/i);
      const destination = match ? problemDestination(decodeURIComponent(match[1])) : undefined;
      return destination?.url?.startsWith("https://www.luogu.com.cn/problem/") === true;
    }
    if (url.hostname === "ac.nowcoder.com") return /^\/acm\/problem\/\d+\/?$/i.test(url.pathname);
    if (url.hostname === "www.nowcoder.com") return /^\/practice\/[a-z0-9]+\/?$/i.test(url.pathname);
    if (url.hostname === "leetcode.cn") return /^\/problems\/[^/]+(?:\/description)?\/?$/i.test(url.pathname);
    if (url.hostname === "ybt.ssoier.cn") return /\/problem_show\.php$/i.test(url.pathname) && url.searchParams.has("pid");
    return false;
  } catch {
    return false;
  }
}

export function luoguIdeUrlForProblem(rawUrl: string | undefined, problemId: string): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl);
    const match = url.hostname === "www.luogu.com.cn"
      ? url.pathname.match(/^\/problem\/([^/]+)\/?$/i)
      : undefined;
    if (!match || decodeURIComponent(match[1]).toLowerCase() !== problemId.trim().toLowerCase()) return undefined;
    url.hash = "ide";
    return url.toString();
  } catch {
    return undefined;
  }
}

export function luoguRecordId(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl);
    const match = url.hostname === "www.luogu.com.cn"
      ? url.pathname.match(/^\/record\/(\d+)\/?$/i)
      : undefined;
    return match?.[1];
  } catch {
    return undefined;
  }
}

export function findLuoguProblemIdeLinkInPage(problemId: string): string | undefined {
  const expected = problemId.trim().toLowerCase();
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    try {
      const url = new URL(anchor.getAttribute("href")!, location.href);
      const match = url.hostname === "www.luogu.com.cn"
        ? url.pathname.match(/^\/problem\/([^/]+)\/?$/i)
        : undefined;
      if (!match || decodeURIComponent(match[1]).toLowerCase() !== expected) continue;
      url.hash = "ide";
      return url.toString();
    } catch {
      // Ignore malformed links and continue looking for the exact problem.
    }
  }
  return undefined;
}

export function problemCodeMatchesContext(rawCode: string, site: Site, problemId: string): boolean {
  const destination = problemDestination(rawCode);
  if (!destination) return false;
  const code = destination.code;
  const normalizedProblemId = problemId.trim();
  if (code.startsWith("LC")) {
    return site === "leetcode" && normalizedProblemId === code.slice(2);
  }
  if (code.startsWith("NC")) {
    return site === "nowcoder" &&
      (normalizedProblemId.toUpperCase() === code || normalizedProblemId === code.slice(2));
  }
  return site === "luogu" && normalizedProblemId.toLowerCase() === code.toLowerCase();
}

export function problemDestination(rawCode: string): ProblemDestination | undefined {
  const input = rawCode.trim();
  if (/^(?:P|B|U|T|SP|UVA)\d+$/i.test(input) || /^CF\d+[A-Z]\d?$/i.test(input)) {
    const code = input.toUpperCase();
    return { code, url: `https://www.luogu.com.cn/problem/${encodeURIComponent(code)}#ide`, needsLeetCodeLookup: false };
  }
  if (/^AT_[A-Z0-9_]+$/i.test(input)) {
    const code = `AT_${input.slice(3).toLowerCase()}`;
    return { code, url: `https://www.luogu.com.cn/problem/${encodeURIComponent(code)}#ide`, needsLeetCodeLookup: false };
  }
  if (/^NC\d+$/i.test(input)) {
    const code = input.toUpperCase();
    return {
      code,
      url: `https://ac.nowcoder.com/acm/problem/${code.slice(2)}`,
      needsLeetCodeLookup: false
    };
  }
  if (/^LC\d+$/i.test(input)) {
    return { code: input.toUpperCase(), needsLeetCodeLookup: true };
  }
  return undefined;
}

export async function resolveProblemUrl(
  rawCode: string,
  request: typeof fetch = fetch
): Promise<string | undefined> {
  const destination = problemDestination(rawCode);
  if (!destination) return undefined;
  if (destination.url) return destination.url;
  const number = destination.code.slice(2);
  const response = await request("https://leetcode.cn/api/problems/all/", { credentials: "omit" });
  if (!response.ok) throw new Error(`力扣题号查询失败（HTTP ${response.status}）`);
  const payload = await response.json() as {
    stat_status_pairs?: Array<{
      stat?: { frontend_question_id?: string | number; question__title_slug?: string };
    }>;
  };
  const match = (payload.stat_status_pairs ?? []).find((item) =>
    String(item.stat?.frontend_question_id ?? "") === number && item.stat?.question__title_slug);
  const slug = match?.stat?.question__title_slug;
  return slug ? `https://leetcode.cn/problems/${encodeURIComponent(slug)}/` : undefined;
}
