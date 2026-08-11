import { PanelLeftClose, Sparkles } from "lucide-react";
import { useBrowserStore } from "../../store/browser-store";
import { IconButton } from "../ui/IconButton";
import { TabStrip } from "../chrome/TabStrip";

export function VerticalSidebar() {
  const width = useBrowserStore((state) => state.preferences.sidebarWidth);
  const patchPreferences = useBrowserStore((state) => state.patchPreferences);

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startWidth = width;
    event.currentTarget.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent) => {
      patchPreferences({ sidebarWidth: Math.max(188, Math.min(360, startWidth + moveEvent.clientX - startX)) });
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  };

  return (
    <aside className="vertical-sidebar" style={{ width }}>
      <div className="vertical-sidebar__header">
        <span><Sparkles aria-hidden="true" /> Space</span>
        <IconButton label="Collapse sidebar" onClick={() => patchPreferences({ sidebarWidth: 188 })}><PanelLeftClose aria-hidden="true" /></IconButton>
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
