import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, parseBrowserMessage, parseCliMessage, problemKey } from "./protocol";

describe("protocol", () => {
  it("accepts a valid active editor context", () => {
    const message = parseBrowserMessage({
      type: "activeEditorChanged",
      protocolVersion: PROTOCOL_VERSION,
      tabId: 7,
      context: {
        site: "luogu",
        problemId: "P1002",
        title: "过河卒",
        url: "https://www.luogu.com.cn/problem/P1002",
        language: "cpp",
        code: "int main() {}",
        initialCode: "int main() { return 0; }",
        statementMarkdown: "## 题目描述\n\n内容"
      }
    });
    expect(message?.type).toBe("activeEditorChanged");
  });

  it("rejects unsupported sites and oversized identifiers", () => {
    expect(parseBrowserMessage({
      type: "activeEditorChanged",
      protocolVersion: PROTOCOL_VERSION,
      tabId: 1,
      context: {
        site: "example",
        problemId: "x".repeat(200),
        title: "bad",
        url: "https://example.com",
        language: "cpp",
        code: ""
      }
    })).toBeUndefined();
  });

  it("builds a language-specific problem key", () => {
    expect(problemKey({ site: "leetcode", problemId: "1", language: "python" }))
      .toBe("leetcode:1:python");
  });

  it("rejects an oversized problem statement", () => {
    expect(parseBrowserMessage({
      type: "activeEditorChanged",
      protocolVersion: PROTOCOL_VERSION,
      tabId: 1,
      context: {
        site: "luogu",
        problemId: "P1",
        title: "test",
        url: "https://www.luogu.com.cn/problem/P1",
        language: "cpp",
        code: "",
        statementMarkdown: "x".repeat(1_000_001)
      }
    })).toBeUndefined();
  });

  it("rejects an oversized initial template", () => {
    expect(parseBrowserMessage({
      type: "activeEditorChanged",
      protocolVersion: PROTOCOL_VERSION,
      tabId: 1,
      context: {
        site: "nowcoder",
        problemId: "NC1",
        title: "test",
        url: "https://ac.nowcoder.com/acm/problem/1",
        language: "cpp",
        code: "",
        initialCode: "x".repeat(2_000_001)
      }
    })).toBeUndefined();
  });

  it("accepts a local CLI push request", () => {
    expect(parseCliMessage({
      type: "cliPush",
      protocolVersion: PROTOCOL_VERSION,
      requestId: "12345678-1234-1234-1234-123456789012",
      cwd: "C:\\workspace\\luogu\\P1002-过河卒"
    })?.type).toBe("cliPush");
  });

  it.each([
    { type: "cliRefresh", cwd: "C:\\workspace" },
    { type: "cliRemote", cwd: "C:\\workspace" },
    { type: "cliSwitch", cwd: "C:\\workspace", language: "python" },
    { type: "cliFetch", cwd: "C:\\workspace", problemCode: "LC1" },
    { type: "cliBrowserRefresh", cwd: "C:\\workspace", browser: "edge" }
  ])("accepts a valid $type request", (fields) => {
    expect(parseCliMessage({
      ...fields,
      protocolVersion: PROTOCOL_VERSION,
      requestId: "12345678-1234-1234-1234-123456789012"
    })?.type).toBe(fields.type);
  });

  it("accepts a browser action result", () => {
    expect(parseBrowserMessage({
      type: "browserActionResult",
      protocolVersion: PROTOCOL_VERSION,
      requestId: "12345678-1234-1234-1234-123456789012",
      ok: true,
      message: "已打开 P1001"
    })?.type).toBe("browserActionResult");
  });

  it("accepts a bounded remote-problem result", () => {
    expect(parseBrowserMessage({
      type: "remoteProblemsResult",
      protocolVersion: PROTOCOL_VERSION,
      requestId: "12345678-1234-1234-1234-123456789012",
      problems: [{
        tabId: 7,
        active: true,
        site: "leetcode",
        problemId: "34",
        title: "在排序数组中查找元素的第一个和最后一个位置",
        language: "cpp",
        url: "https://leetcode.cn/problems/find-first-and-last-position-of-element-in-sorted-array/"
      }]
    })?.type).toBe("remoteProblemsResult");
  });

  it("accepts a bounded browser submission update", () => {
    expect(parseBrowserMessage({
      type: "submissionUpdate",
      protocolVersion: PROTOCOL_VERSION,
      requestId: "12345678-1234-1234-1234-123456789012",
      tabId: 7,
      phase: "finished",
      status: "Accepted",
      success: true,
      allAccepted: true,
      testPoints: [{
        id: "1",
        verdict: "AC",
        time: "4ms",
        memory: "788KB",
        detail: "checker message"
      }]
    })?.type).toBe("submissionUpdate");
  });

  it("rejects an oversized test-point detail", () => {
    expect(parseBrowserMessage({
      type: "submissionUpdate",
      protocolVersion: PROTOCOL_VERSION,
      requestId: "12345678-1234-1234-1234-123456789012",
      tabId: 7,
      phase: "finished",
      status: "Wrong Answer",
      success: false,
      testPoints: [{ id: "1", verdict: "WA", detail: "x".repeat(2_001) }]
    })).toBeUndefined();
  });

  it("accepts a captcha attention update", () => {
    expect(parseBrowserMessage({
      type: "submissionUpdate",
      protocolVersion: PROTOCOL_VERSION,
      requestId: "12345678-1234-1234-1234-123456789012",
      tabId: 7,
      phase: "attention",
      status: "提交需要前往题目页面输入验证码"
    })?.type).toBe("submissionUpdate");
  });
});
