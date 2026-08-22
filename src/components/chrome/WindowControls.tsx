import { Maximize2, Minimize2, Minus, X } from "lucide-react";
import type { BrowserWindowAction } from "../../browser/browser-services";
import type { Platform } from "../../types/browser";
import type { BrowserChromeRecipeId } from "./chrome-recipes";

export interface WindowControlsProps {
  platform: Platform;
  appearance?: BrowserChromeRecipeId;
  maximized?: boolean;
  disabled?: boolean;
  onAction: (action: BrowserWindowAction) => void | Promise<void>;
}

export function WindowControls({
  platform,
  appearance = "standard",
  maximized = false,
  disabled = false,
  onAction,
}: WindowControlsProps) {
  const perform = (action: BrowserWindowAction) => {
    void onAction(action);
  };

  if (platform === "macos") {
    return (
      <div
        className="window-controls window-controls--mac"
        role="group"
        aria-label="Window controls"
        data-appearance={appearance}
        data-tauri-drag-region="false"
      >
        <button type="button" className="traffic-light traffic-light--close" aria-label="Close" data-window-action="close" disabled={disabled} onClick={() => perform("close")} />
        <button type="button" className="traffic-light traffic-light--minimize" aria-label="Minimize" data-window-action="minimize" disabled={disabled} onClick={() => perform("minimize")} />
        <button type="button" className="traffic-light traffic-light--maximize" aria-label={maximized ? "Restore" : "Maximize"} data-window-action="toggleMaximize" disabled={disabled} onClick={() => perform("toggleMaximize")} />
      </div>
    );
  }

  return (
    <div
      className={`window-controls window-controls--${platform}`}
      role="group"
      aria-label="Window controls"
      data-appearance={appearance}
      data-tauri-drag-region="false"
    >
      <button type="button" aria-label="Minimize" data-window-action="minimize" disabled={disabled} onClick={() => perform("minimize")}>
        <Minus aria-hidden="true" />
      </button>
      <button type="button" aria-label={maximized ? "Restore" : "Maximize"} data-window-action="toggleMaximize" disabled={disabled} onClick={() => perform("toggleMaximize")}>
        {maximized ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
      </button>
      <button type="button" className="window-control--close" aria-label="Close" data-window-action="close" disabled={disabled} onClick={() => perform("close")}>
        <X aria-hidden="true" />
      </button>
    </div>
  );
}
