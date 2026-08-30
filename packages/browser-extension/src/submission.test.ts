// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { classifySubmissionStatus, findSubmitControl, readSubmissionStatus } from "./submission";

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

  it.each([
    ["Accepted", "finished", true],
    ["通过 57 / 57 个测试用例", "finished", true],
    ["答案错误 Wrong Answer", "finished", false],
    ["正在评测中", "judging", undefined]
  ] as const)("classifies %s", (text, phase, success) => {
    expect(classifySubmissionStatus(text)).toMatchObject({ phase, ...(success === undefined ? {} : { success }) });
  });

  it("reads a LeetCode result without scanning the problem statement", () => {
    document.body.innerHTML = "<main>题目要求判断是否通过</main><div class='submission-result'>全部通过</div>";
    expect(readSubmissionStatus("leetcode")).toMatchObject({ phase: "finished", success: true });
  });
});
