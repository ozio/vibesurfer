import type { ReactNode } from "react";
import type { BrowserWindowAction } from "../../browser/browser-services";
import type { Platform, TabLayout } from "../../types/browser";
import type { BrowserChromeRecipe } from "./chrome-recipes";
import { WindowControls } from "./WindowControls";

export interface TitleBarProps {
  platform: Platform;
  layout: TabLayout;
  recipe: BrowserChromeRecipe;
  title?: string;
  children?: ReactNode;
  maximized?: boolean;
  onWindowAction: (action: BrowserWindowAction) => void | Promise<void>;
}

export function TitleBar({
  platform,
  layout,
  recipe,
  title = "vibesurfer",
  children,
  maximized = false,
  onWindowAction,
}: TitleBarProps) {
  const controlsAtStart = recipe.id === "standard" && platform === "macos";
  const controls = (
    <WindowControls
      platform={platform}
      appearance={recipe.windowControlsAppearance}
      maximized={maximized}
      onAction={onWindowAction}
    />
  );

  return (
    <header
      className={`titlebar titlebar--${layout}`}
      aria-label="Browser title bar"
      data-appearance={recipe.titleBarAppearance}
      data-tauri-drag-region="deep"
    >
      {controlsAtStart && controls}
      {recipe.id === "classic" && (
        <div className="titlebar__legacy-caption" data-tauri-drag-region="deep">
          <span className="titlebar__legacy-icon" aria-hidden="true">e</span>
          <span className="titlebar__legacy-title">{title} - Vibe Surfer</span>
        </div>
      )}
      {layout === "vertical" && recipe.verticalBrand && (
        <div className="titlebar__brand">
          <img src="/favicon.png" alt="" aria-hidden="true" />
          <span>vibesurfer</span>
        </div>
      )}
      {layout === "horizontal" && recipe.horizontalTabs === "titlebar" && children}
      {layout === "vertical" && recipe.id === "standard" && <div className="titlebar__drag-space" />}
      {!controlsAtStart && controls}
    </header>
  );
}
