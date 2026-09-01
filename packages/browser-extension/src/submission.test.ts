// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  classifySubmissionStatus,
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

  it("ignores a submit control inside a hidden ancestor", () => {
    document.body.innerHTML = `
      <div style="display:none"><button class="btn-submit">保存并提交</button></div>
      <div class="workbench"><button class="btn-submit">保存并提交</button></div>`;
    expect(findSubmitControl("nowcoder")?.closest(".workbench")).not.toBeNull();
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

  it("returns LeetCode's restriction violation as a terminal failure", () => {
    document.body.innerHTML = "<div data-e2e-locator='console-result'>违反限制</div>";
    expect(readSubmissionStatus("leetcode")).toEqual({
      phase: "finished",
      status: "违反限制",
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

  it.each([
    "验证码错误",
    "验证码无效，请重试",
    "验证失败"
  ])("detects the captcha failure message %s", (message) => {
    document.body.innerHTML = `<div class='toast'><span>${message}</span></div>`;
    expect(readCaptchaError()).toBe(message);
  });
});
