// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  canCreateWithoutReadableEditor,
  describeVisibleLanguageOptions,
  detectLanguage,
  detectProblem,
  isEditorDomPresent,
  languageWithSiteFallback,
  normalizeLanguage,
  switchLanguage
} from "./adapters";

describe("site adapters", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "<head><title></title></head><body></body>";
  });

  it.each([
    ["https://www.luogu.com.cn/problem/P1002", "<h1>P1002 过河卒</h1>", "luogu", "P1002", "过河卒"],
    ["https://ac.nowcoder.com/acm/problem/14682", "<h1>快速幂</h1>", "nowcoder", "14682", "快速幂"],
    ["https://ac.nowcoder.com/acm/problem/233601", "<div>题号：NC233601</div>", "nowcoder", "NC233601", "哈夫曼编码"],
    ["https://leetcode.cn/problems/two-sum/description/", "<div data-cy='question-title'>1. 两数之和</div>", "leetcode", "1", "两数之和"],
    ["http://ybt.ssoier.cn:8088/problem_show.php?pid=1205", "<h2>1205 汉诺塔问题</h2>", "ybt", "1205", "汉诺塔问题"]
  ])("recognizes %s", (url, html, site, id, title) => {
    if (url.includes("233601")) document.title = "哈夫曼编码";
    document.body.innerHTML = html;
    expect(detectProblem(url)).toMatchObject({ site, problemId: id, title });
  });

  it("removes the internal fetch-tab marker from the original problem link", () => {
    document.body.innerHTML = "<h1>P1001 A+B Problem</h1>";
    const result = detectProblem("https://www.luogu.com.cn/problem/P1001?algo_sync_fetch=1#ide");
    expect(result?.url).toBe("https://www.luogu.com.cn/problem/P1001#ide");
  });

  it("recognizes Nowcoder practice UUID links", () => {
    document.body.innerHTML = "<h1>数组中的逆序对</h1>";
    expect(detectProblem("https://www.nowcoder.com/practice/38ae72379d42471db1c537914b06d48e?tpId=230"))
      .toMatchObject({ site: "nowcoder", problemId: "38ae72379d42471db1c537914b06d48e" });
  });

  it.each([
    "https://ac.nowcoder.com/acm/problem/list",
    "https://ac.nowcoder.com/acm/problem/list?from=acm",
    "https://ac.nowcoder.com/acm/problem/"
  ])("does not recognize the Nowcoder problem collection page %s", (url) => {
    document.title = "竞赛题库_ACM/NOI/CSP基础提高训练专区";
    expect(detectProblem(url)).toBeUndefined();
  });

  it.each([
    ["GNU C++17", "cpp"], ["C++（clang++18）", "cpp"], ["C", "c"], ["Python3", "python"], ["Java 17", "java"],
    ["Node.js", "javascript"], ["Golang", "go"], ["Rust 1.70", "rust"]
  ])("normalizes %s", (label, expected) => {
    expect(normalizeLanguage(label)).toBe(expected);
  });

  it("detects and switches a native language select", async () => {
    document.body.innerHTML = "<select><option value='py' selected>Python3</option><option value='cpp'>GNU C++17</option></select>";
    expect(detectLanguage()).toBe("python");
    expect(await switchLanguage("cpp")).toBe(true);
    expect(detectLanguage()).toBe("cpp");
  });

  it.each([
    ["python", "Python3"],
    ["java", "Java 17"],
    ["cpp", "GNU C++17"],
    ["c", "GNU C"]
  ] as const)("switches a native select to %s", async (language, expectedLabel) => {
    document.body.innerHTML = `
      <select>
        <option value="py">Python3</option>
        <option value="java">Java 17</option>
        <option value="cpp" selected>GNU C++17</option>
        <option value="c">GNU C</option>
      </select>`;
    expect(await switchLanguage(language)).toBe(true);
    expect(document.querySelector("select")?.selectedOptions[0]?.textContent).toBe(expectedLabel);
  });

  it("selects Python3 instead of an earlier Python2 native option", async () => {
    document.body.innerHTML = `
      <select>
        <option value="py2">Python2</option>
        <option value="py3">Python 3 (3.11)</option>
        <option value="cpp" selected>C++</option>
      </select>`;
    expect(await switchLanguage("python")).toBe(true);
    expect(document.querySelector("select")?.value).toBe("py3");
  });

  it("switches Luogu's visually hidden native select used by its styled compiler picker", async () => {
    document.body.innerHTML = `
      <div class="luogu-ide-toolbar">
        <div class="select-view-value">C++14 (GCC 9)</div>
        <select id="luogu-language-select" style="position:absolute;opacity:0">
          <option value="cpp14" selected>C++14 (GCC 9)</option>
          <option value="cpp23">C++23</option>
          <option value="python3">Python 3</option>
          <option value="pypy3">PyPy 3</option>
          <option value="java21">Java 21</option>
        </select>
        <div class="monaco-editor"></div>
      </div>`;
    const select = document.querySelector<HTMLSelectElement>("#luogu-language-select")!;
    const label = document.querySelector<HTMLElement>(".select-view-value")!;
    select.addEventListener("change", () => {
      label.textContent = select.selectedOptions[0]?.textContent ?? "";
    });

    expect(await switchLanguage("python")).toBe(true);
    expect(select.value).toBe("python3");
    expect(label.textContent).toBe("Python 3");
  });

  it("selects Python3 when a semantic menu lists Python2 first", async () => {
    document.body.innerHTML = `
      <button data-e2e-locator="console-language-select">C++</button>
      <ul id="ordered-python-menu" style="display:none">
        <li id="ordered-python2">Python2</li>
        <li id="ordered-python3">Python3 (3.11)</li>
        <li>Java</li>
      </ul>`;
    let selected = "";
    document.querySelector("button")?.addEventListener("click", () => {
      document.querySelector<HTMLElement>("#ordered-python-menu")!.style.display = "block";
    });
    document.querySelector("#ordered-python2")?.addEventListener("click", () => { selected = "Python2"; });
    document.querySelector("#ordered-python3")?.addEventListener("click", () => { selected = "Python3"; });
    expect(await switchLanguage("python")).toBe(true);
    expect(selected).toBe("Python3");
  });

  it("switches LeetCode's plain div language menu and prefers Python3", async () => {
    document.body.innerHTML = `
      <button data-e2e-locator="console-language-select">C++</button>
      <div id="language-menu" style="display:none">
        <div><span>C++</span></div>
        <div><span>Java</span></div>
        <div><span id="python3">Python3</span></div>
        <div><span id="python">Python</span></div>
        <div><span>C</span></div>
      </div>`;
    let selected = "";
    document.querySelector("button")?.addEventListener("click", () => {
      const menu = document.querySelector<HTMLElement>("#language-menu");
      if (menu) menu.style.display = "block";
    });
    document.querySelector("#python3")?.addEventListener("click", () => { selected = "Python3"; });
    document.querySelector("#python")?.addEventListener("click", () => { selected = "Python"; });
    expect(await switchLanguage("python")).toBe(true);
    expect(selected).toBe("Python3");
  });

  it("switches from LeetCode's current unmarked language button", async () => {
    document.body.innerHTML = `
      <button id="language-trigger">C++<svg></svg></button>
      <div id="language-menu" style="display:none">
        <div><span>C++</span></div><div><span>Java</span></div>
        <div><span id="current-python3">Python3</span></div><div><span>C</span></div>
      </div>`;
    let selected = false;
    document.querySelector("#language-trigger")?.addEventListener("click", () => {
      const menu = document.querySelector<HTMLElement>("#language-menu");
      if (menu) menu.style.display = "block";
    });
    document.querySelector("#current-python3")?.addEventListener("click", () => { selected = true; });
    expect(await switchLanguage("python")).toBe(true);
    expect(selected).toBe(true);
  });

  it("uses an already-open plain div language menu", async () => {
    document.body.innerHTML = `
      <button data-e2e-locator="console-language-select">C++</button>
      <div><span>C++</span><span id="java-option">Java</span><span>Python3</span><span>C</span></div>`;
    let clicked = false;
    document.querySelector("button")?.addEventListener("click", () => {
      const menu = document.querySelector<HTMLElement>("button + div");
      if (menu) menu.style.display = menu.style.display === "none" ? "block" : "none";
    });
    document.querySelector("#java-option")?.addEventListener("click", () => { clicked = true; });
    expect(await switchLanguage("java")).toBe(true);
    expect(clicked).toBe(true);
  });

  it("waits for LeetCode's asynchronously mounted language menu", async () => {
    document.body.innerHTML = `
      <button data-e2e-locator="console-language-select">C++</button>
      <div id="mount"></div>`;
    let clicked = false;
    document.querySelector("button")?.addEventListener("click", () => {
      setTimeout(() => {
        const mount = document.querySelector<HTMLElement>("#mount");
        if (!mount) return;
        mount.innerHTML = "<div><span>C++</span><span>Java</span><span id='delayed-python'>Python3</span><span>C</span></div>";
        document.querySelector("#delayed-python")?.addEventListener("click", () => { clicked = true; });
      }, 400);
    });
    expect(await switchLanguage("python")).toBe(true);
    expect(clicked).toBe(true);
  });

  it("finds a language menu mounted in an open shadow root", async () => {
    document.body.innerHTML = "<button data-e2e-locator='console-language-select'>C++</button><div id='portal'></div>";
    let clicked = false;
    const shadow = document.querySelector<HTMLElement>("#portal")?.attachShadow({ mode: "open" });
    document.querySelector("button")?.addEventListener("click", () => {
      if (!shadow) return;
      shadow.innerHTML = "<div><span>C++</span><span>Java</span><span id='shadow-python'>Python3</span><span>C</span></div>";
      shadow.querySelector("#shadow-python")?.addEventListener("click", () => { clicked = true; });
    });
    expect(await switchLanguage("python")).toBe(true);
    expect(clicked).toBe(true);
    expect(describeVisibleLanguageOptions()).toEqual(expect.arrayContaining(["C++", "Java", "Python3", "C"]));
  });

  it("opens Nowcoder's unmarked editor-header picker before selecting Python3", async () => {
    document.body.innerHTML = `
      <div class="workbench-without-stable-language-classes">
        <div>
          <div id="nowcoder-language-trigger"><span>C++（clang++18）</span><i></i></div>
          <span>ACM模式</span>
        </div>
        <div id="jsCodeEditor"><div class="monaco-editor"></div></div>
      </div>
      <div id="nowcoder-language-portal"></div>`;
    let selected = "";
    document.querySelector("#nowcoder-language-trigger")?.addEventListener("pointerdown", () => {
      setTimeout(() => {
        const portal = document.querySelector<HTMLElement>("#nowcoder-language-portal");
        if (!portal) return;
        portal.innerHTML = `
          <div><span>C++（clang++18）</span><span>Java</span><span id="nowcoder-python3">Python3</span></div>
          <div><span>Rust</span><span>C</span><span>Python2</span></div>`;
        document.querySelector("#nowcoder-python3")?.addEventListener("click", () => {
          selected = "Python3";
        });
      }, 100);
    });

    expect(await switchLanguage("python")).toBe(true);
    expect(selected).toBe("Python3");
  });

  it("selects Nowcoder's Element UI option even when popper hit testing points at the trigger", async () => {
    document.body.innerHTML = `
      <div class="subject-edit-header">
        <div id="element-language-trigger"><span>C++（clang++18）</span><i></i></div>
      </div>
      <div id="jsCodeEditor"><div class="monaco-editor"></div></div>
      <div class="language-select" style="display:none">
        <div class="language-list">
          <li id="element-cpp" class="el-select-dropdown__item"><span>C++（clang++18）</span></li>
          <li id="element-gpp" class="el-select-dropdown__item"><span>C++(g++ 13)</span></li>
          <li class="el-select-dropdown__item"><span>Python2</span></li>
          <li id="element-python3" class="el-select-dropdown__item"><span>Python3</span></li>
        </div>
      </div>`;
    const trigger = document.querySelector<HTMLElement>("#element-language-trigger")!;
    const triggerLabel = trigger.querySelector("span")!;
    const menu = document.querySelector<HTMLElement>(".language-select")!;
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      // A transformed Element UI popper can be visible while the browser's
      // centre-point hit test still reports the selector underneath it.
      value: () => trigger
    });
    trigger.addEventListener("click", () => { menu.style.display = "block"; });
    const select = (label: string) => {
      triggerLabel.textContent = label;
      menu.style.display = "none";
    };
    document.querySelector("#element-cpp")?.addEventListener("click", () => select("C++（clang++18）"));
    document.querySelector("#element-gpp")?.addEventListener("click", () => select("C++(g++ 13)"));
    document.querySelector("#element-python3")?.addEventListener("click", () => select("Python3"));
    try {
      expect(await switchLanguage("python")).toBe(true);
      expect(triggerLabel.textContent).toBe("Python3");
      expect(await switchLanguage("cpp")).toBe(true);
      expect(triggerLabel.textContent).toBe("C++（clang++18）");
    } finally {
      if (originalElementFromPoint) {
        Object.defineProperty(document, "elementFromPoint", { configurable: true, value: originalElementFromPoint });
      } else {
        delete (document as Document & { elementFromPoint?: typeof document.elementFromPoint }).elementFromPoint;
      }
    }
  });

  it("switches an asynchronous language picker away from and back to C++", async () => {
    document.body.innerHTML = `
      <div class="editor-workbench">
        <button id="roundtrip-language">C++</button>
        <div class="monaco-editor"></div>
      </div>
      <div id="roundtrip-menu"></div>`;
    const trigger = document.querySelector<HTMLButtonElement>("#roundtrip-language")!;
    const mountMenu = () => {
      const menu = document.querySelector<HTMLElement>("#roundtrip-menu")!;
      menu.innerHTML = "<span id='roundtrip-cpp'>C++</span><span id='roundtrip-python'>Python3</span>";
      document.querySelector("#roundtrip-cpp")?.addEventListener("click", () => {
        trigger.textContent = "C++";
        menu.innerHTML = "";
      });
      document.querySelector("#roundtrip-python")?.addEventListener("click", () => {
        trigger.textContent = "Python3";
        menu.innerHTML = "";
      });
    };
    trigger.addEventListener("pointerdown", mountMenu);

    expect(await switchLanguage("python")).toBe(true);
    expect(trigger.textContent).toBe("Python3");
    expect(await switchLanguage("cpp")).toBe(true);
    expect(trigger.textContent).toBe("C++");
  });

  it("reopens a dropdown whose closed options remain mounted before switching back", async () => {
    document.body.innerHTML = `
      <div class="persistent-workbench">
        <button id="persistent-trigger">C++</button>
        <div class="monaco-editor"></div>
      </div>
      <div id="persistent-menu" style="opacity:0;pointer-events:none">
        <span id="persistent-cpp">C++</span><span id="persistent-python">Python3</span><span>Java</span>
      </div>`;
    const trigger = document.querySelector<HTMLButtonElement>("#persistent-trigger")!;
    const menu = document.querySelector<HTMLElement>("#persistent-menu")!;
    let openCount = 0;
    trigger.addEventListener("pointerdown", () => {
      openCount += 1;
      menu.style.opacity = "1";
      menu.style.pointerEvents = "auto";
    });
    const select = (label: string) => {
      trigger.textContent = label;
      menu.style.opacity = "0";
      menu.style.pointerEvents = "none";
    };
    document.querySelector("#persistent-cpp")?.addEventListener("click", () => select("C++"));
    document.querySelector("#persistent-python")?.addEventListener("click", () => select("Python3"));

    expect(await switchLanguage("python")).toBe(true);
    expect(trigger.textContent).toBe("Python3");
    expect(await switchLanguage("cpp")).toBe(true);
    expect(trigger.textContent).toBe("C++");
    expect(openCount).toBe(2);
  });

  it("uses hit testing when a closed menu keeps the same apparently visible nodes", async () => {
    document.body.innerHTML = `
      <button id="hit-trigger">C++</button>
      <div id="hit-menu"><span id="hit-cpp">C++</span><span id="hit-python">Python3</span><span id="hit-java">Java</span></div>`;
    const trigger = document.querySelector<HTMLButtonElement>("#hit-trigger")!;
    const cpp = document.querySelector<HTMLElement>("#hit-cpp")!;
    const python = document.querySelector<HTMLElement>("#hit-python")!;
    const java = document.querySelector<HTMLElement>("#hit-java")!;
    const rect = (top: number) => ({
      x: 0, y: top, left: 0, top, right: 100, bottom: top + 20,
      width: 100, height: 20, toJSON: () => ({})
    }) as DOMRect;
    Object.defineProperty(trigger, "getBoundingClientRect", { value: () => rect(0) });
    Object.defineProperty(cpp, "getBoundingClientRect", { value: () => rect(50) });
    Object.defineProperty(python, "getBoundingClientRect", { value: () => rect(80) });
    Object.defineProperty(java, "getBoundingClientRect", { value: () => rect(110) });
    let open = false;
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: (_x: number, y: number) => {
        if (!open || y < 30) return trigger;
        if (y < 70) return cpp;
        if (y < 100) return python;
        return java;
      }
    });
    trigger.addEventListener("pointerdown", () => { open = true; });
    cpp.addEventListener("click", () => { trigger.textContent = "C++"; open = false; });
    python.addEventListener("click", () => { trigger.textContent = "Python3"; open = false; });
    try {
      expect(await switchLanguage("python")).toBe(true);
      expect(trigger.textContent).toBe("Python3");
      expect(await switchLanguage("cpp")).toBe(true);
      expect(trigger.textContent).toBe("C++");
    } finally {
      if (originalElementFromPoint) {
        Object.defineProperty(document, "elementFromPoint", { configurable: true, value: originalElementFromPoint });
      } else {
        delete (document as Document & { elementFromPoint?: typeof document.elementFromPoint }).elementFromPoint;
      }
    }
  });

  it("ignores a stale hidden language control when detecting the current language", () => {
    document.body.innerHTML = `
      <div style="display:none"><span class="ant-select-selection-item">Python3</span></div>
      <button data-e2e-locator="console-language-select">C++</button>`;
    expect(detectLanguage()).toBe("cpp");
  });

  it("prefers the selected language trigger over options in an open menu", () => {
    document.body.innerHTML = `
      <button data-e2e-locator="console-language-select" aria-expanded="true">C++</button>
      <div><span class="select-value">Python3</span><span>Java</span><span>C++</span></div>`;
    expect(detectLanguage()).toBe("cpp");
  });

  it("detects the current Nowcoder compiler label", () => {
    document.body.innerHTML = "<div class='select-view-value'>C++（clang++18）</div>";
    expect(detectLanguage()).toBe("cpp");
  });

  it("detects a Nowcoder compiler stored in a readonly input", () => {
    document.body.innerHTML = "<div id='jsCodeEditor'><input readonly value='Java 17'></div>";
    expect(detectLanguage()).toBe("java");
  });

  it("treats a directly embedded Nowcoder Monaco container as an IDE", () => {
    document.body.innerHTML = "<div class='monaco-editor'><div class='overflow-guard'></div></div>";
    expect(isEditorDomPresent()).toBe(true);
  });

  it("allows a Nowcoder problem URL to create an empty default-language file without editor internals", () => {
    expect(canCreateWithoutReadableEditor("nowcoder")).toBe(true);
    expect(languageWithSiteFallback("nowcoder", undefined, "cpp")).toBe("cpp");
    expect(canCreateWithoutReadableEditor("luogu")).toBe(false);
    expect(languageWithSiteFallback("luogu", undefined, "cpp")).toBeUndefined();
  });
});
