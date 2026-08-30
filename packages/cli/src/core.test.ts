import { describe, expect, it } from "vitest";
import { formatUpdate, isFinalUpdate } from "./core";

describe("acm CLI output", () => {
  it("formats a judging update with its active target", () => {
    expect(formatUpdate({
      type: "cliUpdate",
      protocolVersion: 3,
      requestId: "12345678-1234-1234-1234-123456789012",
      phase: "judging",
      status: "Judging",
      site: "luogu",
      problemId: "P1002",
      language: "cpp"
    })).toBe("[评测] luogu/P1002/cpp Judging");
  });

  it("treats rejected verdicts and errors as final", () => {
    expect(isFinalUpdate({
      type: "cliUpdate",
      protocolVersion: 3,
      requestId: "12345678-1234-1234-1234-123456789012",
      phase: "finished",
      status: "Wrong Answer",
      success: false
    })).toBe(true);
  });
});
