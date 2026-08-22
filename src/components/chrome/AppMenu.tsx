import { useState } from "react";
import { Check, Columns3, ExternalLink, History, MoreHorizontal, PanelLeft, Plus, RefreshCw, Settings, WandSparkles } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useBrowserCommand } from "../../browser/browser-command-registry";
import { useBrowserStore } from "../../store/browser-store";
import type { TabLayout } from "../../types/browser";
import { IconButton } from "../ui/IconButton";

export function AppMenu() {
  const activeTabId = useBrowserStore((state) => state.activeTabId);
  const activeTab = useBrowserStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId));
  const preferences = useBrowserStore((state) => state.preferences);
  const newTab = useBrowserCommand("new-tab");
  const regenerate = useBrowserCommand("regenerate", { tabId: activeTabId });
  const reimagine = useBrowserCommand("reimagine", { tabId: activeTabId });
  const openLiveSite = useBrowserCommand("open-live-site", { tabId: activeTabId });
  const history = useBrowserCommand("history");
  const horizontalTabs = useBrowserCommand("horizontal-tabs");
  const verticalTabs = useBrowserCommand("vertical-tabs");
  const settings = useBrowserCommand("open-settings");
  const [menuOpen, setMenuOpen] = useState(false);
  const [layoutSubmenuOpen, setLayoutSubmenuOpen] = useState(false);

  const setRootOpen = (open: boolean) => {
    setMenuOpen(open);
    if (!open) {
      setLayoutSubmenuOpen(false);
    }
  };

  const chooseTabLayout = (layout: TabLayout) => {
    (layout === "horizontal" ? horizontalTabs : verticalTabs).execute();
    setRootOpen(false);
  };

  return (
    <DropdownMenu.Root open={menuOpen} onOpenChange={setRootOpen}>
      <DropdownMenu.Trigger asChild>
        <IconButton label="vibesurfer menu"><MoreHorizontal aria-hidden="true" /></IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu app-menu" align="end" sideOffset={8} collisionPadding={10}>
          <DropdownMenu.Item className="menu__item" onSelect={newTab.execute}>
            <Plus aria-hidden="true" /><span>{newTab.label}</span><kbd>{newTab.shortcut}</kbd>
          </DropdownMenu.Item>
          {activeTab?.kind === "generated" && (
            <>
              <DropdownMenu.Item className="menu__item" disabled={!regenerate.enabled} onSelect={regenerate.execute}>
                <RefreshCw aria-hidden="true" /><span>{regenerate.label}</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu__item" disabled={!reimagine.enabled} onSelect={reimagine.execute}>
                <WandSparkles aria-hidden="true" /><span>{reimagine.label}</span>
              </DropdownMenu.Item>
              {openLiveSite.enabled && (
                <DropdownMenu.Item className="menu__item" onSelect={openLiveSite.execute}>
                  <ExternalLink aria-hidden="true" /><span>{openLiveSite.label}</span>
                </DropdownMenu.Item>
              )}
            </>
          )}
          <DropdownMenu.Separator className="menu__separator" />
          <DropdownMenu.Item className="menu__item" onSelect={history.execute}>
            <History aria-hidden="true" /><span>{history.label}</span><kbd>{history.shortcut}</kbd>
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
          <DropdownMenu.Item className="menu__item" onSelect={settings.execute}>
            <Settings aria-hidden="true" /><span>{settings.label}</span><kbd>{settings.shortcut}</kbd>
          </DropdownMenu.Item>
          <DropdownMenu.Arrow className="menu__arrow" />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
