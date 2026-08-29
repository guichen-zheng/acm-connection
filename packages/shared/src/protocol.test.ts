import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, parseBrowserMessage, problemKey } from "./protocol";

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
        code: "int main() {}"
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
});
