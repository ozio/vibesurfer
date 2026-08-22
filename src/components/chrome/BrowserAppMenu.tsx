import {
  Columns3,
  ExternalLink,
  History,
  MoreHorizontal,
  PanelLeft,
  Plus,
  RefreshCw,
  Settings,
  WandSparkles,
} from "lucide-react";
import type { ReactNode } from "react";
import { useBrowserCommand, type BrowserCommandId } from "../../browser/browser-command-registry";
import { useBrowserStore } from "../../store/browser-store";
import { IconButton } from "../ui/IconButton";
import {
  Menu,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
} from "../ui/Menu";
import {
  browserControlAction,
  type BrowserControlAction,
} from "./browser-control-contracts";

export const BROWSER_APP_MENU_COMMAND_IDS = [
  "new-tab",
  "regenerate",
  "reimagine",
  "open-live-site",
  "history",
  "horizontal-tabs",
  "vertical-tabs",
  "open-settings",
] as const satisfies readonly BrowserCommandId[];

export type BrowserAppMenuCommandId = (typeof BROWSER_APP_MENU_COMMAND_IDS)[number];
export type BrowserAppMenuCommands = Record<BrowserAppMenuCommandId, BrowserControlAction>;

export interface BrowserAppMenuProps {
  commands: BrowserAppMenuCommands;
  showGeneratedActions?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function BrowserAppMenu({
  commands,
  showGeneratedActions = false,
  ...menuProps
}: BrowserAppMenuProps) {
  const layout = commands["vertical-tabs"].checked ? "vertical" : "horizontal";

  return (
    <Menu
      {...menuProps}
      ariaLabel="VibeSurfer menu"
      sideOffset={8}
      className="app-menu"
      trigger={(
        <IconButton label="VibeSurfer menu"><MoreHorizontal aria-hidden="true" /></IconButton>
      )}
    >
      <BrowserAppMenuItem command={commands["new-tab"]} icon={<Plus aria-hidden="true" />} />
      {showGeneratedActions && (
        <>
          <BrowserAppMenuItem command={commands.regenerate} icon={<RefreshCw aria-hidden="true" />} />
          <BrowserAppMenuItem command={commands.reimagine} icon={<WandSparkles aria-hidden="true" />} />
          <BrowserAppMenuItem command={commands["open-live-site"]} icon={<ExternalLink aria-hidden="true" />} />
        </>
      )}
      <MenuSeparator />
      <BrowserAppMenuItem command={commands.history} icon={<History aria-hidden="true" />} />
      <MenuSub>
        <MenuSubTrigger>
          <Columns3 aria-hidden="true" /><span>Tab layout</span><span className="menu__value">{layout}</span>
        </MenuSubTrigger>
        <MenuSubContent alignOffset={-4}>
          <MenuRadioGroup
            value={layout}
            onValueChange={(value) => {
              commands[value === "vertical" ? "vertical-tabs" : "horizontal-tabs"].onExecute();
            }}
          >
            <MenuRadioItem value="horizontal" disabled={!commands["horizontal-tabs"].enabled}>
              <Columns3 aria-hidden="true" /><span>{commands["horizontal-tabs"].label}</span>
            </MenuRadioItem>
            <MenuRadioItem value="vertical" disabled={!commands["vertical-tabs"].enabled}>
              <PanelLeft aria-hidden="true" /><span>{commands["vertical-tabs"].label}</span>
            </MenuRadioItem>
          </MenuRadioGroup>
        </MenuSubContent>
      </MenuSub>
      <MenuSeparator />
      <BrowserAppMenuItem command={commands["open-settings"]} icon={<Settings aria-hidden="true" />} />
    </Menu>
  );
}

export function ConnectedBrowserAppMenu() {
  const activeTabId = useBrowserStore((state) => state.activeTabId);
  const activeTab = useBrowserStore((state) => state.tabs.find((tab) => tab.id === state.activeTabId));
  const newTab = useBrowserCommand("new-tab");
  const regenerate = useBrowserCommand("regenerate", { tabId: activeTabId });
  const reimagine = useBrowserCommand("reimagine", { tabId: activeTabId });
  const openLiveSite = useBrowserCommand("open-live-site", { tabId: activeTabId });
  const history = useBrowserCommand("history");
  const horizontalTabs = useBrowserCommand("horizontal-tabs");
  const verticalTabs = useBrowserCommand("vertical-tabs");
  const settings = useBrowserCommand("open-settings");

  return (
    <BrowserAppMenu
      showGeneratedActions={activeTab?.kind === "generated"}
      commands={{
        "new-tab": browserControlAction(newTab),
        regenerate: browserControlAction(regenerate),
        reimagine: browserControlAction(reimagine),
        "open-live-site": browserControlAction(openLiveSite),
        history: browserControlAction(history),
        "horizontal-tabs": browserControlAction(horizontalTabs),
        "vertical-tabs": browserControlAction(verticalTabs),
        "open-settings": browserControlAction(settings),
      }}
    />
  );
}

function BrowserAppMenuItem({
  command,
  icon,
}: {
  command: BrowserControlAction;
  icon: ReactNode;
}) {
  return (
    <MenuItem
      disabled={!command.enabled}
      shortcut={command.shortcut}
      data-command-id={command.id}
      onSelect={command.onExecute}
    >
      {icon}<span>{command.label}</span>
    </MenuItem>
  );
}
