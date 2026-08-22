import type { ReactNode } from "react";
import type { BrowserWindowAction } from "../../browser/browser-services";
import type { Platform, TabLayout } from "../../types/browser";
import { ClassicMenuBar, ClassicTabBar } from "./ClassicChrome";
import { TitleBar } from "./TitleBar";
import type { BrowserChromeRecipe } from "./chrome-recipes";

export interface BrowserChromeProps {
  recipe: BrowserChromeRecipe;
  platform: Platform;
  layout: TabLayout;
  title?: string;
  horizontalTabs: ReactNode;
  navigation: ReactNode;
  verticalTabs?: ReactNode;
  status?: ReactNode;
  children: ReactNode;
  maximized?: boolean;
  className?: string;
  onWindowAction: (action: BrowserWindowAction) => void | Promise<void>;
}

export function BrowserChrome({
  recipe,
  platform,
  layout,
  title,
  horizontalTabs,
  navigation,
  verticalTabs,
  status,
  children,
  maximized = false,
  className = "",
  onWindowAction,
}: BrowserChromeProps) {
  return (
    <div
      className={`browser-window browser-window--${layout} browser-chrome browser-chrome--${recipe.id} ${className}`.trim()}
      data-chrome-recipe={recipe.id}
      data-tab-layout={layout}
    >
      <TitleBar
        platform={platform}
        layout={layout}
        recipe={recipe}
        title={title}
        maximized={maximized}
        onWindowAction={onWindowAction}
      >
        {horizontalTabs}
      </TitleBar>
      {recipe.menuBar && <ClassicMenuBar />}
      {navigation}
      {layout === "horizontal" && recipe.horizontalTabs === "tab-row" && (
        <ClassicTabBar>{horizontalTabs}</ClassicTabBar>
      )}
      <div className="browser-workspace">
        {layout === "vertical" && verticalTabs}
        <div className="content-viewport">{children}</div>
      </div>
      {status}
    </div>
  );
}
