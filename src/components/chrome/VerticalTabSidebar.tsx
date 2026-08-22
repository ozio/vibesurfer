import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { useBrowserStore } from "../../store/browser-store";
import { ResizeHandle } from "../ui/Utilities";
import { ConnectedTabStrip } from "./TabStrip";

export const MIN_VERTICAL_TAB_SIDEBAR_WIDTH = 216;
export const MAX_VERTICAL_TAB_SIDEBAR_WIDTH = 360;

export interface VerticalTabSidebarProps {
  width: number;
  tabCount: number;
  tabStrip: ReactNode;
  onWidthChange: (width: number) => void;
  minWidth?: number;
  maxWidth?: number;
  resizeStep?: number;
  title?: string;
  footerTitle?: string;
  footerDetail?: string;
  className?: string;
}

export function VerticalTabSidebar({
  width,
  tabCount,
  tabStrip,
  onWidthChange,
  minWidth = MIN_VERTICAL_TAB_SIDEBAR_WIDTH,
  maxWidth = MAX_VERTICAL_TAB_SIDEBAR_WIDTH,
  resizeStep = 12,
  title = "Tabs",
  footerTitle = "Local space",
  footerDetail = "Session restored on this device",
  className = "",
}: VerticalTabSidebarProps) {
  const renderedWidth = Math.max(minWidth, Math.min(maxWidth, width));

  return (
    <aside
      className={`vertical-sidebar ${className}`.trim()}
      style={{ width: renderedWidth }}
      aria-label="Vertical tabs"
      data-sidebar-width={renderedWidth}
    >
      <div className="vertical-sidebar__header">
        <span><Sparkles aria-hidden="true" /> {title}</span>
        <small className="vertical-sidebar__count" aria-label={`${tabCount} open tabs`}>{tabCount}</small>
      </div>
      {tabStrip}
      <div className="vertical-sidebar__footer">
        <span className="status-orb" aria-hidden="true" />
        <span className="vertical-sidebar__footer-copy"><strong>{footerTitle}</strong><small>{footerDetail}</small></span>
      </div>
      <ResizeHandle
        className="vertical-sidebar__resize"
        orientation="vertical"
        label="Resize tab sidebar"
        value={renderedWidth}
        min={minWidth}
        max={maxWidth}
        step={resizeStep}
        onValueChange={onWidthChange}
      />
    </aside>
  );
}

export function ConnectedVerticalTabSidebar() {
  const { width, tabCount, patchPreferences } = useBrowserStore(useShallow((state) => ({
    width: state.preferences.sidebarWidth,
    tabCount: state.tabs.length,
    patchPreferences: state.patchPreferences,
  })));

  return (
    <VerticalTabSidebar
      width={width}
      tabCount={tabCount}
      tabStrip={<ConnectedTabStrip orientation="vertical" />}
      onWidthChange={(sidebarWidth) => patchPreferences({ sidebarWidth })}
    />
  );
}
