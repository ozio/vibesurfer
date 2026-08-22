import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { TAB_STRIP_FIXTURE } from "../../storybook/browser-story-fixtures";
import type { BrowserTab as BrowserTabModel, TabLayout } from "../../types/browser";
import { BrowserChrome } from "./BrowserChrome";
import { TabStrip } from "./TabStrip";
import { TitleBar } from "./TitleBar";
import { VerticalTabSidebar } from "./VerticalTabSidebar";
import { WindowControls } from "./WindowControls";
import { CLASSIC_CHROME_RECIPE, STANDARD_CHROME_RECIPE } from "./chrome-recipes";

function ChromeTabs({ orientation }: { orientation: TabLayout }) {
  const [tabs, setTabs] = useState<BrowserTabModel[]>(() => [...(TAB_STRIP_FIXTURE.tabs ?? [])]);
  const [activeTabId, setActiveTabId] = useState(TAB_STRIP_FIXTURE.activeTabId ?? "tab-active");
  return (
    <TabStrip
      tabs={tabs}
      activeTabId={activeTabId}
      orientation={orientation}
      motion="reduced"
      onActivate={setActiveTabId}
      onClose={(tabId) => setTabs((current) => current.filter((tab) => tab.id !== tabId))}
      onNewTab={() => undefined}
      onReorder={(sourceId, targetId) => setTabs((current) => reorderTabs(current, sourceId, targetId))}
    />
  );
}

function ChromeSidebar() {
  const [width, setWidth] = useState(248);
  return (
    <VerticalTabSidebar
      width={width}
      tabCount={TAB_STRIP_FIXTURE.tabs?.length ?? 0}
      tabStrip={<ChromeTabs orientation="vertical" />}
      onWidthChange={setWidth}
    />
  );
}

const meta = {
  title: "Components/Chrome/BrowserChrome",
  component: BrowserChrome,
  subcomponents: { TitleBar, WindowControls },
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: {
      description: {
        component: "The pure structural shell for a browser window. A recipe decides whether tabs live in the title bar or a classic tab row; all content, navigation, status, tabs, and native window actions are controlled slots or callbacks.",
      },
    },
  },
  args: {
    recipe: STANDARD_CHROME_RECIPE,
    platform: "macos",
    layout: "horizontal",
    title: "Quiet interface",
    horizontalTabs: null,
    navigation: null,
    children: null,
    onWindowAction: fn(),
  },
  render: (args) => (
    <div className="story-browser-chrome-frame">
      <BrowserChrome
        {...args}
        horizontalTabs={<ChromeTabs orientation="horizontal" />}
        verticalTabs={<ChromeSidebar />}
        navigation={(
          <div className="story-chrome-navigation" role="toolbar" aria-label="Browser navigation">
            <button type="button" aria-label="Back">←</button>
            <span>quiet.vibe/ideas</span>
          </div>
        )}
        status={<div className="story-chrome-status" role="status">Ready · Local session</div>}
      >
        <main className="story-chrome-content">
          <span>PURE CHROME RECIPE</span>
          <h1>{args.recipe.id === "classic" ? "Classic browser chrome" : "Reusable browser shell"}</h1>
          <p>The page surface is only a slot; chrome behavior remains independently testable.</p>
        </main>
      </BrowserChrome>
    </div>
  ),
} satisfies Meta<typeof BrowserChrome>;

export default meta;
type Story = StoryObj<typeof meta>;

export const StandardMacOS: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const controls = canvas.getByRole("group", { name: "Window controls" });
    await userEvent.click(within(controls).getByRole("button", { name: "Close" }));
    await expect(args.onWindowAction).toHaveBeenCalledWith("close");
    await expect(canvasElement.querySelector(".titlebar .tab-strip")).toBeInTheDocument();
  },
};

export const StandardWindows: Story = {
  args: { platform: "windows" },
  globals: { platform: "windows" },
  play: async ({ args, canvasElement }) => {
    const controls = within(canvasElement).getByRole("group", { name: "Window controls" });
    await userEvent.click(within(controls).getByRole("button", { name: "Minimize" }));
    await userEvent.click(within(controls).getByRole("button", { name: "Maximize" }));
    await userEvent.click(within(controls).getByRole("button", { name: "Close" }));
    await expect(args.onWindowAction).toHaveBeenNthCalledWith(1, "minimize");
    await expect(args.onWindowAction).toHaveBeenNthCalledWith(2, "toggleMaximize");
    await expect(args.onWindowAction).toHaveBeenNthCalledWith(3, "close");
  },
};

export const MaximizedWindow: Story = {
  args: { platform: "windows", maximized: true },
  globals: { platform: "windows" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("button", { name: "Restore" })).toBeInTheDocument();
  },
};

export const StandardVertical: Story = {
  args: { layout: "vertical" },
  globals: { tabs: "vertical" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("complementary", { name: "Vertical tabs" })).toBeInTheDocument();
    await expect(canvas.getByRole("separator", { name: "Resize tab sidebar" })).toBeInTheDocument();
    await expect(canvasElement.querySelector(".titlebar__brand")).toBeVisible();
  },
};

export const ClassicHorizontal: Story = {
  args: {
    recipe: CLASSIC_CHROME_RECIPE,
    platform: "windows",
  },
  globals: { theme: "ie-classic", platform: "windows" },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector(".browser-chrome")).toHaveAttribute("data-chrome-recipe", "classic");
    await expect(canvasElement.querySelector(".classic-menu-bar")).toBeVisible();
    await expect(canvasElement.querySelector(".titlebar .tab-strip")).not.toBeInTheDocument();
    await expect(canvasElement.querySelector(".classic-tab-row .tab-strip")).toBeVisible();
  },
};

export const ClassicVertical: Story = {
  args: {
    recipe: CLASSIC_CHROME_RECIPE,
    platform: "windows",
    layout: "vertical",
  },
  globals: { theme: "ie-classic", platform: "windows", tabs: "vertical" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvasElement.querySelector(".browser-chrome")).toHaveAttribute("data-chrome-recipe", "classic");
    await expect(canvas.getByRole("complementary", { name: "Vertical tabs" })).toBeVisible();
    await expect(canvasElement.querySelector(".classic-tab-row")).not.toBeInTheDocument();
  },
};

function reorderTabs(tabs: readonly BrowserTabModel[], sourceId: string, targetId: string): BrowserTabModel[] {
  const next = [...tabs];
  const from = next.findIndex((tab) => tab.id === sourceId);
  const to = next.findIndex((tab) => tab.id === targetId);
  if (from < 0 || to < 0 || from === to) return next;
  const [tab] = next.splice(from, 1);
  if (tab) next.splice(to, 0, tab);
  return next;
}
