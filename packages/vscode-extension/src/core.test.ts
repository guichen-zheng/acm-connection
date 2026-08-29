import { describe, expect, it } from "vitest";
import { existingFilePrefix, normalizeRelativeDirectory, sameFile, shouldSyncSavedFile, solutionFilename } from "./core";

describe("workspace file rules", () => {
  it("sanitizes a Windows-incompatible title", () => {
    expect(solutionFilename("P1002", "A/B: C?*", "cpp")).toBe("P1002-A-B- C-.cpp");
  });

  it("uses stable problem identifiers as the lookup prefix", () => {
    expect(existingFilePrefix("P1002")).toBe("P1002-");
  });

  it("rejects absolute and escaping directories", () => {
    expect(normalizeRelativeDirectory("../outside", ".")).toBe(".");
    expect(normalizeRelativeDirectory("C:\\outside", ".")).toBe(".");
  });

  it("compares Windows paths case-insensitively", () => {
    expect(sameFile("C:\\Work\\A.cpp", "c:\\work\\a.cpp", "win32")).toBe(true);
  });

  it("filters Save All down to the single active browser target", () => {
    const active = "C:\\work\\luogu\\P1002-过河卒.cpp";
    expect(shouldSyncSavedFile(active, active, "win32")).toBe(true);
    expect(shouldSyncSavedFile("C:\\work\\luogu\\P1003-铺地毯.cpp", active, "win32")).toBe(false);
    expect(shouldSyncSavedFile(active, undefined, "win32")).toBe(false);
  });
});
