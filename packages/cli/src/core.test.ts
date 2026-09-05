import { describe, expect, it } from "vitest";
import { formatUpdate, isFinalUpdate, normalizeSwitchLanguage } from "./core";

describe("acm CLI output", () => {
  it.each([
    ["python", "python"],
    ["java", "java"],
    ["cpp", "cpp"],
    ["c++", "cpp"],
    ["c", "c"]
  ] as const)("normalizes switch language %s", (input, expected) => {
    expect(normalizeSwitchLanguage(input)).toBe(expected);
  });

  it("rejects unsupported switch languages", () => {
    expect(normalizeSwitchLanguage("javascript")).toBeUndefined();
  });

  it("accepts python3 as the Python language alias", () => {
    expect(normalizeSwitchLanguage("python3")).toBe("python");
  });

  it("formats a judging update with its active target", () => {
    expect(formatUpdate({
      type: "cliUpdate",
      protocolVersion: 5,
      requestId: "12345678-1234-1234-1234-123456789012",
      phase: "judging",
      status: "Judging",
      site: "luogu",
      problemId: "P1002",
      language: "cpp"
    }, false)).toBe("[评测] luogu/P1002/cpp Judging");
  });

  it("treats rejected verdicts and errors as final", () => {
    expect(isFinalUpdate({
      type: "cliUpdate",
      protocolVersion: 5,
      requestId: "12345678-1234-1234-1234-123456789012",
      phase: "finished",
      status: "Wrong Answer",
      success: false
  })).toBe(true);
  });

  it("treats a successful browser command as completed", () => {
    const message = {
      type: "cliUpdate" as const,
      protocolVersion: 5,
      requestId: "12345678-1234-1234-1234-123456789012",
      phase: "completed" as const,
      status: "已打开 P1001",
      success: true
    };
    expect(isFinalUpdate(message)).toBe(true);
    expect(formatUpdate(message, false)).toBe("[完成] 已打开 P1001");
  });

  it("prints all accepted as one green summary line", () => {
    const output = formatUpdate({
      type: "cliUpdate",
      protocolVersion: 5,
      requestId: "12345678-1234-1234-1234-123456789012",
      phase: "finished",
      status: "Accepted",
      site: "luogu",
      problemId: "P1115",
      language: "cpp",
      success: true,
      allAccepted: true,
      testPoints: [{ id: "1", verdict: "AC", time: "4ms", memory: "788.00KB" }]
    });
    expect(output).toContain("\u001b[32m[通过] luogu/P1115/cpp all subtask accepted\u001b[0m");
  });

  it("colors only verdict text on failed test-point lines", () => {
    const output = formatUpdate({
      type: "cliUpdate",
      protocolVersion: 5,
      requestId: "12345678-1234-1234-1234-123456789012",
      phase: "finished",
      status: "Wrong Answer",
      success: false,
      allAccepted: false,
      testPoints: [
        { id: "1", verdict: "AC", time: "4ms", memory: "788.00KB" },
        {
          id: "2",
          verdict: "WA",
          time: "4ms",
          memory: "1.04MB",
          detail: "Wrong Answer: wrong answer Too long on line 1."
        }
      ]
    });
    expect(output).toContain("[#1] \u001b[32mAC\u001b[0m");
    expect(output).toContain("[#2] \u001b[31mWA\u001b[0m");
    expect(output).toContain("4ms/1.04MB · Wrong Answer: wrong answer Too long on line 1.");
  });

  it("prints a yellow CE followed by compiler diagnostics", () => {
    const output = formatUpdate({
      type: "cliUpdate",
      protocolVersion: 5,
      requestId: "12345678-1234-1234-1234-123456789012",
      phase: "finished",
      status: "CE Compilation Error\nundefined reference to main\ncollect2: ld returned 1",
      site: "luogu",
      problemId: "P2142",
      language: "cpp",
      success: false,
      allAccepted: false
    });
    expect(output).toContain("\u001b[33mCE\u001b[0m Compilation Error");
    expect(output).toContain("undefined reference to main");
  });
});
