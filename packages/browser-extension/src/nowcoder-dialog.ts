/**
 * Runs in Nowcoder's page world through chrome.scripting.executeScript.
 * Keep this function self-contained: Chrome serializes the function body and
 * does not preserve module imports or outer lexical bindings.
 */
export function dismissNowcoderAcceptedDialogInPage(activate = true, watchMs = 0): boolean {
  type WatcherState = { observer: MutationObserver; interval: number; timeout: number };
  const watcherKey = "__algoSyncNowcoderAcceptedDialogWatcher";
  const pageWindow = window as typeof window & Record<string, WatcherState | undefined>;
  const stopWatcher = () => {
    const watcher = pageWindow[watcherKey];
    if (!watcher) return;
    watcher.observer.disconnect();
    pageWindow.clearInterval(watcher.interval);
    pageWindow.clearTimeout(watcher.timeout);
    delete pageWindow[watcherKey];
  };
  if (watchMs < 0) {
    stopWatcher();
    return false;
  }

  const scan = (shouldActivate: boolean): boolean => {
    const roots: ParentNode[] = [document];
    const elements: HTMLElement[] = [];
    const seen = new Set<Element>();
    for (let index = 0; index < roots.length; index += 1) {
      const root = roots[index];
      for (const element of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
        if (!seen.has(element)) {
          seen.add(element);
          elements.push(element);
        }
        if (element.shadowRoot) roots.push(element.shadowRoot);
      }
    }

    const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
    const label = (element: HTMLElement) => normalize(
      (element instanceof HTMLInputElement ? element.value : "") ||
      element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      element.innerText ||
      element.textContent ||
      ""
    );
    const composedParent = (element: HTMLElement): HTMLElement | null => {
      if (element.parentElement) return element.parentElement;
      const root = element.getRootNode();
      return root instanceof ShadowRoot && root.host instanceof HTMLElement ? root.host : null;
    };
    const usable = (element: HTMLElement) => {
      for (let current: HTMLElement | null = element; current; current = composedParent(current)) {
        const style = getComputedStyle(current);
        if (current.hidden || current.getAttribute("aria-hidden") === "true" ||
          style.display === "none" || style.visibility === "hidden") return false;
      }
      return !(element instanceof HTMLButtonElement || element instanceof HTMLInputElement) || !element.disabled;
    };
    const successHeading = /恭喜(?:你)?(?:(?:已)?通过|.*\bAC\b).*(?:本题|题目)/i;
    const belongsToAcceptedDialog = (element: HTMLElement) => {
      let current: HTMLElement | null = element;
      for (let depth = 0; current && depth < 12; depth += 1, current = composedParent(current)) {
        if (current === document.body || current === document.documentElement) return false;
        const text = normalize(current.innerText || current.textContent || "");
        if (successHeading.test(text)) return true;
      }
      return false;
    };
    const actionable = (element: HTMLElement) => element.closest<HTMLElement>(
      "button, a, [role='button'], input[type='button']"
    ) ?? element;
    const candidates = elements
      .filter(usable)
      .filter((element) => /^(?:关闭|取消|稍后再说|close)$/i.test(label(element)) ||
        /(?:^|[-_])(?:modal-?)?close(?:[-_]|$)|关闭/i.test([
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          typeof element.className === "string" ? element.className : ""
        ].filter(Boolean).join(" ")))
      .map(actionable)
      .filter((element, index, all) => all.indexOf(element) === index)
      .filter((element) => usable(element) && belongsToAcceptedDialog(element))
      .sort((left, right) => {
        const iconScore = (element: HTMLElement) => /close/i.test([
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          typeof element.className === "string" ? element.className : ""
        ].filter(Boolean).join(" ")) ? 0 : 1;
        return iconScore(left) - iconScore(right);
      });
    if (candidates.length === 0) return false;
    if (!shouldActivate) return true;

    const fire = (element: HTMLElement) => {
      const view = element.ownerDocument.defaultView ?? window;
      const rect = element.getBoundingClientRect();
      const init: MouseEventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        button: 0,
        buttons: 1,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
      };
      const Pointer = view.PointerEvent;
      element.dispatchEvent(Pointer
        ? new Pointer("pointerdown", { ...init, pointerType: "mouse", isPrimary: true })
        : new view.MouseEvent("pointerdown", init));
      element.dispatchEvent(new view.MouseEvent("mousedown", init));
      element.focus();
      element.dispatchEvent(Pointer
        ? new Pointer("pointerup", { ...init, buttons: 0, pointerType: "mouse", isPrimary: true })
        : new view.MouseEvent("pointerup", { ...init, buttons: 0 }));
      element.dispatchEvent(new view.MouseEvent("mouseup", { ...init, buttons: 0 }));
      element.click();
    };
    for (const candidate of candidates) {
      if (candidate.isConnected) fire(candidate);
    }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    return true;
  };

  const found = scan(activate);
  if (!activate || watchMs === 0) return found;

  stopWatcher();
  let sawDialog = found;
  let checking = false;
  const check = () => {
    if (checking) return;
    checking = true;
    try {
      const present = scan(true);
      if (present) {
        sawDialog = true;
      } else if (sawDialog) {
        stopWatcher();
      }
    } finally {
      checking = false;
    }
  };
  const observer = new MutationObserver(check);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  const interval = pageWindow.setInterval(check, 250);
  const timeout = pageWindow.setTimeout(stopWatcher, watchMs);
  pageWindow[watcherKey] = { observer, interval, timeout };
  return found;
}
