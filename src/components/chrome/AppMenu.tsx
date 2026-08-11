import { Check, Columns3, ExternalLink, MoreHorizontal, Palette, PanelLeft, Plus, RefreshCw, Settings } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { THEME_LABELS } from "../../data/catalog";
import { externalHttpUrl, openExternal } from "../../lib/platform";
import { useBrowserStore } from "../../store/browser-store";
import type { TabLayout, ThemeId } from "../../types/browser";
import { IconButton } from "../ui/IconButton";

export function AppMenu() {
  const addTab = useBrowserStore((state) => state.addTab);
  const activeTabId = useBrowserStore((state) => state.activeTabId);
  const activeTab = useBrowserStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId));
  const regenerate = useBrowserStore((state) => state.regenerate);
  const openSettings = useBrowserStore((state) => state.openSettings);
  const preferences = useBrowserStore((state) => state.preferences);
  const setTheme = useBrowserStore((state) => state.setTheme);
  const setTabLayout = useBrowserStore((state) => state.setTabLayout);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <IconButton label="VibeSurfer menu"><MoreHorizontal aria-hidden="true" /></IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu app-menu" align="end" sideOffset={8} collisionPadding={10}>
          <DropdownMenu.Item className="menu__item" onSelect={() => addTab()}>
            <Plus aria-hidden="true" /><span>New tab</span><kbd>⌘T</kbd>
          </DropdownMenu.Item>
          {activeTab?.kind === "generated" && (
            <>
              <DropdownMenu.Item className="menu__item" onSelect={() => regenerate(activeTabId)}>
                <RefreshCw aria-hidden="true" /><span>Regenerate page</span>
              </DropdownMenu.Item>
              {externalHttpUrl(activeTab.location) && (
                <DropdownMenu.Item className="menu__item" onSelect={() => void openExternal(activeTab.location)}>
                  <ExternalLink aria-hidden="true" /><span>Open live site externally</span>
                </DropdownMenu.Item>
              )}
            </>
          )}
          <DropdownMenu.Separator className="menu__separator" />
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className="menu__item">
              <Palette aria-hidden="true" /><span>Theme</span><span className="menu__value">{THEME_LABELS[preferences.theme].name}</span>
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent className="menu menu--sub" sideOffset={5} alignOffset={-4}>
                {(Object.keys(THEME_LABELS) as ThemeId[]).map((theme) => (
                  <DropdownMenu.Item key={theme} className="menu__item" onSelect={() => setTheme(theme)}>
                    <span className={`theme-dot theme-dot--${theme}`} />
                    <span>{THEME_LABELS[theme].name}</span>
                    {preferences.theme === theme && <Check aria-hidden="true" />}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className="menu__item">
              <Columns3 aria-hidden="true" /><span>Tab layout</span><span className="menu__value">{preferences.tabLayout}</span>
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent className="menu menu--sub" sideOffset={5} alignOffset={-4}>
                {(["horizontal", "vertical"] as TabLayout[]).map((layout) => (
                  <DropdownMenu.Item key={layout} className="menu__item" onSelect={() => setTabLayout(layout)}>
                    {layout === "horizontal" ? <Columns3 aria-hidden="true" /> : <PanelLeft aria-hidden="true" />}
                    <span>{layout === "horizontal" ? "Horizontal tabs" : "Vertical tabs"}</span>
                    {preferences.tabLayout === layout && <Check aria-hidden="true" />}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
          <DropdownMenu.Separator className="menu__separator" />
          <DropdownMenu.Item className="menu__item" onSelect={() => openSettings("appearance")}>
            <Settings aria-hidden="true" /><span>Settings</span><kbd>⌘,</kbd>
          </DropdownMenu.Item>
          <DropdownMenu.Arrow className="menu__arrow" />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
