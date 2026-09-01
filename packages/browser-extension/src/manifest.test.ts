import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BROWSER_EXTENSION_ID } from "@algo-sync/shared";

describe("browser manifest", () => {
  it("pins the extension id accepted by the VS Code server", () => {
    const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8")) as { key: string };
    const digest = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest().subarray(0, 16);
    const extensionId = Array.from(digest)
      .map((byte) => String.fromCharCode(97 + (byte >> 4)) + String.fromCharCode(97 + (byte & 15)))
      .join("");
    expect(extensionId).toBe(BROWSER_EXTENSION_ID);
  });

  it("requests only the supported judge hosts", () => {
    const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8")) as {
      host_permissions: string[];
    };
    expect(manifest.host_permissions).not.toContain("<all_urls>");
    expect(manifest.host_permissions).toHaveLength(6);
  });

  it("keeps only the permissions needed for synchronization and the dedicated fetch tab", () => {
    const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8")) as {
      permissions: string[];
    };
    expect(manifest.permissions).toEqual(["alarms", "scripting", "storage", "tabs"]);
  });

  it("allows the background worker to resolve LeetCode numbers", () => {
    const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8")) as {
      content_security_policy: { extension_pages: string };
    };
    expect(manifest.content_security_policy.extension_pages).toContain("https://leetcode.cn");
  });
});
