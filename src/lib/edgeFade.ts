/* Scroll panes on the page fade softly into the paper at whichever edge has more writing past it,
   instead of slicing the text in half: sets data-fade-top / data-fade-bottom for the pane's CSS mask.
   Use as a React 19 ref callback (it returns its own cleanup). `focusable` also gives the pane a tab
   stop while it scrolls, so it can be read with the keyboard.
   (The journal keeps its own copy in src/app/journal/page.tsx for now.) */
export function edgeFade(el: HTMLElement | null, { focusable = false }: { focusable?: boolean } = {}) {
  if (!el) return;
  const update = () => {
    const pane = getComputedStyle(el).overflowY !== "visible" && el.scrollHeight - el.clientHeight > 1;
    el.toggleAttribute("data-fade-top", pane && el.scrollTop > 1);
    el.toggleAttribute("data-fade-bottom", pane && el.scrollTop + el.clientHeight < el.scrollHeight - 1);
    if (focusable) {
      if (pane) el.tabIndex = 0;
      else el.removeAttribute("tabindex");
    }
  };
  update();
  el.addEventListener("scroll", update, { passive: true });
  // the content can grow without the pane resizing or the DOM changing: images arriving, a <details>
  // opening, a web font swapping in — watch the pane and its children
  el.addEventListener("load", update, true);
  el.addEventListener("toggle", update, true);
  const resized = new ResizeObserver(update);
  const watch = () => {
    resized.disconnect();
    resized.observe(el);
    for (const child of Array.from(el.children)) resized.observe(child);
  };
  watch();
  const changed = new MutationObserver(() => { watch(); update(); });
  changed.observe(el, { childList: true, subtree: true, characterData: true });
  let live = true;
  void document.fonts?.ready.then(() => { if (live) update(); });
  return () => {
    live = false;
    el.removeEventListener("scroll", update);
    el.removeEventListener("load", update, true);
    el.removeEventListener("toggle", update, true);
    resized.disconnect();
    changed.disconnect();
  };
}
