import type { ReactNode } from "react";
import type { Platform, TabLayout } from "../../types/browser";
import { WindowControls } from "./WindowControls";

interface TitleBarProps {
  platform: Platform;
  layout: TabLayout;
  title?: string;
  children?: ReactNode;
}

export function TitleBar({ platform, layout, title = "vibesurfer", children }: TitleBarProps) {
  return (
    <header
      className={`titlebar titlebar--${layout}`}
      data-tauri-drag-region="deep"
    >
      <div className="titlebar__legacy-caption" data-tauri-drag-region="deep">
        <span className="titlebar__legacy-icon" aria-hidden="true">e</span>
        <span className="titlebar__legacy-title">{title} - Windows Internet Explorer</span>
      </div>
      {platform === "macos" && <WindowControls platform={platform} />}
      {layout === "vertical" && (
        <div className="titlebar__brand">
          <img src="/favicon.png" alt="" aria-hidden="true" />
          <span>vibesurfer</span>
        </div>
      )}
      {layout === "horizontal" ? children : <div className="titlebar__drag-space" />}
      {platform !== "macos" && <WindowControls platform={platform} />}
    </header>
  );
}
