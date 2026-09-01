// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  isMarkedFetchTabUrl,
  isPotentialProblemUrl,
  markFetchTabUrl,
  problemCodeMatchesContext,
  problemDestination,
  resolveProblemUrl
} from "./navigation";

describe("problem navigation", () => {
  it.each([
    ["P1001", "https://www.luogu.com.cn/problem/P1001#ide"],
    ["B2001", "https://www.luogu.com.cn/problem/B2001#ide"],
    ["U12345", "https://www.luogu.com.cn/problem/U12345#ide"],
    ["T12345", "https://www.luogu.com.cn/problem/T12345#ide"],
    ["CF2001A", "https://www.luogu.com.cn/problem/CF2001A#ide"],
    ["AT_abc001_1", "https://www.luogu.com.cn/problem/AT_abc001_1#ide"],
    ["SP1", "https://www.luogu.com.cn/problem/SP1#ide"],
    ["UVA100", "https://www.luogu.com.cn/problem/UVA100#ide"],
    ["NC233601", "https://ac.nowcoder.com/acm/problem/233601"]
  ])("maps %s to its canonical URL", (code, url) => {
    expect(problemDestination(code)?.url).toBe(url);
  });

  it("resolves an LC number through LeetCode's public problem list", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({
      stat_status_pairs: [{ stat: { frontend_question_id: "1", question__title_slug: "two-sum" } }]
    }), { status: 200 }));
    await expect(resolveProblemUrl("LC1", request as typeof fetch))
      .resolves.toBe("https://leetcode.cn/problems/two-sum/");
    expect(request).toHaveBeenCalledWith("https://leetcode.cn/api/problems/all/", { credentials: "omit" });
  });

  it("returns undefined for unsupported or missing codes", async () => {
    expect(problemDestination("ABC123")).toBeUndefined();
    const request = vi.fn(async () => new Response(JSON.stringify({
      stat_status_pairs: []
    }), { status: 200 }));
    await expect(resolveProblemUrl("LC999999", request as typeof fetch)).resolves.toBeUndefined();
  });

  it("marks a dedicated fetch tab without losing Luogu IDE mode", () => {
    const url = markFetchTabUrl("https://www.luogu.com.cn/problem/P1001#ide");
    expect(url).toBe("https://www.luogu.com.cn/problem/P1001?algo_sync_fetch=1#ide");
    expect(isMarkedFetchTabUrl(url)).toBe(true);
    expect(isMarkedFetchTabUrl("https://www.luogu.com.cn/problem/P1001#ide")).toBe(false);
  });

  it.each([
    ["P1001", "luogu", "P1001"],
    ["AT_ABC001_1", "luogu", "AT_abc001_1"],
    ["NC233601", "nowcoder", "NC233601"],
    ["NC233601", "nowcoder", "233601"],
    ["LC34", "leetcode", "34"]
  ] as const)("matches fetched code %s to the detected browser context", (code, site, problemId) => {
    expect(problemCodeMatchesContext(code, site, problemId)).toBe(true);
  });

  it("rejects a stale context from the previous fetch navigation", () => {
    expect(problemCodeMatchesContext("P1001", "luogu", "P1025")).toBe(false);
    expect(problemCodeMatchesContext("NC233601", "luogu", "NC233601")).toBe(false);
  });

  it.each([
    "https://www.luogu.com.cn/problem/P1001?algo_sync_fetch=1#ide",
    "https://ac.nowcoder.com/acm/problem/233601",
    "https://www.nowcoder.com/practice/38ae72379d42471db1c537914b06d48e",
    "https://leetcode.cn/problems/two-sum/description/",
    "http://ybt.ssoier.cn:8088/problem_show.php?pid=1205"
  ])("recognizes a possible problem tab %s", (url) => {
    expect(isPotentialProblemUrl(url)).toBe(true);
  });

  it.each([
    "https://www.luogu.com.cn/problem/list",
    "https://ac.nowcoder.com/acm/problem/list",
    "https://leetcode.cn/problemset/"
  ])("does not wait for a problem collection tab %s", (url) => {
    expect(isPotentialProblemUrl(url)).toBe(false);
  });
});
