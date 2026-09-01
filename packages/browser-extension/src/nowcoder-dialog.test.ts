// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { dismissNowcoderAcceptedDialogInPage } from "./nowcoder-dialog";

describe("Nowcoder accepted dialog", () => {
  beforeEach(() => {
    dismissNowcoderAcceptedDialogInPage(true, -1);
    document.body.innerHTML = "";
  });

  it("clicks the close action in the page world", () => {
    document.body.innerHTML = `
      <div class="ivu-modal-wrap">
        <div class="ivu-modal">
          <div class="ivu-modal-header">恭喜通过本题</div>
          <a class="ivu-modal-close">×</a>
          <button>关闭</button><button>确定</button>
        </div>
      </div>`;
    const modal = document.querySelector(".ivu-modal-wrap")!;
    document.querySelector(".ivu-modal-close")!.addEventListener("click", () => modal.remove());
    expect(dismissNowcoderAcceptedDialogInPage(false)).toBe(true);
    expect(dismissNowcoderAcceptedDialogInPage()).toBe(true);
    expect(document.querySelector(".ivu-modal-wrap")).toBeNull();
  });

  it("finds a dialog rendered inside an open shadow root", () => {
    const host = document.body.appendChild(document.createElement("div"));
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<div><h2>恭喜你AC本题！</h2><button class="dialog-close">关闭</button></div>`;
    expect(dismissNowcoderAcceptedDialogInPage(false)).toBe(true);
  });

  it("does not close an ordinary confirmation dialog", () => {
    document.body.innerHTML = `<div role="dialog">确认提交代码吗？<button>关闭</button></div>`;
    expect(dismissNowcoderAcceptedDialogInPage()).toBe(false);
  });

  it("closes the accepted dialog when it appears after submission", async () => {
    expect(dismissNowcoderAcceptedDialogInPage(true, 2_000)).toBe(false);
    const modal = document.createElement("div");
    modal.innerHTML = `<h2>恭喜通过本题</h2><button class="modal-close">关闭</button>`;
    modal.querySelector("button")!.addEventListener("click", () => modal.remove());
    document.body.appendChild(modal);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(modal.isConnected).toBe(false);
  });
});
