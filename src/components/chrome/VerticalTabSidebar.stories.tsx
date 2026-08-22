import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { useBrowserStore } from "../../store/browser-store";
import { TAB_STRIP_FIXTURE } from "../../storybook/browser-story-fixtures";
import { withBrowserStoryState } from "../../storybook/BrowserStoryHarness";
import { TabStrip } from "./TabStrip";
import {
  ConnectedVerticalTabSidebar,
  MAX_VERTICAL_TAB_SIDEBAR_WIDTH,
  MIN_VERTICAL_TAB_SIDEBAR_WIDTH,
  VerticalTabSidebar,
  type VerticalTabSidebarProps,
} from "./VerticalTabSidebar";

function SidebarDemo(args: VerticalTabSidebarProps) {
  const [width, setWidth] = useState(args.width);
  const [activeTabId, setActiveTabId] = useState(TAB_STRIP_FIXTURE.activeTabId ?? "tab-active");
  const tabs = TAB_STRIP_FIXTURE.tabs ?? [];
  return (
    <div className="story-sidebar-frame">
      <VerticalTabSidebar
        {...args}
        width={width}
        tabCount={tabs.length}
        onWidthChange={(next) => {
          setWidth(next);
          args.onWidthChange(next);
        }}
        tabStrip={(
          <TabStrip
            tabs={tabs}
            activeTabId={activeTabId}
            orientation="vertical"
            motion="reduced"
            onActivate={setActiveTabId}
            onClose={() => undefined}
            onNewTab={() => undefined}
          />
        )}
      />
      <main className="story-sidebar-content"><h1>Browser content</h1><p>The sidebar owns only layout and resizing.</p></main>
    </div>
  );
}

const meta = {
  title: "Components/Chrome/VerticalTabSidebar",
  component: VerticalTabSidebar,
  subcomponents: { ConnectedVerticalTabSidebar },
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: {
      description: {
        component: "A controlled vertical-tabs layout primitive. Width is clamped, pointer and Arrow/Home/End resizing comes from the shared ResizeHandle, and the production adapter only connects preferences and ConnectedTabStrip.",
      },
    },
  },
  args: {
    width: 248,
    tabCount: TAB_STRIP_FIXTURE.tabs?.length ?? 0,
    tabStrip: null,
    onWidthChange: fn(),
  },
  render: (args) => <SidebarDemo {...args} />,
} satisfies Meta<typeof VerticalTabSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const KeyboardResize: Story = {
  play: async ({ args, canvasElement }) => {
    const separator = within(canvasElement).getByRole("separator", { name: "Resize tab sidebar" });
    separator.focus();
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() => expect(separator).toHaveAttribute("aria-valuenow", "260"));
    await expect(args.onWidthChange).toHaveBeenCalledWith(260);
    await userEvent.keyboard("{End}");
    await expect(separator).toHaveAttribute("aria-valuenow", String(MAX_VERTICAL_TAB_SIDEBAR_WIDTH));
    await userEvent.keyboard("{Home}");
    await expect(separator).toHaveAttribute("aria-valuenow", String(MIN_VERTICAL_TAB_SIDEBAR_WIDTH));
  },
};

export const WidthIsClamped: Story = {
  args: { width: 120 },
  play: async ({ canvasElement }) => {
    const sidebar = within(canvasElement).getByRole("complementary", { name: "Vertical tabs" });
    await expect(sidebar).toHaveAttribute("data-sidebar-width", String(MIN_VERTICAL_TAB_SIDEBAR_WIDTH));
  },
};

export const ConnectedStoreAdapter: Story = {
  decorators: [withBrowserStoryState],
  parameters: {
    browserFixture: {
      ...TAB_STRIP_FIXTURE,
      preferences: { sidebarWidth: 248, tabLayout: "vertical" },
    },
  },
  render: () => <div className="story-sidebar-frame"><ConnectedVerticalTabSidebar /><main className="story-sidebar-content">Connected content</main></div>,
  play: async ({ canvasElement }) => {
    const separator = within(canvasElement).getByRole("separator", { name: "Resize tab sidebar" });
    separator.focus();
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() => expect(useBrowserStore.getState().preferences.sidebarWidth).toBe(260));
  },
};
