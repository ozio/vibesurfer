import { Maximize2, Minus, X } from "lucide-react";
import { windowAction } from "../../lib/platform";
import type { Platform } from "../../types/browser";

export function WindowControls({ platform }: { platform: Platform }) {
  if (platform === "macos") {
    return (
      <div className="window-controls window-controls--mac" aria-label="Window controls" data-tauri-drag-region="false">
        <button className="traffic-light traffic-light--close" aria-label="Close" onClick={() => void windowAction("close")} />
        <button className="traffic-light traffic-light--minimize" aria-label="Minimize" onClick={() => void windowAction("minimize")} />
        <button className="traffic-light traffic-light--maximize" aria-label="Maximize" onClick={() => void windowAction("toggleMaximize")} />
      </div>
    );
  }

  return (
    <div className={`window-controls window-controls--${platform}`} aria-label="Window controls" data-tauri-drag-region="false">
      <button aria-label="Minimize" onClick={() => void windowAction("minimize")}>
        <Minus aria-hidden="true" />
      </button>
      <button aria-label="Maximize" onClick={() => void windowAction("toggleMaximize")}>
        <Maximize2 aria-hidden="true" />
      </button>
      <button className="window-control--close" aria-label="Close" onClick={() => void windowAction("close")}>
        <X aria-hidden="true" />
      </button>
    </div>
  );
}
