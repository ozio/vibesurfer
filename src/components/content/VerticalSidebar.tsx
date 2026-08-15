import { Sparkles } from "lucide-react";
import { useBrowserStore } from "../../store/browser-store";
import { TabStrip } from "../chrome/TabStrip";

const MIN_SIDEBAR_WIDTH = 216;
const MAX_SIDEBAR_WIDTH = 360;

export function VerticalSidebar() {
  const width = useBrowserStore((state) => state.preferences.sidebarWidth);
  const tabCount = useBrowserStore((state) => state.tabs.length);
  const patchPreferences = useBrowserStore((state) => state.patchPreferences);
  const renderedWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, width));

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startWidth = renderedWidth;
    event.currentTarget.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent) => {
      patchPreferences({ sidebarWidth: Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, startWidth + moveEvent.clientX - startX)) });
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  };

  return (
    <aside className="vertical-sidebar" style={{ width: renderedWidth }}>
      <div className="vertical-sidebar__header">
        <span><Sparkles aria-hidden="true" /> Tabs</span>
        <small className="vertical-sidebar__count" aria-label={`${tabCount} open tabs`}>{tabCount}</small>
      </div>
      <TabStrip orientation="vertical" />
      <div className="vertical-sidebar__footer">
        <span className="status-orb" />
        <span><strong>Local space</strong><small>Session restored on this device</small></span>
      </div>
      <div className="vertical-sidebar__resize" role="separator" aria-orientation="vertical" aria-label="Resize tab sidebar" onPointerDown={startResize} />
    </aside>
  );
}
