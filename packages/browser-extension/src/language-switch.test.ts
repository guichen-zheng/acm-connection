import { describe, expect, it } from "vitest";
import { languageSwitchHasSettled } from "./language-switch";

describe("language switch settlement", () => {
  it("accepts Nowcoder Python3 selection while its background Monaco model is stale", () => {
    expect(languageSwitchHasSettled("nowcoder", "python", "Python3", "cpp")).toBe(true);
  });

  it("does not accept Nowcoder Python2 for the python command", () => {
    expect(languageSwitchHasSettled("nowcoder", "python", "Python2", "python")).toBe(false);
  });

  it("still requires other sites' selector and editor model to agree", () => {
    expect(languageSwitchHasSettled("luogu", "cpp", "C++14 (GCC 9)", "java")).toBe(false);
  });
});
