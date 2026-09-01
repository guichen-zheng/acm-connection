// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  activateSubmissionControl,
  classifySubmissionStatus,
  findNowcoderPostSubmissionDismissControl,
  findSubmitControl,
  isCaptchaChallengePresent,
  observeSubmissionTransition,
  readCaptchaError,
  readSubmissionFeedback,
  readSubmissionStatus
} from "./submission";

describe("submission adapter", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it.each([
    ["luogu", "<button>提交评测</button>"],
    ["nowcoder", "<button>保存并提交</button>"],
    ["leetcode", "<button data-e2e-locator='console-submit-button'>提交</button>"],
    ["ybt", "<input type='submit' value='提交程序'>"]
  ] as const)("finds the %s submit control", (site, html) => {
    document.body.innerHTML = html;
    expect(findSubmitControl(site)).toBeDefined();
  });

  it("does not confuse submission-history links with submit controls", () => {
    document.body.innerHTML = "<a href='/record'>提交记录</a><button>运行</button>";
    expect(findSubmitControl("luogu")).toBeUndefined();
  });

  it("prefers Nowcoder's real workbench submit button over shortcut help with the same label", () => {
    document.body.innerHTML = `
      <div class="shortcut-popover"><button class="btn-item"><span>保存并提交</span></button></div>
      <div class="workbench"><button class="btn-submit">保存并提交</button></div>`;
    expect(findSubmitControl("nowcoder")?.classList.contains("btn-submit")).toBe(true);
  });

  it("uses Nowcoder's relocated visible submit button after the result panel opens", () => {
    document.body.innerHTML = `
      <div class="workbench"><button id="old" class="btn-submit">保存并提交</button></div>
      <div class="sticky-actions"><button id="current" class="btn-submit">保存并提交</button></div>`;
    const rect = (left: number, top: number) => ({
      x: left, y: top, left, top, width: 100, height: 40,
      right: left + 100, bottom: top + 40, toJSON: () => ({})
    } as DOMRect);
    document.querySelector<HTMLElement>("#old")!.getBoundingClientRect = () => rect(20, 100);
    document.querySelector<HTMLElement>("#current")!.getBoundingClientRect = () => rect(800, 650);
    expect(findSubmitControl("nowcoder")?.id).toBe("current");
  });

  it("ignores a submit control inside a hidden ancestor", () => {
    document.body.innerHTML = `
      <div style="display:none"><button class="btn-submit">保存并提交</button></div>
      <div class="workbench"><button class="btn-submit">保存并提交</button></div>`;
    expect(findSubmitControl("nowcoder")?.closest(".workbench")).not.toBeNull();
  });

  it("finds Nowcoder's close button in the accepted-submission rating dialog", () => {
    document.body.innerHTML = `
      <div class="nc-modal">
        <header>恭喜通过本题</header>
        <p>恭喜你AC本题！</p>
        <footer><button class="cancel">关闭</button><button>确定</button></footer>
      </div>`;
    expect(findNowcoderPostSubmissionDismissControl()?.textContent).toBe("关闭");
  });

  it("activates Nowcoder's close button with pointer and mouse events", () => {
    document.body.innerHTML = `
      <div class="nc-modal">
        <header>恭喜通过本题</header>
        <button class="close">关闭</button>
      </div>`;
    const events: string[] = [];
    const button = findNowcoderPostSubmissionDismissControl()!;
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      button.addEventListener(type, () => events.push(type));
    }
    activateSubmissionControl(button);
    expect(events).toEqual(["pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
  });

  it("does not dismiss an ordinary Nowcoder confirmation dialog", () => {
    document.body.innerHTML = `
      <div role="dialog"><p>确认提交代码吗？</p><button>关闭</button><button>确定</button></div>`;
    expect(findNowcoderPostSubmissionDismissControl()).toBeUndefined();
  });

  it("finds a Luogu custom action rendered as a link", () => {
    document.body.innerHTML = "<a class='lfe-form-sz-small'><span>提交</span></a>";
    expect(findSubmitControl("luogu")?.tagName).toBe("A");
  });

  it("finds a Luogu labelled custom component with a keyboard hint", () => {
    document.body.innerHTML = "<div class='action'><span>提交评测（Ctrl+Enter）</span></div>";
    expect(findSubmitControl("luogu")?.textContent).toContain("提交评测");
  });

  it.each([
    ["Accepted", "finished", true],
    ["通过 57 / 57 个测试用例", "finished", true],
    ["答案错误 Wrong Answer", "finished", false],
    ["错误解答", "finished", false],
    ["编译出错", "finished", false],
    ["执行出错", "finished", false],
    ["违反限制", "finished", false],
    ["超出内存限制", "finished", false],
    ["正在编译代码", "judging", undefined],
    ["正在评测中", "judging", undefined]
  ] as const)("classifies %s", (text, phase, success) => {
    expect(classifySubmissionStatus(text)).toMatchObject({ phase, ...(success === undefined ? {} : { success }) });
  });

  it("reads a LeetCode result without scanning the problem statement", () => {
    document.body.innerHTML = "<main>题目要求判断是否通过</main><div class='submission-result'>全部通过</div>";
    expect(readSubmissionStatus("leetcode")).toMatchObject({ phase: "finished", success: true });
  });

  it("reads LeetCode's current console-result marker", () => {
    document.body.innerHTML = "<div data-e2e-locator='console-result'>错误解答</div>";
    expect(readSubmissionStatus("leetcode")).toMatchObject({ phase: "finished", success: false });
  });

  it("returns LeetCode compilation success with runtime and memory", () => {
    document.body.innerHTML = `
      <div data-e2e-locator="console-result">
        <strong>通过</strong>
        <span>执行用时：3 ms</span><span>内存消耗：18.2 MB</span>
      </div>`;
    expect(readSubmissionStatus("leetcode")).toEqual({
      phase: "finished",
      status: "通过\n编译成功 · 执行用时 3ms · 内存消耗 18.2MB",
      success: true
    });
  });

  it("reads LeetCode success metrics from distribution cards outside the result", () => {
    document.body.innerHTML = `
      <div data-e2e-locator="console-result"><strong>通过</strong></div>
      <section><h3>执行用时分布</h3><span>0 ms</span><span>击败 100.00%</span></section>
      <section><h3>消耗内存分布</h3><span>17.05 MB</span><span>击败 99.37%</span></section>`;
    expect(readSubmissionStatus("leetcode")).toEqual({
      phase: "finished",
      status: "通过\n编译成功 · 执行用时 0ms · 内存消耗 17.05MB",
      success: true
    });
  });

  it("returns LeetCode compiler diagnostics", () => {
    document.body.innerHTML = `
      <div data-e2e-locator="console-result">
        <h3>编译出错</h3>
        <pre>Line 7: Char 5: error: use of undeclared identifier 'answer'</pre>
      </div>`;
    expect(readSubmissionStatus("leetcode")).toEqual({
      phase: "finished",
      status: "CE Compilation Error\nLine 7: Char 5: error: use of undeclared identifier 'answer'",
      success: false,
      allAccepted: false
    });
  });

  it("returns LeetCode wrong-answer testcase details", () => {
    document.body.innerHTML = `
      <div data-e2e-locator="console-result">
        <strong>错误解答</strong>
        <pre>输入\nnums = [1,2]\n输出\n1\n预期结果\n2</pre>
      </div>`;
    const status = readSubmissionStatus("leetcode");
    expect(status).toMatchObject({ phase: "finished", success: false });
    expect(status?.status).toContain("编译成功");
    expect(status?.status).toContain("nums = [1,2]");
    expect(status?.status).toContain("预期结果");
  });

  it("returns LeetCode's restriction violation as a terminal failure", () => {
    document.body.innerHTML = "<div data-e2e-locator='console-result'>违反限制</div>";
    expect(readSubmissionStatus("leetcode")).toEqual({
      phase: "finished",
      status: "违反限制",
      success: false
    });
  });

  it("returns LeetCode's red restriction detail", () => {
    document.body.innerHTML = `
      <h2>违反限制</h2>
      <div class="error-message">Line 7: Variable 'n' is used but not defined, causing a compilation error.</div>`;
    expect(readSubmissionStatus("leetcode")).toEqual({
      phase: "finished",
      status: "违反限制\nLine 7: Variable 'n' is used but not defined, causing a compilation error.",
      success: false
    });
  });

  it("treats a future unknown LeetCode console verdict as terminal", () => {
    document.body.innerHTML = "<div data-e2e-locator='console-result'>新的失败状态</div>";
    expect(readSubmissionStatus("leetcode")).toEqual({
      phase: "finished",
      status: "新的失败状态",
      success: false
    });
  });

  it("observes a same-verdict LeetCode result replacement", async () => {
    document.body.innerHTML = "<div data-e2e-locator='console-result'>通过</div>";
    const transition = observeSubmissionTransition("leetcode");
    document.querySelector("[data-e2e-locator='console-result']")?.replaceWith(
      Object.assign(document.createElement("div"), {
        textContent: "通过"
      })
    );
    await Promise.resolve();
    expect(transition.hasChanged()).toBe(true);
    transition.disconnect();
  });

  it("observes Nowcoder runtime and memory changes when the verdict stays accepted", async () => {
    document.body.innerHTML = `
      <div class="workbench"><div class="composite-panel">
        <div>答案正确 通过全部用例</div><span>运行时间 142ms</span><span>占用内存 2556KB</span>
      </div></div>`;
    const transition = observeSubmissionTransition("nowcoder");
    document.querySelectorAll("span")[0].textContent = "运行时间 143ms";
    document.querySelectorAll("span")[1].textContent = "占用内存 2644KB";
    await Promise.resolve();
    expect(transition.hasChanged()).toBe(true);
    transition.disconnect();
  });

  it("aggregates Luogu AC test-point cards on a record page", () => {
    document.body.innerHTML = [1, 2, 3].map((id) =>
      `<div class='test-case'><b>#${id}</b><span>AC</span><small>4ms / 788KB</small></div>`
    ).join("");
    expect(readSubmissionStatus("luogu")).toMatchObject({
      phase: "finished",
      status: "Accepted（3 个测试点全部 AC）",
      success: true,
      allAccepted: true,
      testPoints: [
        { id: "1", verdict: "AC", time: "4ms", memory: "788KB" },
        { id: "2", verdict: "AC", time: "4ms", memory: "788KB" },
        { id: "3", verdict: "AC", time: "4ms", memory: "788KB" }
      ]
    });
  });

  it("returns the first failed Luogu test-point verdict", () => {
    document.body.innerHTML = "<div><span>AC</span></div><div><span>WA</span></div>";
    expect(readSubmissionStatus("luogu")).toMatchObject({
      phase: "finished",
      success: false
    });
  });

  it("returns Luogu compiler output as a terminal CE result", () => {
    document.body.innerHTML = `
      <h2>编译信息</h2>
      <strong>编译失败</strong>
      <pre>No valid executable file was produced by the compiler
/nix/store/bin/ld: (.text+0x1b): undefined reference to main
collect2: 错误: ld 返回 1</pre>`;
    expect(readSubmissionStatus("luogu")).toMatchObject({
      phase: "finished",
      success: false,
      allAccepted: false
    });
    expect(readSubmissionStatus("luogu")?.status).toContain("CE Compilation Error");
    expect(readSubmissionStatus("luogu")?.status).toContain("undefined reference to main");
  });

  it("detects a visible captcha input", () => {
    document.body.innerHTML = "<div class='captcha-dialog'><input placeholder='请输入验证码'></div>";
    expect(isCaptchaChallengePresent()).toBe(true);
  });

  it("ignores LeetCode's passive reCAPTCHA scaffolding", () => {
    document.body.innerHTML = `
      <div class="grecaptcha-badge">
        <iframe src="https://www.google.com/recaptcha/api2/anchor" title="reCAPTCHA"></iframe>
      </div>`;
    expect(isCaptchaChallengePresent()).toBe(false);
  });

  it("ignores a hidden captcha response field", () => {
    document.body.innerHTML = "<input type='hidden' name='captcha-response'>";
    expect(isCaptchaChallengePresent()).toBe(false);
  });

  it("detects an interactive verification dialog without a named captcha input", () => {
    document.body.innerHTML = `
      <div role="dialog"><p>请完成人机验证</p><input name="answer"><button>确认</button></div>`;
    expect(isCaptchaChallengePresent()).toBe(true);
  });

  it("recognizes Nowcoder's post-submission query message as real progress", () => {
    document.body.innerHTML = `
      <main>题目描述中提到正在评测</main>
      <div class="workbench"><div class="composite-panel">正在查询结果...</div></div>`;
    expect(readSubmissionFeedback("nowcoder")).toEqual({ kind: "progress", text: "正在查询结果..." });
  });

  it("does not treat Nowcoder's pre-request message as confirmed submission", () => {
    document.body.innerHTML = `
      <div class="workbench"><div class="composite-panel">正在提交代码...</div></div>`;
    expect(readSubmissionFeedback("nowcoder")).toBeUndefined();
  });

  it("returns a Nowcoder submission error from the workbench", () => {
    document.body.innerHTML = `
      <div class="workbench"><div class="composite-panel">代码提交失败，请再次运行</div></div>`;
    expect(readSubmissionFeedback("nowcoder")).toEqual({
      kind: "error",
      text: "代码提交失败，请再次运行"
    });
  });

  it("returns Nowcoder compilation success with runtime and memory", () => {
    document.body.innerHTML = `
      <div class="workbench"><div class="composite-panel">
        <strong>答案正确</strong><span>通过全部用例</span>
        <span>运行时间 143ms</span><span>占用内存 2644KB</span>
      </div></div>`;
    expect(readSubmissionStatus("nowcoder")).toEqual({
      phase: "finished",
      status: "答案正确\n编译成功 · 运行时间 143ms · 占用内存 2644KB",
      success: true
    });
  });

  it("returns Nowcoder compiler diagnostics", () => {
    document.body.innerHTML = `
      <div class="workbench">
        <nav>运行结果　自测输入　自测运行</nav><button class="btn-submit">保存并提交</button>
        <p>您的代码已保存</p>
        <div class="composite-panel">
          <h3>编译错误</h3>
          <div class="compile-result">编译错误:您提交的代码无法完成编译
main.cpp:7:5: error: expected ';' after expression
return 0</div>
        </div>
      </div>`;
    expect(readSubmissionStatus("nowcoder")).toEqual({
      phase: "finished",
      status: "CE Compilation Error\n编译错误:您提交的代码无法完成编译\nmain.cpp:7:5: error: expected ';' after expression\nreturn 0",
      success: false,
      allAccepted: false
    });
    expect(readSubmissionStatus("nowcoder")?.status).not.toMatch(/保存并提交|运行结果|自测输入|您的代码已保存/);
  });

  it.each([
    "验证码错误",
    "验证码无效，请重试",
    "验证失败"
  ])("detects the captcha failure message %s", (message) => {
    document.body.innerHTML = `<div class='toast'><span>${message}</span></div>`;
    expect(readCaptchaError()).toBe(message);
  });
});
