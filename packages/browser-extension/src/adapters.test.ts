// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  canCreateWithoutReadableEditor,
  detectLanguage,
  detectProblem,
  isEditorDomPresent,
  languageWithSiteFallback,
  normalizeLanguage,
  switchLanguage
} from "./adapters";

describe("site adapters", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "<head><title></title></head><body></body>";
  });

  it.each([
    ["https://www.luogu.com.cn/problem/P1002", "<h1>P1002 过河卒</h1>", "luogu", "P1002", "过河卒"],
    ["https://ac.nowcoder.com/acm/problem/14682", "<h1>快速幂</h1>", "nowcoder", "14682", "快速幂"],
    ["https://ac.nowcoder.com/acm/problem/233601", "<div>题号：NC233601</div>", "nowcoder", "NC233601", "哈夫曼编码"],
    ["https://leetcode.cn/problems/two-sum/description/", "<div data-cy='question-title'>1. 两数之和</div>", "leetcode", "1", "两数之和"],
    ["http://ybt.ssoier.cn:8088/problem_show.php?pid=1205", "<h2>1205 汉诺塔问题</h2>", "ybt", "1205", "汉诺塔问题"]
  ])("recognizes %s", (url, html, site, id, title) => {
    if (url.includes("233601")) document.title = "哈夫曼编码";
    document.body.innerHTML = html;
    expect(detectProblem(url)).toMatchObject({ site, problemId: id, title });
  });

  it("recognizes Nowcoder practice UUID links", () => {
    document.body.innerHTML = "<h1>数组中的逆序对</h1>";
    expect(detectProblem("https://www.nowcoder.com/practice/38ae72379d42471db1c537914b06d48e?tpId=230"))
      .toMatchObject({ site: "nowcoder", problemId: "38ae72379d42471db1c537914b06d48e" });
  });

  it.each([
    ["GNU C++17", "cpp"], ["C++（clang++18）", "cpp"], ["C", "c"], ["Python3", "python"], ["Java 17", "java"],
    ["Node.js", "javascript"], ["Golang", "go"], ["Rust 1.70", "rust"]
  ])("normalizes %s", (label, expected) => {
    expect(normalizeLanguage(label)).toBe(expected);
  });

  it("detects and switches a native language select", async () => {
    document.body.innerHTML = "<select><option value='py' selected>Python3</option><option value='cpp'>GNU C++17</option></select>";
    expect(detectLanguage()).toBe("python");
    expect(await switchLanguage("cpp")).toBe(true);
    expect(detectLanguage()).toBe("cpp");
  });

  it("detects the current Nowcoder compiler label", () => {
    document.body.innerHTML = "<div class='select-view-value'>C++（clang++18）</div>";
    expect(detectLanguage()).toBe("cpp");
  });

  it("detects a Nowcoder compiler stored in a readonly input", () => {
    document.body.innerHTML = "<div id='jsCodeEditor'><input readonly value='Java 17'></div>";
    expect(detectLanguage()).toBe("java");
  });

  it("treats a directly embedded Nowcoder Monaco container as an IDE", () => {
    document.body.innerHTML = "<div class='monaco-editor'><div class='overflow-guard'></div></div>";
    expect(isEditorDomPresent()).toBe(true);
  });

  it("allows a Nowcoder problem URL to create an empty default-language file without editor internals", () => {
    expect(canCreateWithoutReadableEditor("nowcoder")).toBe(true);
    expect(languageWithSiteFallback("nowcoder", undefined, "cpp")).toBe("cpp");
    expect(canCreateWithoutReadableEditor("luogu")).toBe(false);
    expect(languageWithSiteFallback("luogu", undefined, "cpp")).toBeUndefined();
  });
});
