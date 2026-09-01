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

  it("prefers the visible Monaco editor over a stale language model", async () => {
    document.body.innerHTML = "<div id='current-editor'></div>";
    const staleModel = {
      getValue: () => "public class Main {}",
      setValue: vi.fn(),
      getLanguageId: () => "java"
    };
    const currentModel = {
      getValue: () => "#include <bits/stdc++.h>",
      setValue: vi.fn(),
      getLanguageId: () => "cpp"
    };
    (window as unknown as { monaco: unknown }).monaco = {
      editor: {
        getModels: () => [staleModel, currentModel],
        getEditors: () => [
          {
            hasTextFocus: () => true,
            getDomNode: () => document.querySelector("#current-editor"),
            getModel: () => staleModel
          },
          {
            hasTextFocus: () => false,
            getDomNode: () => document.querySelector("#current-editor"),
            getModel: () => currentModel
          }
        ]
      }
    };

    mainBridgeBootstrap("current-monaco-token");
    const response = waitForBridgeResponse("current-monaco-read");
    window.dispatchEvent(new MessageEvent("message", {
      source: window,
      data: {
        source: "algo-sync-content",
        token: "current-monaco-token",
        requestId: "current-monaco-read",
        action: "read",
        language: "cpp"
      }
    }));

    await expect(response).resolves.toMatchObject({
      ok: true,
      editor: "monaco",
      language: "cpp",
      code: "#include <bits/stdc++.h>"
    });
  });

  it("prefers a requested-language model over an unrelated focused editor", async () => {
    document.body.innerHTML = "<div id='focused-python-editor'></div>";
    const pythonModel = {
      getValue: () => "print('old')",
      setValue: vi.fn(),
      getLanguageId: () => "python"
    };
    const cppModel = {
      getValue: () => "int main() { return 0; }",
      setValue: vi.fn(),
      getLanguageId: () => "cpp"
    };
    (window as unknown as { monaco: unknown }).monaco = {
      editor: {
        getModels: () => [cppModel, pythonModel],
        getEditors: () => [{
          hasTextFocus: () => true,
          getDomNode: () => document.querySelector("#focused-python-editor"),
          getModel: () => pythonModel
        }]
      }
    };

    mainBridgeBootstrap("requested-model-token");
    const response = waitForBridgeResponse("requested-model-read");
    window.dispatchEvent(new MessageEvent("message", {
      source: window,
      data: {
        source: "algo-sync-content",
        token: "requested-model-token",
        requestId: "requested-model-read",
        action: "read",
        language: "cpp"
      }
    }));

    await expect(response).resolves.toMatchObject({
      ok: true,
      language: "cpp",
      code: "int main() { return 0; }"
    });
  });

  it("reads LeetCode's official snippet instead of the restored editor buffer", async () => {
    const previousAnswer = "class Solution { public: int answer() { return 42; } };";
    const officialTemplate = "class Solution {\npublic:\n    int answer() {\n        \n    }\n};";
    const nextData = document.createElement("script");
    nextData.id = "__NEXT_DATA__";
    nextData.type = "application/json";
    nextData.textContent = JSON.stringify({ props: { pageProps: { dehydratedState: {
      queries: [{ state: { data: { question: { codeSnippets: [
        { lang: "C++", langSlug: "cpp", code: officialTemplate },
        { lang: "Python3", langSlug: "python3", code: "class Solution:\n    pass" }
      ] } } } }]
    } } } });
    document.body.append(nextData);
    (window as unknown as { monaco: unknown }).monaco = {
      editor: {
        getModels: () => [{
          getValue: () => previousAnswer,
          setValue: vi.fn(),
          getLanguageId: () => "cpp"
        }]
      }
    };

    mainBridgeBootstrap("leetcode-template-token", "leetcode.cn");
    const response = waitForBridgeResponse("leetcode-template-read");
    window.dispatchEvent(new MessageEvent("message", {
      source: window,
      data: {
        source: "algo-sync-content",
        token: "leetcode-template-token",
        requestId: "leetcode-template-read",
        action: "read"
      }
    }));

    await expect(response).resolves.toMatchObject({
      ok: true,
      code: previousAnswer,
      template: officialTemplate
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
        currentLangItem: { text: "Java 17", value: "4", tplCode: "public class Main {}" },
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
      language: "Java 17",
      template: "public class Main {}"
    });
  });

  it("switches Nowcoder through its Vue editor language API and prefers Python3", async () => {
    document.body.innerHTML = "<div id='jsCodeEditor'><div class='monaco-editor'></div></div>";
    let currentLang = 2;
    const languageOptions = [
      { text: "C++（clang++18）", value: 2, tplCode: "" },
      { text: "Python2", value: 5, tplCode: "" },
      { text: "Python3", value: 11, tplCode: "" },
      { text: "pypy3", value: 25, tplCode: "" }
    ];
    const editorComponent = {
      // The real page can keep the visible language options on a descendant
      // selector component instead of the component that owns valCode.
      $children: [{ options: languageOptions }],
      get currentLang() { return currentLang; },
      set currentLang(value: string) { currentLang = value; },
      get currentLangItem() { return languageOptions.find((item) => item.value === currentLang); },
      valLangue(value?: number) {
        if (value === undefined) return currentLang;
        currentLang = value;
      },
      editor: { getValue: () => "int main() {}", setValue: () => undefined },
      valCode() { return "int main() {}"; }
    };
    Object.defineProperty(document.querySelector("#jsCodeEditor"), "__vue__", {
      value: { $children: [editorComponent] }
    });

    mainBridgeBootstrap("nowcoder-language-token");
    const response = waitForBridgeResponse("nowcoder-language-switch");
    window.dispatchEvent(new MessageEvent("message", {
      source: window,
      data: {
        source: "algo-sync-content",
        token: "nowcoder-language-token",
        requestId: "nowcoder-language-switch",
        action: "switchLanguage",
        language: "python"
      }
    }));

    await expect(response).resolves.toMatchObject({ ok: true, editor: "nowcoder-vue" });
    expect(currentLang).toBe(11);
  });

  it("reads Nowcoder's Vue state without the replaced jsCodeEditor mount", async () => {
    document.body.innerHTML = `
      <div id="vue-root">
        <div class="code-editor-box subject-eidt-box"><div class="monaco-editor"></div></div>
      </div>`;
    const oldModel = {
      getValue: () => "int main() {}",
      setValue: () => undefined,
      getLanguageId: () => "cpp"
    };
    (window as unknown as { monaco: unknown }).monaco = {
      editor: { getModels: () => [oldModel] }
    };
    const pythonTemplate = "print(input())";
    const editorComponent = {
      currentLang: 11,
      currentLangItem: { text: "Python3", value: 11, tplCode: pythonTemplate },
      valLangue() { return this.currentLang; },
      valCode() { return pythonTemplate; }
    };
    Object.defineProperty(document.querySelector("#vue-root"), "__vue__", {
      value: { $children: [editorComponent] }
    });

    mainBridgeBootstrap("nowcoder-background-token", "ac.nowcoder.com");
    const response = waitForBridgeResponse("nowcoder-background-read");
    window.dispatchEvent(new MessageEvent("message", {
      source: window,
      data: {
        source: "algo-sync-content",
        token: "nowcoder-background-token",
        requestId: "nowcoder-background-read",
        action: "read",
        language: "python"
      }
    }));

    await expect(response).resolves.toMatchObject({
      ok: true,
      editor: "nowcoder-vue",
      language: "Python3",
      code: pythonTemplate,
      template: pythonTemplate
    });
  });

  it("switches through Nowcoder's mounted Element UI options without opening the menu", async () => {
    document.body.innerHTML = `
      <div class="language-select" style="display:none">
        <li id="bridge-cpp" class="el-select-dropdown__item">C++（clang++18）</li>
        <li id="bridge-gpp" class="el-select-dropdown__item">C++(g++ 13)</li>
        <li id="bridge-python2" class="el-select-dropdown__item">Python2</li>
        <li id="bridge-python3" class="el-select-dropdown__item">Python3</li>
      </div>`;
    let selected = "C++（clang++18）";
    document.querySelector("#bridge-cpp")?.addEventListener("click", () => { selected = "C++（clang++18）"; });
    document.querySelector("#bridge-gpp")?.addEventListener("click", () => { selected = "C++(g++ 13)"; });
    document.querySelector("#bridge-python2")?.addEventListener("click", () => { selected = "Python2"; });
    document.querySelector("#bridge-python3")?.addEventListener("click", () => { selected = "Python3"; });

    mainBridgeBootstrap("nowcoder-option-token", "ac.nowcoder.com");
    const pythonResponse = waitForBridgeResponse("nowcoder-option-python");
    window.dispatchEvent(new MessageEvent("message", {
      source: window,
      data: {
        source: "algo-sync-content",
        token: "nowcoder-option-token",
        requestId: "nowcoder-option-python",
        action: "switchLanguage",
        language: "python"
      }
    }));
    await expect(pythonResponse).resolves.toMatchObject({ ok: true, editor: "nowcoder-option" });
    expect(selected).toBe("Python3");

    const cppResponse = waitForBridgeResponse("nowcoder-option-cpp");
    window.dispatchEvent(new MessageEvent("message", {
      source: window,
      data: {
        source: "algo-sync-content",
        token: "nowcoder-option-token",
        requestId: "nowcoder-option-cpp",
        action: "switchLanguage",
        language: "cpp"
      }
    }));
    await expect(cppResponse).resolves.toMatchObject({ ok: true, editor: "nowcoder-option" });
    expect(selected).toBe("C++（clang++18）");
  });

  it("switches Luogu's Vue IDE model between Python 3 and C++14", async () => {
    document.body.innerHTML = `
      <div class="ide-toolbar">
        <div id="luogu-language" class="lang-select">C++14 (GCC 9)</div>
      </div>`;
    const options = [
      { value: 2, label: "C" },
      { value: 28, label: "C++14 (GCC 9)" },
      { value: 7, label: "Python 3" },
      { value: 25, label: "PyPy 3" },
      { value: 8, label: "Java 8" },
      { value: 33, label: "Java 21" }
    ];
    let selected = 28;
    const selectVNode = {
      props: {
        class: "lang-select",
        modelValue: selected,
        options,
        "onUpdate:modelValue": (value: number) => { selected = value; }
      }
    };
    Object.defineProperty(document.querySelector("#luogu-language"), "__vueParentComponent", {
      value: { vnode: selectVNode }
    });

    mainBridgeBootstrap("luogu-language-token", "www.luogu.com.cn");
    const pythonResponse = waitForBridgeResponse("luogu-language-python");
    window.dispatchEvent(new MessageEvent("message", {
      source: window,
      data: {
        source: "algo-sync-content",
        token: "luogu-language-token",
        requestId: "luogu-language-python",
        action: "switchLanguage",
        language: "python"
      }
    }));
    await expect(pythonResponse).resolves.toMatchObject({ ok: true, editor: "luogu-vue" });
    expect(selected).toBe(7);

    const cppResponse = waitForBridgeResponse("luogu-language-cpp");
    window.dispatchEvent(new MessageEvent("message", {
      source: window,
      data: {
        source: "algo-sync-content",
        token: "luogu-language-token",
        requestId: "luogu-language-cpp",
        action: "switchLanguage",
        language: "cpp"
      }
    }));
    await expect(cppResponse).resolves.toMatchObject({ ok: true, editor: "luogu-vue" });
    expect(selected).toBe(28);
  });

  it("opens Luogu's teleported LCombo dropdown and clicks the requested row", async () => {
    document.body.innerHTML = `
      <div id="app">
        <div class="ide-toolbar">
          <div id="luogu-combo" class="combo-wrapper lang-select">C++14 (GCC 9)</div>
        </div>
        <div id="luogu-dropdown" class="dropdown" style="display:none">
          <ul>
            <li>C</li>
            <li id="luogu-cpp">C++14 (GCC 9)</li>
            <li id="luogu-python">Python 3</li>
            <li>PyPy 3</li>
            <li>Java 8</li>
          </ul>
        </div>
      </div>`;
    const control = document.querySelector<HTMLElement>("#luogu-combo")!;
    const dropdown = document.querySelector<HTMLElement>("#luogu-dropdown")!;
    let selected = "C++14 (GCC 9)";
    let openCount = 0;
    control.addEventListener("click", () => {
      openCount += 1;
      dropdown.style.display = "block";
    });
    const choose = (label: string) => {
      selected = label;
      control.textContent = label;
      dropdown.style.display = "none";
    };
    document.querySelector("#luogu-python")?.addEventListener("click", () => choose("Python 3"));
    document.querySelector("#luogu-cpp")?.addEventListener("click", () => choose("C++14 (GCC 9)"));

    mainBridgeBootstrap("luogu-combo-token", "www.luogu.com.cn");
    const pythonResponse = waitForBridgeResponse("luogu-combo-python");
    window.dispatchEvent(new MessageEvent("message", {
      source: window,
      data: {
        source: "algo-sync-content",
        token: "luogu-combo-token",
        requestId: "luogu-combo-python",
        action: "switchLanguage",
        language: "python"
      }
    }));
    await expect(pythonResponse).resolves.toMatchObject({ ok: true, editor: "luogu-option" });
    expect(selected).toBe("Python 3");

    const cppResponse = waitForBridgeResponse("luogu-combo-cpp");
    window.dispatchEvent(new MessageEvent("message", {
      source: window,
      data: {
        source: "algo-sync-content",
        token: "luogu-combo-token",
        requestId: "luogu-combo-cpp",
        action: "switchLanguage",
        language: "cpp"
      }
    }));
    await expect(cppResponse).resolves.toMatchObject({ ok: true, editor: "luogu-option" });
    expect(selected).toBe("C++14 (GCC 9)");
    expect(openCount).toBe(2);
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
