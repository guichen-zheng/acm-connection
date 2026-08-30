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

  it("accepts a local CLI push request", () => {
    expect(parseCliMessage({
      type: "cliPush",
      protocolVersion: PROTOCOL_VERSION,
      requestId: "12345678-1234-1234-1234-123456789012",
      cwd: "C:\\workspace\\luogu\\P1002-过河卒"
    })?.type).toBe("cliPush");
  });

  it("accepts a bounded browser submission update", () => {
    expect(parseBrowserMessage({
      type: "submissionUpdate",
      protocolVersion: PROTOCOL_VERSION,
      requestId: "12345678-1234-1234-1234-123456789012",
      tabId: 7,
      phase: "finished",
      status: "Accepted",
      success: true
    })?.type).toBe("submissionUpdate");
  });
});
