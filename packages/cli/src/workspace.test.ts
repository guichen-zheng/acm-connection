import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanSiteDirectories, normalizeProblemCode } from "./workspace";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("CLI workspace commands", () => {
  it.each([
    ["P1001", "P1001"],
    ["b2001", "B2001"],
    ["U12345", "U12345"],
    ["T12345", "T12345"],
    ["CF2001A", "CF2001A"],
    ["AT_abc001_1", "AT_abc001_1"],
    ["SP1", "SP1"],
    ["UVA100", "UVA100"],
    ["NC233601", "NC233601"],
    ["lc1", "LC1"]
  ])("normalizes supported problem code %s", (input, expected) => {
    expect(normalizeProblemCode(input)).toBe(expected);
  });

  it.each(["1", "ABC123", "NCabc", "LCtwo-sum", "../P1001"])("rejects unsupported code %s", (input) => {
    expect(normalizeProblemCode(input)).toBeUndefined();
  });

  it("deletes only the selected whole site directory", async () => {
    const root = await temporaryWorkspace();
    await mkdir(path.join(root, "luogu", "P1001"), { recursive: true });
    await mkdir(path.join(root, "leetcode", "1-two-sum"), { recursive: true });
    await writeFile(path.join(root, "keep.txt"), "keep");
    const result = await cleanSiteDirectories(root, {}, "luogu");
    expect(result).toEqual([{ site: "luogu", relativePath: "luogu", removed: true }]);
    await expect(readFile(path.join(root, "keep.txt"), "utf8")).resolves.toBe("keep");
    await expect(readFile(path.join(root, "leetcode", "1-two-sum", "missing"))).rejects.toBeDefined();
    await expect(readFile(path.join(root, "luogu", "P1001", "missing"))).rejects.toBeDefined();
    await expect(mkdir(path.join(root, "leetcode"))).rejects.toBeDefined();
    await expect(mkdir(path.join(root, "luogu"))).resolves.toBeUndefined();
  });

  it("rejects an inner directory selector without deleting it", async () => {
    const root = await temporaryWorkspace();
    const file = path.join(root, "luogu", "P1001", "answer.cpp");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "answer");
    await expect(cleanSiteDirectories(root, {}, "luogu/P1001")).rejects.toThrow("不能删除站点目录内部");
    await expect(readFile(file, "utf8")).resolves.toBe("answer");
  });

  it("cleans all configured site directories for the star selector", async () => {
    const root = await temporaryWorkspace();
    for (const directory of ["lg", "nc", "lc", "ybt"]) await mkdir(path.join(root, "solutions", directory), { recursive: true });
    const results = await cleanSiteDirectories(root, {
      solutionRoot: "solutions",
      siteDirectories: { luogu: "lg", nowcoder: "nc", leetcode: "lc", ybt: "ybt" }
    }, "*");
    expect(results).toHaveLength(4);
    for (const result of results) expect(result.removed).toBe(true);
    await expect(mkdir(path.join(root, "solutions"))).rejects.toBeDefined();
  });
});

async function temporaryWorkspace(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "algo-sync-clean-"));
  temporaryDirectories.push(directory);
  return directory;
}
