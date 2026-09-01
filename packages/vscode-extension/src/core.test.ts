import { describe, expect, it } from "vitest";
import {
  GENERATED_END,
  GENERATED_START,
  existingFilePrefix,
  formatRemoteProblems,
  isStatementPreviewTab,
  mergeStatementMarkdown,
  normalizeRelativeDirectory,
  problemDirectoryName,
  resolveInitialTemplate,
  sameFile,
  shouldDispatchLanguageSwitch,
  shouldSyncSavedFile,
  solutionFilename
} from "./core";

describe("workspace file rules", () => {
  it("formats active and background remote problems", () => {
    expect(formatRemoteProblems([{
      tabId: 7,
      active: true,
      site: "leetcode",
      problemId: "34",
      title: "在排序数组中查找元素的第一个和最后一个位置",
      language: "python",
      url: "https://leetcode.cn/problems/find-first-and-last-position-of-element-in-sorted-array/"
    }, {
      tabId: 9,
      active: false,
      site: "luogu",
      problemId: "P1115",
      title: "最大子段和",
      language: "cpp",
      url: "https://www.luogu.com.cn/problem/P1115"
    }], "Edge")).toContain("* leetcode/34/python");
  });

  it("recognizes statement previews without matching unrelated webviews", () => {
    expect(isStatementPreviewTab("markdown-preview-enhanced", "Preview 题目.md")).toBe(true);
    expect(isStatementPreviewTab("markdown.preview", "题目.md 预览")).toBe(true);
    expect(isStatementPreviewTab("markdown-preview-enhanced", "Preview README.md")).toBe(false);
    expect(isStatementPreviewTab("terminal", "题目.md")).toBe(false);
  });

  it("sanitizes a Windows-incompatible title", () => {
    expect(solutionFilename("P1002", "A/B: C?*", "cpp")).toBe("P1002-A-B- C-.cpp");
  });

  it("uses stable problem identifiers as the lookup prefix", () => {
    expect(existingFilePrefix("P1002")).toBe("P1002-");
    expect(problemDirectoryName("P1002", "A/B: C?*")).toBe("P1002-A-B- C-");
  });

  it.each([
    ["cpp", ".cpp"],
    ["c", ".c"],
    ["python", ".py"],
    ["java", ".java"],
    ["javascript", ".js"],
    ["go", ".go"],
    ["rust", ".rs"]
  ] as const)("places %s solutions in the same problem directory", (language, extension) => {
    expect(problemDirectoryName("P1002", "过河卒")).toBe("P1002-过河卒");
    expect(solutionFilename("P1002", "过河卒", language)).toBe(`P1002-过河卒${extension}`);
  });

  it("updates only the generated statement region", () => {
    const context = {
      site: "luogu" as const,
      problemId: "P1002",
      title: "过河卒",
      url: "https://www.luogu.com.cn/problem/P1002",
      language: "cpp" as const,
      code: "",
      statementMarkdown: "## 题目描述\n\n新版题面"
    };
    const first = mergeStatementMarkdown("", context);
    const withNotes = `${first}\n## 个人笔记\n\n我的笔记：动态规划`;
    const updated = mergeStatementMarkdown(withNotes, { ...context, statementMarkdown: "## 题目描述\n\n再次更新" });
    expect(updated).toContain("再次更新");
    expect(updated).not.toContain("新版题面");
    expect(updated).toContain("我的笔记：动态规划");
    expect(updated).not.toContain("## 个人笔记");
    expect(updated.match(new RegExp(GENERATED_START, "g"))).toHaveLength(1);
    expect(updated.match(new RegExp(GENERATED_END, "g"))).toHaveLength(1);
  });

  it("preserves an unmarked existing Markdown file", () => {
    const merged = mergeStatementMarkdown("旧笔记，不可覆盖", {
      site: "nowcoder",
      problemId: "NC1",
      title: "测试",
      url: "https://ac.nowcoder.com/acm/problem/1",
      language: "cpp",
      code: "",
      statementMarkdown: "题面"
    });
    expect(merged).toContain("题面");
    expect(merged).toContain("旧笔记，不可覆盖");
    expect(merged).not.toContain("## 个人笔记");
  });

  it("does not add a personal notes section to new statements", () => {
    const merged = mergeStatementMarkdown("", {
      site: "leetcode",
      problemId: "1",
      title: "两数之和",
      url: "https://leetcode.cn/problems/two-sum/",
      language: "cpp",
      code: "",
      statementMarkdown: "题面"
    });
    expect(merged).not.toContain("个人笔记");
    expect(merged.endsWith("\n")).toBe(true);
  });

  it("rejects absolute and escaping directories", () => {
    expect(normalizeRelativeDirectory("../outside", ".")).toBe(".");
    expect(normalizeRelativeDirectory("C:\\outside", ".")).toBe(".");
  });

  it("compares Windows paths case-insensitively", () => {
    expect(sameFile("C:\\Work\\A.cpp", "c:\\work\\a.cpp", "win32")).toBe(true);
  });

  it("filters Save All down to the single active browser target", () => {
    const active = "C:\\work\\luogu\\P1002-过河卒\\P1002-过河卒.cpp";
    expect(shouldSyncSavedFile(active, active, "win32")).toBe(true);
    expect(shouldSyncSavedFile("C:\\work\\luogu\\P1003-铺地毯\\P1003-铺地毯.cpp", active, "win32")).toBe(false);
    expect(shouldSyncSavedFile("C:\\work\\luogu\\P1002-过河卒\\题目.md", active, "win32")).toBe(false);
    expect(shouldSyncSavedFile(active, undefined, "win32")).toBe(false);
  });

  it("replaces a stale refresh snapshot with the browser's authoritative template", () => {
    expect(resolveInitialTemplate("", "nowcoder")).toBe("");
    expect(resolveInitialTemplate("class Solution {}", "leetcode")).toBe("class Solution {}");
  });

  it("does not trust an old snapshot when the browser cannot expose a template", () => {
    expect(resolveInitialTemplate(undefined, "nowcoder")).toBeUndefined();
  });

  it("never treats a restored current buffer as a pristine template", () => {
    expect(resolveInitialTemplate(undefined, "nowcoder")).toBeUndefined();
    expect(resolveInitialTemplate(undefined, "leetcode")).toBeUndefined();
    expect(resolveInitialTemplate(undefined, "luogu")).toBe("");
  });

  it("rechecks Nowcoder Python so Python2 can be corrected to Python3", () => {
    expect(shouldDispatchLanguageSwitch("nowcoder", "python", "python")).toBe(true);
    expect(shouldDispatchLanguageSwitch("luogu", "python", "python")).toBe(false);
    expect(shouldDispatchLanguageSwitch("luogu", "python", "cpp")).toBe(true);
  });
});
