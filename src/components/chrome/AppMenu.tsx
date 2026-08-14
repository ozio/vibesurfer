import { useMemo, useState } from "react";
import { Check, Columns3, ExternalLink, History, MoreHorizontal, PanelLeft, Plus, RefreshCw, Settings, WandSparkles } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { browserShortcutLabels, detectPlatform, externalHttpUrl, openExternal } from "../../lib/platform";
import { useBrowserStore } from "../../store/browser-store";
import type { TabLayout } from "../../types/browser";
import { IconButton } from "../ui/IconButton";

export function AppMenu() {
  const addTab = useBrowserStore((state) => state.addTab);
  const activeTabId = useBrowserStore((state) => state.activeTabId);
  const activeTab = useBrowserStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId));
  const regenerate = useBrowserStore((state) => state.regenerate);
  const reimagine = useBrowserStore((state) => state.reimagine);
  const reload = useBrowserStore((state) => state.reload);
  const openSettings = useBrowserStore((state) => state.openSettings);
  const openHistory = useBrowserStore((state) => state.openHistory);
  const preferences = useBrowserStore((state) => state.preferences);
  const setTabLayout = useBrowserStore((state) => state.setTabLayout);
  const [menuOpen, setMenuOpen] = useState(false);
  const [layoutSubmenuOpen, setLayoutSubmenuOpen] = useState(false);
  const platform = useMemo(detectPlatform, []);
  const shortcuts = browserShortcutLabels(platform, preferences.theme);

  const setRootOpen = (open: boolean) => {
    setMenuOpen(open);
    if (!open) {
      setLayoutSubmenuOpen(false);
    }
  };

  const chooseTabLayout = (layout: TabLayout) => {
    setTabLayout(layout);
    setRootOpen(false);
  };

  return (
    <DropdownMenu.Root open={menuOpen} onOpenChange={setRootOpen}>
      <DropdownMenu.Trigger asChild>
        <IconButton label="vibesurfer menu"><MoreHorizontal aria-hidden="true" /></IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu app-menu" align="end" sideOffset={8} collisionPadding={10}>
          <DropdownMenu.Item className="menu__item" onSelect={() => addTab()}>
            <Plus aria-hidden="true" /><span>New tab</span><kbd>{shortcuts.newTab}</kbd>
          </DropdownMenu.Item>
          {activeTab?.kind === "generated" && (
            <>
              <DropdownMenu.Item className="menu__item" onSelect={() => activeTab.archivedSiteWorldId ? reload(activeTabId) : regenerate(activeTabId)}>
                <RefreshCw aria-hidden="true" /><span>{activeTab.archivedSiteWorldId ? "Reload archived snapshot" : "Regenerate page"}</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu__item" disabled={Boolean(activeTab.archivedSiteWorldId)} onSelect={() => reimagine(activeTabId)}>
                <WandSparkles aria-hidden="true" /><span>Reimagine site</span>
              </DropdownMenu.Item>
              {externalHttpUrl(activeTab.location) && (
                <DropdownMenu.Item className="menu__item" onSelect={() => void openExternal(activeTab.location)}>
                  <ExternalLink aria-hidden="true" /><span>Open live site externally</span>
                </DropdownMenu.Item>
              )}
            </>
          )}
          <DropdownMenu.Separator className="menu__separator" />
          <DropdownMenu.Item className="menu__item" onSelect={openHistory}>
            <History aria-hidden="true" /><span>History</span><kbd>{platform === "macos" ? "⌘Y" : "Ctrl+Y"}</kbd>
          </DropdownMenu.Item>
          <DropdownMenu.Sub
            open={layoutSubmenuOpen}
            onOpenChange={(open) => {
              if (open) {
                setLayoutSubmenuOpen(true);
              }
            }}
          >
            <DropdownMenu.SubTrigger className="menu__item">
              <Columns3 aria-hidden="true" /><span>Tab layout</span><span className="menu__value">{preferences.tabLayout}</span>
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent
                className="menu menu--sub"
                sideOffset={5}
                alignOffset={-4}
                onEscapeKeyDown={() => setLayoutSubmenuOpen(false)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft") setLayoutSubmenuOpen(false);
                }}
              >
                {(["horizontal", "vertical"] as TabLayout[]).map((layout) => (
                  <DropdownMenu.Item key={layout} className="menu__item" onSelect={() => chooseTabLayout(layout)}>
                    {layout === "horizontal" ? <Columns3 aria-hidden="true" /> : <PanelLeft aria-hidden="true" />}
                    <span>{layout === "horizontal" ? "Horizontal tabs" : "Vertical tabs"}</span>
                    {preferences.tabLayout === layout && <Check aria-hidden="true" />}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
          <DropdownMenu.Separator className="menu__separator" />
          <DropdownMenu.Item className="menu__item" onSelect={() => openSettings("general")}>
            <Settings aria-hidden="true" /><span>Settings</span><kbd>{shortcuts.settings}</kbd>
          </DropdownMenu.Item>
          <DropdownMenu.Arrow className="menu__arrow" />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
