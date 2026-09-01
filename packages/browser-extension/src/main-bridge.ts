export function mainBridgeBootstrap(token: string, pageHostname = location.hostname): void {
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
      const expectedLanguage = typeof data.language === "string" ? data.language : undefined;
      if (data.action === "switchLanguage" && expectedLanguage) {
        if (await clickLuoguLanguageOption(expectedLanguage)) {
          respond({ ok: true, editor: "luogu-option" });
          return;
        }
        if (switchLuoguVueLanguage(expectedLanguage)) {
          respond({ ok: true, editor: "luogu-vue" });
          return;
        }
      }
      if (data.action === "switchLanguage" && expectedLanguage && clickMountedNowcoderLanguageOption(expectedLanguage)) {
        respond({ ok: true, editor: "nowcoder-option" });
        return;
      }
      // On Nowcoder the Vue component owns the selected compiler and code for
      // every language. Prefer it over a stale Monaco model that can remain
      // attached while this tab is in the background.
      const nowcoderEditor = /(?:^|\.)nowcoder\.com$/i.test(pageHostname)
        ? locateNowcoderVueEditor()
        : undefined;
      const editor = nowcoderEditor ?? (data.action === "switchLanguage" ? locateNowcoderVueEditor() : undefined) ??
        locateEditor(expectedLanguage) ?? await locateAmdMonacoEditor(expectedLanguage);
      if (!editor) {
        respond({ ok: false, message: "未找到受支持的代码编辑器" });
        return;
      }
      if (data.action === "read") {
        respond({
          ok: true,
          code: editor.getValue(),
          editor: editor.kind,
          language: editor.getLanguage?.(),
          template: editor.getTemplate?.()
        });
      } else if (data.action === "write" && typeof data.code === "string") {
        editor.setValue(data.code);
        respond({ ok: true, editor: editor.kind });
      } else if (data.action === "switchLanguage" && typeof data.language === "string") {
        if (!editor.setLanguage) {
          respond({ ok: false, message: "当前编辑器没有提供语言切换接口" });
          return;
        }
        const selected = editor.setLanguage(data.language);
        respond(selected
          ? { ok: true, editor: editor.kind }
          : { ok: false, message: `当前编辑器没有 ${data.language} 语言选项` });
      } else {
        respond({ ok: false, message: "未知编辑器操作" });
      }
    } catch (error) {
      respond({ ok: false, message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function clickLuoguLanguageOption(language: string): Promise<boolean> {
    if (!/(?:^|\.)luogu\.com\.cn$/i.test(pageHostname)) return false;
    const control = document.querySelector<HTMLElement>(".ide-toolbar .combo-wrapper.lang-select");
    if (!control) return false;

    // LCombo teleports its dropdown to #app, so the language rows are not
    // descendants of the toolbar control. If a previous attempt left it open,
    // consume that row first; otherwise open the control and wait for v-show.
    let option = findVisibleOption();
    if (!option) {
      control.click();
      const deadline = Date.now() + 2_000;
      do {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
        option = findVisibleOption();
      } while (!option && Date.now() < deadline);
    }
    if (!option) return false;
    option.click();
    return true;

    function findVisibleOption(): HTMLElement | undefined {
      return Array.from(document.querySelectorAll<HTMLElement>("#app .dropdown li, body > .dropdown li"))
        .map((item) => ({ item, score: luoguLanguageLabelScore(language, item.textContent ?? "") }))
        .filter(({ item, score }) => Number.isFinite(score) && isRendered(item))
        .sort((left, right) => left.score - right.score)[0]?.item;
    }

    function isRendered(element: HTMLElement): boolean {
      for (let current: HTMLElement | null = element; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        // LCombo intentionally starts its opening animation at opacity: 0.
        // display:none is the reliable closed-state marker; waiting for the
        // animation would make a background tab depend on throttled RAF.
        if (current.hidden || style.display === "none" || style.visibility === "hidden" ||
          style.pointerEvents === "none") return false;
      }
      return true;
    }
  }

  function switchLuoguVueLanguage(language: string): boolean {
    if (!/(?:^|\.)luogu\.com\.cn$/i.test(pageHostname)) return false;

    type LuoguLanguageOption = {
      value?: unknown;
      label?: unknown;
      disabled?: unknown;
    };
    type VueVNode = {
      component?: VueComponent | null;
      children?: unknown;
      dynamicChildren?: VueVNode[] | null;
      props?: Record<string, unknown> | null;
    };
    type VueComponent = {
      parent?: VueComponent | null;
      root?: VueComponent | null;
      subTree?: VueVNode | null;
      vnode?: VueVNode | null;
      emit?: (event: string, ...args: unknown[]) => void;
    };

    const componentQueue: VueComponent[] = [];
    const candidateElements = Array.from(document.querySelectorAll<HTMLElement>([
      ".ide-toolbar",
      ".ide-toolbar *",
      ".lang-select"
    ].join(",")));
    for (const element of candidateElements) {
      const component = (element as HTMLElement & { __vueParentComponent?: VueComponent }).__vueParentComponent;
      if (component) componentQueue.push(component);
    }
    if (componentQueue.length === 0) return false;

    const vnodeQueue: VueVNode[] = [];
    const visitedComponents = new Set<VueComponent>();
    const visitedVnodes = new Set<VueVNode>();
    while (componentQueue.length > 0) {
      const component = componentQueue.shift()!;
      if (visitedComponents.has(component)) continue;
      visitedComponents.add(component);
      if (component.vnode) vnodeQueue.push(component.vnode);
      if (component.subTree) vnodeQueue.push(component.subTree);
      if (component.parent) componentQueue.push(component.parent);
      if (component.root && component.root !== component) componentQueue.push(component.root);
    }

    const candidates: Array<{
      props: Record<string, unknown>;
      target: LuoguLanguageOption;
      score: number;
      emit?: VueComponent["emit"];
    }> = [];
    while (vnodeQueue.length > 0) {
      const vnode = vnodeQueue.shift()!;
      if (!vnode || visitedVnodes.has(vnode)) continue;
      visitedVnodes.add(vnode);
      const component = vnode.component ?? undefined;
      if (component && !visitedComponents.has(component)) {
        visitedComponents.add(component);
        if (component.vnode) vnodeQueue.push(component.vnode);
        if (component.subTree) vnodeQueue.push(component.subTree);
      }
      const props = vnode.props;
      const options = Array.isArray(props?.options)
        ? props.options.filter((item): item is LuoguLanguageOption => Boolean(item) && typeof item === "object")
        : [];
      const target = options
        .map((option) => ({ option, score: luoguLanguageScore(language, option) }))
        .filter(({ option, score }) => option.disabled !== true && Number.isFinite(score))
        .sort((left, right) => left.score - right.score)[0];
      if (props && target) {
        const className = String(props.class ?? "");
        // The IDE selector uses exactly `lang-select`; the submit dialog also
        // owns a language selector but adds `light-black inline`.
        const locationScore = className.trim() === "lang-select" ? 0 : className.includes("lang-select") ? 10 : 20;
        candidates.push({
          props,
          target: target.option,
          score: locationScore + target.score,
          emit: component?.emit
        });
      }
      enqueueVnodes(vnode.children);
      enqueueVnodes(vnode.dynamicChildren);
    }

    const selected = candidates.sort((left, right) => left.score - right.score)[0];
    if (!selected || selected.target.value === undefined || selected.target.value === null) return false;
    const handler = selected.props["onUpdate:modelValue"];
    if (invokeVueHandler(handler, selected.target.value)) return true;
    if (typeof selected.emit === "function") {
      selected.emit("update:modelValue", selected.target.value);
      return true;
    }
    return false;

    function enqueueVnodes(value: unknown): void {
      if (Array.isArray(value)) {
        for (const item of value) enqueueVnodes(item);
        return;
      }
      if (value && typeof value === "object" && ("props" in value || "component" in value || "children" in value)) {
        vnodeQueue.push(value as VueVNode);
      }
    }

    function invokeVueHandler(handler: unknown, value: unknown): boolean {
      if (typeof handler === "function") {
        (handler as (nextValue: unknown) => void)(value);
        return true;
      }
      if (!Array.isArray(handler)) return false;
      let invoked = false;
      for (const item of handler) {
        if (typeof item !== "function") continue;
        (item as (nextValue: unknown) => void)(value);
        invoked = true;
      }
      return invoked;
    }

    function luoguLanguageScore(wanted: string, option: LuoguLanguageOption): number {
      const id = typeof option.value === "number" ? option.value : Number(option.value);
      const label = String(option.label ?? "").replace(/（/g, "(").replace(/）/g, ")").replace(/\s+/g, " ").trim();
      if (wanted === "python") {
        if (id === 7 || /^python\s*3(?:\s|$|\()/i.test(label)) return 0;
        if (id === 25 || /^pypy\s*3(?:\s|$|\()/i.test(label)) return 1;
        return Number.POSITIVE_INFINITY;
      }
      if (wanted === "cpp") {
        if (id === 28 || /^c\+\+14\s*\(gcc\s*9\)$/i.test(label)) return 0;
        if (/^c\+\+14(?:\s|$|\()/i.test(label)) return 1;
        if (/^c\+\+(?:17|20|23)(?:\s|$|\()/i.test(label)) return 2;
        if (/^c\+\+(?:11|98)(?:\s|$|\()/i.test(label)) return 3;
        return Number.POSITIVE_INFINITY;
      }
      if (wanted === "c") {
        return id === 2 || /^c(?:\s|$|\()/i.test(label) ? 0 : Number.POSITIVE_INFINITY;
      }
      if (wanted === "java") {
        if (id === 8 || /^java\s*8(?:\s|$|\()/i.test(label)) return 0;
        if (id === 33 || /^java\s*21(?:\s|$|\()/i.test(label)) return 1;
        return Number.POSITIVE_INFINITY;
      }
      return Number.POSITIVE_INFINITY;
    }
  }

  function luoguLanguageLabelScore(wanted: string, rawLabel: string): number {
    const label = rawLabel.replace(/（/g, "(").replace(/）/g, ")").replace(/\s+/g, " ").trim();
    if (wanted === "python") {
      if (/^python\s*3(?:\s|$|\()/i.test(label)) return 0;
      if (/^pypy\s*3(?:\s|$|\()/i.test(label)) return 1;
      return Number.POSITIVE_INFINITY;
    }
    if (wanted === "cpp") {
      if (/^c\+\+14\s*\(gcc\s*9\)$/i.test(label)) return 0;
      if (/^c\+\+14(?:\s|$|\()/i.test(label)) return 1;
      if (/^c\+\+(?:17|20|23)(?:\s|$|\()/i.test(label)) return 2;
      if (/^c\+\+(?:11|98)(?:\s|$|\()/i.test(label)) return 3;
      return Number.POSITIVE_INFINITY;
    }
    if (wanted === "c") return /^c(?:\s|$|\()/i.test(label) ? 0 : Number.POSITIVE_INFINITY;
    if (wanted === "java") {
      if (/^java\s*8(?:\s|$|\()/i.test(label)) return 0;
      if (/^java\s*21(?:\s|$|\()/i.test(label)) return 1;
      return Number.POSITIVE_INFINITY;
    }
    return Number.POSITIVE_INFINITY;
  }

  function clickMountedNowcoderLanguageOption(language: string): boolean {
    if (!/(?:^|\.)nowcoder\.com$/i.test(pageHostname)) return false;
    const option = Array.from(document.querySelectorAll<HTMLElement>(
      ".language-select .el-select-dropdown__item"
    ))
      .map((item, index) => ({
        item,
        index,
        score: nowcoderLanguageScore(language, (item.textContent ?? "").replace(/\s+/g, " ").trim())
      }))
      .filter(({ item, score }) => !item.classList.contains("is-disabled") && Number.isFinite(score))
      .sort((left, right) => left.score - right.score || right.index - left.index)[0]?.item;
    if (!option) return false;
    // The site's bundled ElOption listens for one click on this li and then
    // dispatches handleOptionClick to ElSelect. This also works while v-show
    // keeps the surrounding popper closed.
    option.click();
    return true;
  }

  function locateEditor(expectedLanguage?: string): {
    kind: string;
    getValue(): string;
    setValue(value: string): void;
    getLanguage?(): string | undefined;
    getTemplate?(): string | undefined;
    setLanguage?(language: string): boolean;
  } | undefined {
    type MonacoModel = {
      getValue(): string;
      setValue(value: string): void;
      getLanguageId?(): string;
    };
    type MonacoEditorInstance = {
      getModel?(): MonacoModel | null;
      hasTextFocus?(): boolean;
      getDomNode?(): HTMLElement | null;
    };
    const page = window as unknown as {
      monaco?: { editor?: {
        getModels?: () => MonacoModel[];
        getEditors?: () => MonacoEditorInstance[];
      } };
      ace?: { edit(element: Element): { getValue(): string; setValue(value: string, cursor?: number): void } };
    };
    const models = page.monaco?.editor?.getModels?.() ?? [];
    if (models.length) {
      const editors = page.monaco?.editor?.getEditors?.() ?? [];
      const reversedEditors = [...editors].reverse();
      const matchesExpected = (item: MonacoEditorInstance) =>
        mainLanguageMatches(expectedLanguage, item.getModel?.()?.getLanguageId?.());
      const matchingEditor = editors.find((item) => item.hasTextFocus?.() && matchesExpected(item)) ??
        reversedEditors.find((item) => isConnectedEditor(item) && matchesExpected(item));
      const fallbackEditor =
        editors.find((item) => item.hasTextFocus?.()) ??
        reversedEditors.find(isConnectedEditor);
      // Monaco keeps disposed or background language models in getModels().
      // Prefer the requested language in the visible editor, then the newest
      // matching model. This matters while a site keeps the old language's
      // focused editor connected during an asynchronous compiler switch.
      const matchingModel = expectedLanguage
        ? [...models].reverse().find((item) => mainLanguageMatches(expectedLanguage, item.getLanguageId?.()))
        : undefined;
      const model = matchingEditor?.getModel?.() ?? matchingModel ??
        fallbackEditor?.getModel?.() ?? models[models.length - 1];
      return {
        kind: "monaco",
        getValue: () => model.getValue(),
        setValue: (value) => model.setValue(value),
        getLanguage: () => model.getLanguageId?.(),
        getTemplate: () => leetcodeTemplate(model.getLanguageId?.())
      };
    }

    function isConnectedEditor(item: MonacoEditorInstance): boolean {
      const node = item.getDomNode?.();
      if (!node?.isConnected) return false;
      for (let current: HTMLElement | null = node; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (style.display === "none" || style.visibility === "hidden" || current.hidden) return false;
      }
      return true;
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

  let parsedLeetcodeData: unknown;
  let didParseLeetcodeData = false;

  function leetcodeTemplate(language: string | undefined): string | undefined {
    if (!/^(?:www\.)?leetcode\.cn$/i.test(pageHostname) || !language) return undefined;
    if (!didParseLeetcodeData) {
      didParseLeetcodeData = true;
      const source = document.querySelector<HTMLScriptElement>("#__NEXT_DATA__")?.textContent;
      if (source) {
        try {
          parsedLeetcodeData = JSON.parse(source);
        } catch {
          parsedLeetcodeData = undefined;
        }
      }
    }
    const snippets = findCodeSnippets(parsedLeetcodeData);
    return snippets
      .map((snippet) => ({ snippet, score: leetcodeLanguageScore(language, snippet) }))
      .filter(({ score }) => Number.isFinite(score))
      .sort((left, right) => left.score - right.score)[0]?.snippet.code;
  }

  function findCodeSnippets(value: unknown): Array<{ code: string; lang?: string; langSlug?: string }> {
    const pending: unknown[] = [value];
    const visited = new Set<object>();
    while (pending.length) {
      const current = pending.shift();
      if (!current || typeof current !== "object" || visited.has(current)) continue;
      visited.add(current);
      if (!Array.isArray(current) && "codeSnippets" in current) {
        const snippets = (current as { codeSnippets?: unknown }).codeSnippets;
        if (Array.isArray(snippets)) {
          const valid = snippets.filter((item): item is { code: string; lang?: string; langSlug?: string } =>
            Boolean(item) && typeof item === "object" && typeof (item as { code?: unknown }).code === "string");
          if (valid.length > 0) return valid;
        }
      }
      pending.push(...(Array.isArray(current) ? current : Object.values(current)));
    }
    return [];
  }

  function leetcodeLanguageScore(
    language: string,
    snippet: { lang?: string; langSlug?: string }
  ): number {
    const candidate = `${snippet.langSlug ?? ""} ${snippet.lang ?? ""}`.trim();
    if (/python/i.test(language)) {
      if (/\bpython3\b/i.test(candidate)) return 0;
      if (/\bpython\b/i.test(candidate)) return 1;
      return Number.POSITIVE_INFINITY;
    }
    const patterns: Record<string, RegExp> = {
      cpp: /(?:^|\s)(?:cpp|c\+\+)(?:\s|$)/i,
      c: /(?:^|\s)c(?:\s|$)/i,
      java: /(?:^|\s)java(?:\s|$)/i,
      javascript: /(?:javascript|node(?:\.js)?)/i,
      typescript: /typescript/i,
      go: /(?:^|\s)(?:go|golang)(?:\s|$)/i,
      rust: /(?:^|\s)rust(?:\s|$)/i
    };
    const normalized = /c\+\+|cpp/i.test(language) ? "cpp" : language.toLowerCase();
    return patterns[normalized]?.test(candidate) ? 0 : Number.POSITIVE_INFINITY;
  }

  function locateNowcoderVueEditor(): {
    kind: string;
    getValue(): string;
    setValue(value: string): void;
    getLanguage?(): string | undefined;
    getTemplate?(): string | undefined;
    setLanguage?(language: string): boolean;
  } | undefined {
    type LanguageOption = {
      text?: unknown;
      label?: unknown;
      name?: unknown;
      value?: unknown;
      id?: unknown;
      ncValue?: unknown;
      languageId?: unknown;
      tplCode?: unknown;
      code?: unknown;
      template?: unknown;
    };
    type VueComponent = {
      $parent?: VueComponent;
      $children?: VueComponent[];
      valCode?: (value?: string) => unknown;
      currentLang?: unknown;
      currentLangItem?: LanguageOption;
      langList?: unknown;
      options?: unknown;
      list?: unknown;
      langMap?: unknown;
      valLangue?: (value?: unknown, refresh?: boolean) => unknown;
      editor?: { getValue?: () => unknown; setValue?: (value: string) => void };
    };
    const anchors = Array.from(document.querySelectorAll<HTMLElement>([
      "#jsCodeEditor",
      ".code-editor-box",
      ".subject-eidt-box",
      ".subject-edit-box",
      ".subject-editor-header",
      ".btn-language",
      ".language-select",
      ".monaco-editor"
    ].join(",")));
    if (anchors.length === 0) return undefined;

    const candidateElements = new Set<HTMLElement>();
    for (const anchor of anchors) {
      candidateElements.add(anchor);
      let parent = anchor.parentElement;
      for (let level = 0; parent && level < 10; level += 1, parent = parent.parentElement) {
        candidateElements.add(parent);
      }
      // Older Nowcoder pages attach __vue__ below #jsCodeEditor; newer pages
      // replace that mount node and attach it to a nearby editor container.
      for (const descendant of Array.from(anchor.querySelectorAll<HTMLElement>("*"))) {
        candidateElements.add(descendant);
      }
    }
    const roots: VueComponent[] = [];
    for (const element of candidateElements) {
      const component = (element as HTMLElement & { __vue__?: VueComponent }).__vue__;
      if (component) roots.push(component);
    }

    const pending = [...roots];
    const visited = new Set<VueComponent>();
    const components: VueComponent[] = [];
    while (pending.length) {
      const component = pending.shift()!;
      if (visited.has(component)) continue;
      visited.add(component);
      components.push(component);
      if (component.$parent) pending.push(component.$parent);
      if (Array.isArray(component.$children)) pending.push(...component.$children);
    }
    const editorComponent = components.find((component) => typeof component.valCode === "function") ??
      components.find((component) =>
        typeof component.editor?.getValue === "function" &&
        typeof component.editor?.setValue === "function");
    if (!editorComponent) return undefined;

    const languageComponent = [editorComponent, ...components].find((component) =>
      component.currentLangItem !== undefined ||
      typeof component.valLangue === "function" ||
      component.currentLang !== undefined) ?? editorComponent;

    const languageOptions = components.flatMap((component) => [
      ...flattenNowcoderLanguageOptions(component.langList),
      ...flattenNowcoderLanguageOptions(component.options),
      ...flattenNowcoderLanguageOptions(component.list),
      ...flattenNowcoderLanguageOptions(component.langMap)
    ]);
    return {
      kind: "nowcoder-vue",
      getValue: () => String(
        typeof editorComponent.valCode === "function"
          ? editorComponent.valCode()
          : editorComponent.editor?.getValue?.() ?? ""
      ),
      setValue: (value) => {
        if (typeof editorComponent.valCode === "function") editorComponent.valCode(value);
        else editorComponent.editor?.setValue?.(value);
      },
      getLanguage: () => {
        const itemValue = languageComponent.currentLangItem?.text ?? languageComponent.currentLangItem?.value;
        const value = itemValue ?? (typeof languageComponent.valLangue === "function"
          ? languageComponent.valLangue()
          : languageComponent.currentLang);
        return typeof value === "string" ? value : undefined;
      },
      getTemplate: () => {
        const item = languageComponent.currentLangItem;
        const template = item?.tplCode ?? item?.code ?? item?.template;
        return typeof template === "string" ? template : undefined;
      },
      setLanguage: (language) => {
        const option = languageOptions
          .map((item) => ({
            item,
            label: String(item.text ?? item.label ?? item.name ?? "").replace(/\s+/g, " ").trim()
          }))
          .map(({ item, label }) => ({ item, score: nowcoderLanguageScore(language, label) }))
          .filter(({ score }) => Number.isFinite(score))
          .sort((left, right) => left.score - right.score)[0]?.item;
        const value = option?.value ?? option?.id ?? option?.ncValue ?? option?.languageId;
        if (value === undefined || value === null) return false;
        if (typeof languageComponent.valLangue === "function") languageComponent.valLangue(value, true);
        else languageComponent.currentLang = value;
        return true;
      }
    };

    function flattenNowcoderLanguageOptions(value: unknown): LanguageOption[] {
      if (Array.isArray(value)) return value.flatMap(flattenNowcoderLanguageOptions);
      if (!value || typeof value !== "object") return [];
      const option = value as LanguageOption;
      if (option.text !== undefined || option.label !== undefined || option.name !== undefined) return [option];
      return Object.values(value as Record<string, unknown>).flatMap(flattenNowcoderLanguageOptions);
    }
  }

  function nowcoderLanguageScore(language: string, label: string): number {
    if (language === "python") {
      if (/^python3(?:\s|$|[（(])/i.test(label)) return 0;
      if (/^pypy3(?:\s|$|[（(])/i.test(label)) return 1;
      if (/^python(?:\s|$|[（(])/i.test(label)) return 2;
      if (/^pypy2?(?:\s|$|[（(])/i.test(label)) return 3;
      if (/^python2(?:\s|$|[（(])/i.test(label)) return 4;
      return Number.POSITIVE_INFINITY;
    }
    if (language === "cpp") {
      if (!/^c\+\+(?:\s|$|[（(])/i.test(label)) return Number.POSITIVE_INFINITY;
      return /clang\+\+\s*18/i.test(label) ? 0 : 1;
    }
    const patterns: Record<string, RegExp> = {
      c: /^c(?:\s|$|[（(])/i,
      java: /^java(?:\s|$|[（(])/i,
      javascript: /^(?:javascript|node(?:\.js)?)(?:\s|$|[（(])/i,
      go: /^(?:go|golang)(?:\s|$|[（(])/i,
      rust: /^rust(?:\s|$|[（(])/i
    };
    return patterns[language]?.test(label) ? 0 : Number.POSITIVE_INFINITY;
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

  async function locateAmdMonacoEditor(expectedLanguage?: string): Promise<{
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
    const model = [...models].reverse().find((item) =>
      mainLanguageMatches(expectedLanguage, item.getLanguageId?.())) ?? models[models.length - 1];
    if (!model) return undefined;
    return {
      kind: "monaco-amd",
      getValue: () => model.getValue(),
      setValue: (value) => model.setValue(value),
      getLanguage: () => model.getLanguageId?.()
    };
  }

  function mainLanguageMatches(expected: string | undefined, actual: string | undefined): boolean {
    if (!expected) return true;
    return languageFromCodeMirrorMode(actual) === languageFromCodeMirrorMode(expected);
  }
}
