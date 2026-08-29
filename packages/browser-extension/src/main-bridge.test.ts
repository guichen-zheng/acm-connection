// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mainBridgeBootstrap } from "./main-bridge";

describe("main page editor bridge", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    delete (window as unknown as { monaco?: unknown }).monaco;
  });

  it("reads the active language from a Monaco model", async () => {
    let code = "public class Main {}";
    (window as unknown as { monaco: unknown }).monaco = {
      editor: {
        getModels: () => [{
          getValue: () => code,
          setValue: (value: string) => { code = value; },
          getLanguageId: () => "java"
        }]
      }
    };

    mainBridgeBootstrap("monaco-language-token");
    const response = waitForBridgeResponse("monaco-language-read");
    window.dispatchEvent(new MessageEvent("message", {
      source: window,
      data: {
        source: "algo-sync-content",
        token: "monaco-language-token",
        requestId: "monaco-language-read",
        action: "read"
      }
    }));

    await expect(response).resolves.toMatchObject({
      ok: true,
      editor: "monaco",
      language: "java",
      code
    });
  });

  it("reads and writes a CodeMirror 6 document through transactions", async () => {
    document.body.innerHTML = "<div class='cm-editor'><div class='cm-content'></div></div>";
    let code = "int main() {}";
    const dispatch = vi.fn((transaction: { changes: { insert: string } }) => {
      code = transaction.changes.insert;
    });
    const content = document.querySelector(".cm-content") as HTMLElement & {
      cmView: { view: { state: { doc: { length: number; toString(): string } }; dispatch: typeof dispatch } };
    };
    Object.defineProperty(content, "cmView", {
      value: {
        view: {
          state: {
            doc: {
              get length() { return code.length; },
              toString: () => code
            }
          },
          dispatch
        }
      }
    });

    mainBridgeBootstrap("test-token");
    const response = waitForBridgeResponse("write-1");
    window.dispatchEvent(new MessageEvent("message", {
      source: window,
      data: {
        source: "algo-sync-content",
        token: "test-token",
        requestId: "write-1",
        action: "write",
        code: "long long answer;"
      }
    }));

    await expect(response).resolves.toMatchObject({ ok: true, editor: "codemirror6" });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(code).toBe("long long answer;");
  });

  it("reads the active language from a CodeMirror 5 mode", async () => {
    document.body.innerHTML = "<div class='CodeMirror'></div>";
    const element = document.querySelector(".CodeMirror") as HTMLElement & { CodeMirror: unknown };
    Object.defineProperty(element, "CodeMirror", {
      value: {
        getValue: () => "print(input())",
        setValue: vi.fn(),
        getOption: () => ({ name: "python" })
      }
    });

    mainBridgeBootstrap("codemirror5-language-token");
    const response = waitForBridgeResponse("codemirror5-language-read");
    window.dispatchEvent(new MessageEvent("message", {
      source: window,
      data: {
        source: "algo-sync-content",
        token: "codemirror5-language-token",
        requestId: "codemirror5-language-read",
        action: "read"
      }
    }));

    await expect(response).resolves.toMatchObject({
      ok: true,
      editor: "codemirror",
      language: "python"
    });
  });

  it("writes through Nowcoder's Vue editor component", async () => {
    document.body.innerHTML = "<div id='jsCodeEditor'><div class='monaco-editor'></div></div>";
    let code = "int main() {}";
    const component = {
      $children: [{
        currentLang: "java",
        currentLangItem: { text: "Java 17", value: "4" },
        valLangue() { return this.currentLang; },
        editor: {
          getValue: () => code,
          setValue: (value: string) => { code = value; }
        },
        valCode(value?: string) {
          if (arguments.length === 0) return code;
          code = value ?? "";
        }
      }]
    };
    Object.defineProperty(document.querySelector("#jsCodeEditor"), "__vue__", { value: component });

    mainBridgeBootstrap("nowcoder-token");
    const response = waitForBridgeResponse("nowcoder-write");
    window.dispatchEvent(new MessageEvent("message", {
      source: window,
      data: {
        source: "algo-sync-content",
        token: "nowcoder-token",
        requestId: "nowcoder-write",
        action: "write",
        code: "long long answer = 42;"
      }
    }));

    await expect(response).resolves.toMatchObject({ ok: true, editor: "nowcoder-vue" });
    expect(code).toBe("long long answer = 42;");

    const readResponse = waitForBridgeResponse("nowcoder-read");
    window.dispatchEvent(new MessageEvent("message", {
      source: window,
      data: {
        source: "algo-sync-content",
        token: "nowcoder-token",
        requestId: "nowcoder-read",
        action: "read"
      }
    }));
    await expect(readResponse).resolves.toMatchObject({
      ok: true,
      editor: "nowcoder-vue",
      language: "Java 17"
    });
  });
});

function waitForBridgeResponse(requestId: string): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const listener = (event: MessageEvent) => {
      if (event.data?.source !== "algo-sync-main" || event.data?.requestId !== requestId) return;
      window.removeEventListener("message", listener);
      resolve(event.data as Record<string, unknown>);
    };
    window.addEventListener("message", listener);
  });
}
