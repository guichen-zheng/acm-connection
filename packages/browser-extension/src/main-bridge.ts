export function mainBridgeBootstrap(token: string): void {
  const requestSource = "algo-sync-content";
  const responseSource = "algo-sync-main";

  window.addEventListener("message", (event) => {
    const data = event.data as Record<string, unknown> | undefined;
    if (event.source !== window || !data || data.source !== requestSource || data.token !== token || typeof data.requestId !== "string") {
      return;
    }
    const respond = (payload: Record<string, unknown>) => {
      window.postMessage({ source: responseSource, token, requestId: data.requestId, ...payload }, "*");
    };
    void handleRequest(data, respond);
  });

  async function handleRequest(
    data: Record<string, unknown>,
    respond: (payload: Record<string, unknown>) => void
  ): Promise<void> {
    try {
      const editor = locateEditor() ?? await locateAmdMonacoEditor();
      if (!editor) {
        respond({ ok: false, message: "未找到受支持的代码编辑器" });
        return;
      }
      if (data.action === "read") {
        respond({
          ok: true,
          code: editor.getValue(),
          editor: editor.kind,
          language: editor.getLanguage?.()
        });
      } else if (data.action === "write" && typeof data.code === "string") {
        editor.setValue(data.code);
        respond({ ok: true, editor: editor.kind });
      } else {
        respond({ ok: false, message: "未知编辑器操作" });
      }
    } catch (error) {
      respond({ ok: false, message: error instanceof Error ? error.message : String(error) });
    }
  }

  function locateEditor(): {
    kind: string;
    getValue(): string;
    setValue(value: string): void;
    getLanguage?(): string | undefined;
  } | undefined {
    const page = window as unknown as {
      monaco?: { editor?: { getModels?: () => Array<{
        getValue(): string;
        setValue(value: string): void;
        getLanguageId?(): string;
      }> } };
      ace?: { edit(element: Element): { getValue(): string; setValue(value: string, cursor?: number): void } };
    };
    const models = page.monaco?.editor?.getModels?.() ?? [];
    if (models.length) {
      const model = models.find((item) => typeof item.getValue() === "string") ?? models[0];
      return {
        kind: "monaco",
        getValue: () => model.getValue(),
        setValue: (value) => model.setValue(value),
        getLanguage: () => model.getLanguageId?.()
      };
    }

    // Nowcoder mounts its editor in a Vue 2 component and bundles Monaco inside
    // webpack, so neither window.monaco nor the AMD loader is necessarily public.
    // The component's own valCode method is also what the site's submit action
    // reads, making it the most reliable way to keep site state in sync.
    const nowcoderVueEditor = locateNowcoderVueEditor();
    if (nowcoderVueEditor) return nowcoderVueEditor;

    for (const element of Array.from(document.querySelectorAll<HTMLElement>(".CodeMirror"))) {
      const codeMirror = (element as unknown as { CodeMirror?: {
        getValue(): string;
        setValue(value: string): void;
        getOption?(name: string): unknown;
      } }).CodeMirror;
      if (codeMirror) return {
        kind: "codemirror",
        getValue: () => codeMirror.getValue(),
        setValue: (value) => codeMirror.setValue(value),
        getLanguage: () => languageFromCodeMirrorMode(codeMirror.getOption?.("mode"))
      };
    }

    const codeMirror6Content = document.querySelector<HTMLElement>(".cm-editor .cm-content");
    const codeMirror6View = (codeMirror6Content as unknown as {
      cmView?: {
        view?: {
          state: { doc: { length: number; toString(): string } };
          dispatch(transaction: { changes: { from: number; to: number; insert: string } }): void;
          focus?: () => void;
        };
      };
    } | null)?.cmView?.view;
    if (codeMirror6View?.state?.doc && typeof codeMirror6View.dispatch === "function") {
      return {
        kind: "codemirror6",
        getValue: () => codeMirror6View.state.doc.toString(),
        setValue: (value) => {
          codeMirror6View.dispatch({
            changes: { from: 0, to: codeMirror6View.state.doc.length, insert: value }
          });
          codeMirror6View.focus?.();
        }
      };
    }

    const codeMirror6Editable = document.querySelector<HTMLElement>(
      ".cm-editor .cm-content[contenteditable='true']"
    );
    if (codeMirror6Editable) {
      return {
        kind: "codemirror6-contenteditable",
        getValue: () => codeMirror6Editable.innerText || codeMirror6Editable.textContent || "",
        setValue: (value) => {
          codeMirror6Editable.focus();
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(codeMirror6Editable);
          selection?.removeAllRanges();
          selection?.addRange(range);
          const inserted = document.execCommand("insertText", false, value);
          selection?.removeAllRanges();
          if (!inserted) throw new Error("CodeMirror 6 拒绝了浏览器文本输入命令");
        }
      };
    }

    const aceElement = document.querySelector(".ace_editor");
    if (aceElement && page.ace) {
      const editor = page.ace.edit(aceElement);
      return { kind: "ace", getValue: () => editor.getValue(), setValue: (value) => editor.setValue(value, -1) };
    }

    const textareas = Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea"))
      .filter((item) => {
        const style = getComputedStyle(item);
        const insideManagedEditor = item.closest(".monaco-editor, .cm-editor, .CodeMirror, .ace_editor") !== null;
        return !item.disabled && !insideManagedEditor && style.display !== "none" && style.visibility !== "hidden" &&
          item.clientWidth > 20 && item.clientHeight > 20;
      })
      .sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight));
    const textarea = textareas[0];
    if (!textarea) return undefined;
    return {
      kind: "textarea",
      getValue: () => textarea.value,
      setValue: (value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        setter?.call(textarea, value);
        textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: null }));
        textarea.dispatchEvent(new Event("change", { bubbles: true }));
      }
    };
  }

  function locateNowcoderVueEditor(): {
    kind: string;
    getValue(): string;
    setValue(value: string): void;
    getLanguage?(): string | undefined;
  } | undefined {
    const mount = document.querySelector<HTMLElement>("#jsCodeEditor");
    if (!mount) return undefined;

    type VueComponent = {
      $children?: VueComponent[];
      valCode?: (value?: string) => unknown;
      valLangue?: () => unknown;
      currentLang?: unknown;
      currentLangItem?: { text?: unknown; value?: unknown };
      editor?: { getValue?: () => unknown; setValue?: (value: string) => void };
    };
    const roots: VueComponent[] = [];
    for (const element of [mount, ...Array.from(mount.querySelectorAll<HTMLElement>("*"))]) {
      const component = (element as HTMLElement & { __vue__?: VueComponent }).__vue__;
      if (component) roots.push(component);
    }

    const pending = [...roots];
    const visited = new Set<VueComponent>();
    while (pending.length) {
      const component = pending.shift()!;
      if (visited.has(component)) continue;
      visited.add(component);
      if (typeof component.valCode === "function" &&
        typeof component.editor?.getValue === "function" &&
        typeof component.editor?.setValue === "function") {
        return {
          kind: "nowcoder-vue",
          getValue: () => String(component.valCode!() ?? ""),
          setValue: (value) => { component.valCode!(value); },
          getLanguage: () => {
            const itemValue = component.currentLangItem?.text ?? component.currentLangItem?.value;
            const value = itemValue ?? (typeof component.valLangue === "function"
              ? component.valLangue()
              : component.currentLang);
            return typeof value === "string" ? value : undefined;
          }
        };
      }
      if (Array.isArray(component.$children)) pending.push(...component.$children);
    }
    return undefined;
  }

  function languageFromCodeMirrorMode(mode: unknown): string | undefined {
    const raw = typeof mode === "string"
      ? mode
      : mode && typeof mode === "object" && "name" in mode
        ? String((mode as { name?: unknown }).name ?? "")
        : "";
    const value = raw.toLowerCase();
    if (/c\+\+|cpp|cxx/.test(value)) return "cpp";
    if (/x-csrc|(^|\W)c($|\W)/.test(value)) return "c";
    if (value.includes("python")) return "python";
    if (value.includes("java") && !value.includes("javascript")) return "java";
    if (/javascript|node/.test(value)) return "javascript";
    if (/(^|\W)go($|\W)|golang/.test(value)) return "go";
    if (value.includes("rust")) return "rust";
    return raw || undefined;
  }

  async function locateAmdMonacoEditor(): Promise<{
    kind: string;
    getValue(): string;
    setValue(value: string): void;
    getLanguage?(): string | undefined;
  } | undefined> {
    if (!document.querySelector(".monaco-editor")) return undefined;
    const page = window as unknown as {
      monaco?: { editor?: { getModels?: () => Array<{
        getValue(): string;
        setValue(value: string): void;
        getLanguageId?(): string;
      }> } };
      require?: {
        (moduleId: string): unknown;
        (moduleIds: string[], success: (module: unknown) => void, failure?: () => void): void;
      };
    };
    if (typeof page.require !== "function") return undefined;

    let api: unknown;
    try {
      api = page.require("vs/editor/editor.main");
    } catch {
      api = await new Promise((resolve) => {
        let settled = false;
        const finish = (value: unknown) => {
          if (!settled) {
            settled = true;
            resolve(value);
          }
        };
        page.require!(["vs/editor/editor.main"], finish, () => finish(undefined));
        window.setTimeout(() => finish(undefined), 1_000);
      });
    }
    const monaco = page.monaco ?? api as typeof page.monaco;
    const models = monaco?.editor?.getModels?.() ?? [];
    const model = models[0];
    if (!model) return undefined;
    return {
      kind: "monaco-amd",
      getValue: () => model.getValue(),
      setValue: (value) => model.setValue(value),
      getLanguage: () => model.getLanguageId?.()
    };
  }
}
