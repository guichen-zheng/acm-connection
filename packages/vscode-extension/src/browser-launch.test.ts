import { describe, expect, it } from "vitest";
import { planBrowserWake } from "./browser-launch";

describe("browser background wake plan", () => {
  it("wakes only the preferred browser without opening a URL", () => {
    expect(planBrowserWake(["edge.exe", "chrome.exe"])).toEqual({
      executable: "edge.exe",
      arguments: ["--no-startup-window"]
    });
  });

  it("does nothing when no supported browser is installed", () => {
    expect(planBrowserWake([])).toBeUndefined();
  });
});
