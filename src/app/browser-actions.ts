import { useBrowserStore, type AddTabOptions } from "../store/browser-store";

export function openBlankTabAndFocus(options: AddTabOptions = { placement: "end" }): string {
  const tabId = useBrowserStore.getState().addTab(undefined, options);
  const schedule = typeof requestAnimationFrame === "function"
    ? requestAnimationFrame
    : (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0);
  schedule(() => window.dispatchEvent(new Event("vibesurfer:focus-address")));
  return tabId;
}
