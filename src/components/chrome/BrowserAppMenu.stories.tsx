import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type { BrowserCommandId } from "../../browser/browser-command-registry";
import type { BrowserControlAction } from "./browser-control-contracts";
import { BrowserAppMenu, type BrowserAppMenuCommands } from "./BrowserAppMenu";

const executeNewTab = fn();
const executeRegenerate = fn();
const executeReimagine = fn();
const executeOpenLive = fn();
const executeHistory = fn();
const executeHorizontal = fn();
const executeVertical = fn();
const executeSettings = fn();

const action = (
  id: BrowserCommandId,
  label: string,
  onExecute: () => void,
  options: Partial<Pick<BrowserControlAction, "enabled" | "checked" | "shortcut">> = {},
): BrowserControlAction => ({ id, label, onExecute, enabled: true, ...options });

const COMMANDS: BrowserAppMenuCommands = {
  "new-tab": action("new-tab", "New tab", executeNewTab, { shortcut: "⌘T" }),
  regenerate: action("regenerate", "Regenerate page", executeRegenerate, { shortcut: "⇧⌘R" }),
  reimagine: action("reimagine", "Reimagine site", executeReimagine),
  "open-live-site": action("open-live-site", "Open live site externally", executeOpenLive),
  history: action("history", "History", executeHistory, { shortcut: "⌘Y" }),
  "horizontal-tabs": action("horizontal-tabs", "Horizontal tabs", executeHorizontal, { checked: true }),
  "vertical-tabs": action("vertical-tabs", "Vertical tabs", executeVertical, { checked: false }),
  "open-settings": action("open-settings", "Settings", executeSettings, { shortcut: "⌘," }),
};

const meta = {
  title: "Components/Browser controls/BrowserAppMenu",
  component: BrowserAppMenu,
  decorators: [(Story) => <div className="story-surface story-surface--controls"><div className="story-control-frame story-control-frame--compact"><Story /></div></div>],
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: { description: { component: "Pure web presentation of the browser command registry. Every actionable item keeps the same command ID used by JavaScript shortcuts and the Tauri native menu." } },
  },
  args: { commands: COMMANDS },
} satisfies Meta<typeof BrowserAppMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "VibeSurfer menu" }));
    const menu = await within(canvasElement.ownerDocument.body).findByRole("menu", { name: "VibeSurfer menu" });
    const newTab = within(menu).getByRole("menuitem", { name: "New tab ⌘T" });
    await expect(newTab).toHaveAttribute("data-command-id", "new-tab");
    await userEvent.click(newTab);
    await expect(args.commands["new-tab"].onExecute).toHaveBeenCalledOnce();
  },
};

export const GeneratedPage: Story = {
  args: { showGeneratedActions: true, defaultOpen: true },
  play: async ({ canvasElement }) => {
    const menu = await within(canvasElement.ownerDocument.body).findByRole("menu", { name: "VibeSurfer menu" });
    await expect(within(menu).getByRole("menuitem", { name: "Regenerate page ⇧⌘R" })).toHaveAttribute("data-command-id", "regenerate");
    await expect(within(menu).getByRole("menuitem", { name: "Reimagine site" })).toBeEnabled();
  },
};

export const ArchivedGeneratedPage: Story = {
  args: {
    showGeneratedActions: true,
    defaultOpen: true,
    commands: {
      ...COMMANDS,
      regenerate: action("regenerate", "Reload archived snapshot", executeRegenerate, { shortcut: "⇧⌘R" }),
      reimagine: action("reimagine", "Reimagine site", executeReimagine, { enabled: false }),
    },
  },
  globals: { theme: "ie-classic" },
};

export const TabLayoutCommands: Story = {
  args: { defaultOpen: true },
  play: async ({ canvasElement, args }) => {
    const body = within(canvasElement.ownerDocument.body);
    const menu = await body.findByRole("menu", { name: "VibeSurfer menu" });
    await userEvent.hover(within(menu).getByRole("menuitem", { name: /Tab layout/ }));
    const vertical = await body.findByRole("menuitemradio", { name: "Vertical tabs" });
    await userEvent.click(vertical);
    await expect(args.commands["vertical-tabs"].onExecute).toHaveBeenCalledOnce();
  },
};

export const WindowsShortcuts: Story = {
  args: {
    defaultOpen: true,
    commands: {
      ...COMMANDS,
      "new-tab": action("new-tab", "New tab", executeNewTab, { shortcut: "Ctrl+T" }),
      history: action("history", "History", executeHistory, { shortcut: "Ctrl+Y" }),
      "open-settings": action("open-settings", "Settings", executeSettings, { shortcut: "Ctrl+," }),
    },
  },
  globals: { platform: "windows" },
};
