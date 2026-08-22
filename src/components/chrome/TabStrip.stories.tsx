import { useCallback, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, fn, userEvent, waitFor, within } from "storybook/test";
import { useBrowserStore } from "../../store/browser-store";
import {
  OVERFLOW_TAB_STRIP_FIXTURE,
  TAB_STRIP_FIXTURE,
  storyTab,
} from "../../storybook/browser-story-fixtures";
import { withBrowserStoryState } from "../../storybook/BrowserStoryHarness";
import type { BrowserTab as BrowserTabModel } from "../../types/browser";
import {
  ConnectedTabStrip,
  TabStrip,
  type BrowserTabContextActions,
  type TabStripProps,
} from "./TabStrip";

function ControlledTabStrip(args: TabStripProps) {
  const [tabs, setTabs] = useState<BrowserTabModel[]>(() => [...args.tabs]);
  const [activeTabId, setActiveTabId] = useState(args.activeTabId);
  const nextTabId = useRef(1);

  const activate = (tabId: string) => {
    setActiveTabId(tabId);
    args.onActivate(tabId);
  };
  const close = useCallback((tabId: string) => {
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.id === tabId);
      const next = current.filter((tab) => tab.id !== tabId);
      setActiveTabId((active) => active === tabId
        ? (next[Math.min(index, next.length - 1)]?.id ?? "")
        : active);
      return next;
    });
    args.onClose(tabId);
  }, [args]);
  const addTab = () => {
    const id = `story-new-${nextTabId.current++}`;
    setTabs((current) => [...current, storyTab({
      id,
      title: `New tab ${nextTabId.current}`,
      location: "vibe://new-tab",
      kind: "new-tab",
    })]);
    setActiveTabId(id);
    args.onNewTab();
  };
  const reorder = (sourceTabId: string, targetTabId: string) => {
    setTabs((current) => reorderTabs(current, sourceTabId, targetTabId));
    args.onReorder?.(sourceTabId, targetTabId);
  };
  const contextActions = useCallback((tab: BrowserTabModel): BrowserTabContextActions => ({
    reload: {
      label: tab.kind === "generated" ? "Regenerate page" : "Reload",
      enabled: tab.loadState !== "loading",
      onSelect: () => undefined,
    },
    newTabRight: {
      label: "New tab to the right",
      onSelect: () => {
        setTabs((current) => {
          const index = current.findIndex((candidate) => candidate.id === tab.id);
          const id = `story-new-${nextTabId.current++}`;
          const next = [...current];
          next.splice(index + 1, 0, storyTab({ id, title: "New tab", location: "vibe://new-tab", kind: "new-tab" }));
          return next;
        });
      },
    },
    close: {
      label: "Close",
      onSelect: () => close(tab.id),
    },
    closeOtherTabs: {
      label: "Close other tabs",
      enabled: tabs.length > 1,
      onSelect: () => {
        setTabs([tab]);
        setActiveTabId(tab.id);
      },
    },
  }), [close, tabs.length]);

  return (
    <TabStrip
      {...args}
      tabs={tabs}
      activeTabId={activeTabId}
      onActivate={activate}
      onClose={close}
      onNewTab={addTab}
      onReorder={reorder}
      getContextActions={contextActions}
    />
  );
}

const meta = {
  title: "Components/Chrome/TabStrip",
  component: TabStrip,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: {
      description: {
        component: "A controlled, store-free tab collection with APG keyboard navigation, pointer/keyboard reordering, overflow controls, context actions, and explicit reduced-motion behavior. ConnectedTabStrip is the thin production adapter for Zustand and BrowserCommandRegistry.",
      },
    },
  },
  args: {
    tabs: TAB_STRIP_FIXTURE.tabs ?? [],
    activeTabId: TAB_STRIP_FIXTURE.activeTabId ?? "tab-active",
    orientation: "horizontal",
    motion: "full",
    smoothScrolling: true,
    newTabLabel: "New tab",
    onActivate: fn(),
    onClose: fn(),
    onNewTab: fn(),
    onReorder: fn(),
  },
  render: (args) => (
    <div className="story-surface">
      <div className={`story-tab-frame story-tab-frame--${args.orientation}`}>
        <ControlledTabStrip {...args} />
      </div>
    </div>
  ),
} satisfies Meta<typeof TabStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const HorizontalStates: Story = {};

export const KeyboardNavigation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const first = canvas.getByRole("tab", { name: "New tab" });
    const second = canvas.getByRole("tab", { name: "Quiet interface" });
    const last = canvas.getByRole("tab", { name: "Activity" });
    first.focus();
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() => expect(second).toHaveFocus());
    await expect(second).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{End}");
    await waitFor(() => expect(last).toHaveFocus());
    await userEvent.keyboard("{Home}");
    await waitFor(() => expect(first).toHaveFocus());
  },
};

export const Vertical: Story = {
  args: { orientation: "vertical" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const first = canvas.getByRole("tab", { name: "New tab" });
    const second = canvas.getByRole("tab", { name: "Quiet interface" });
    first.focus();
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(second).toHaveFocus());
  },
};

export const ActivateCloseAndNewTab: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const quietTab = canvas.getByRole("tab", { name: "Quiet interface" });
    await userEvent.click(quietTab);
    await expect(quietTab).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Delete}");
    await expect(canvas.queryByRole("tab", { name: "Quiet interface" })).not.toBeInTheDocument();
    await waitFor(() => expect(canvas.getByRole("tab", { name: /Building a living atlas/ })).toHaveFocus());

    const initialCount = canvas.getAllByRole("tab").length;
    await userEvent.click(canvas.getByRole("button", { name: "New tab" }));
    await waitFor(() => expect(canvas.getAllByRole("tab")).toHaveLength(initialCount + 1));
  },
};

export const ContextActions: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const quietTab = canvas.getByRole("tab", { name: "Quiet interface" });
    await userEvent.pointer({ target: quietTab, keys: "[MouseRight]" });

    const documentBody = within(canvasElement.ownerDocument.body);
    const closeOtherTabs = await documentBody.findByRole("menuitem", { name: "Close other tabs" });
    await userEvent.click(closeOtherTabs);
    await waitFor(() => expect(canvas.getAllByRole("tab")).toHaveLength(1));
    await expect(canvas.getByRole("tab", { name: "Quiet interface" })).toBeInTheDocument();
  },
};

export const Overflow: Story = {
  args: {
    tabs: OVERFLOW_TAB_STRIP_FIXTURE.tabs ?? [],
    activeTabId: OVERFLOW_TAB_STRIP_FIXTURE.activeTabId ?? "overflow-1",
  },
  render: (args) => (
    <div className="story-surface">
      <div className="story-tab-frame story-tab-frame--overflow">
        <ControlledTabStrip {...args} />
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const scrollNext = await canvas.findByRole("button", { name: "Scroll tabs right" });
    await userEvent.click(scrollNext);
    const tabItems = canvasElement.querySelector<HTMLElement>(".tab-strip__items");
    await waitFor(() => expect(tabItems?.scrollLeft).toBeGreaterThan(0));
  },
};

export const KeyboardReorder: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const first = canvas.getByRole("tab", { name: "New tab" });
    first.focus();
    await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}");
    await waitFor(() => expect(canvas.getAllByRole("tab")[1]).toHaveAccessibleName("New tab"));
    await expect(canvas.getByRole("status")).toHaveTextContent("Moved New tab to position 2 of 4");
  },
};

export const PointerReorder: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const first = canvas.getByRole("tab", { name: "New tab" });
    const third = canvas.getByRole("tab", { name: /Building a living atlas/ });
    const firstRect = first.getBoundingClientRect();
    const thirdRect = third.getBoundingClientRect();
    await userEvent.pointer({ keys: "[MouseLeft>]", target: first, coords: { clientX: firstRect.left + 12, clientY: firstRect.top + 12 } });
    await userEvent.pointer({ target: first, coords: { clientX: firstRect.left + 24, clientY: firstRect.top + 12 } });
    await waitFor(() => expect(first).toHaveAttribute("data-dragging", "true"));
    await userEvent.pointer({ target: third, coords: { clientX: thirdRect.left + thirdRect.width / 2, clientY: thirdRect.top + thirdRect.height / 2 } });
    await waitFor(() => expect(third).toHaveAttribute("data-drop-target", "true"));
    fireEvent.pointerUp(canvasElement.ownerDocument.body, {
      pointerId: 1,
      isPrimary: true,
      button: 0,
      buttons: 0,
      clientX: thirdRect.left + thirdRect.width / 2,
      clientY: thirdRect.top + thirdRect.height / 2,
    });
    await waitFor(() => expect(args.onReorder).toHaveBeenCalledWith("tab-active", "tab-loading"));
    await waitFor(() => expect(canvas.getAllByRole("tab")[2]).toHaveAccessibleName("New tab"));
  },
};

export const ReducedMotion: Story = {
  args: { motion: "reduced" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const strip = canvasElement.querySelector(".tab-strip");
    await expect(strip).toHaveAttribute("data-motion", "reduced");
    for (const tab of canvas.getAllByRole("tab")) await expect(tab).toHaveAttribute("data-motion", "reduced");
  },
};

export const ConnectedStoreAdapter: Story = {
  decorators: [withBrowserStoryState],
  parameters: { browserFixture: TAB_STRIP_FIXTURE },
  render: (args) => (
    <div className="story-surface">
      <div className="story-tab-frame story-tab-frame--horizontal">
        <ConnectedTabStrip orientation={args.orientation ?? "horizontal"} />
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("tab", { name: "Quiet interface" }));
    await expect(useBrowserStore.getState().activeTabId).toBe("tab-generated");
  },
};

function reorderTabs(tabs: readonly BrowserTabModel[], sourceTabId: string, targetTabId: string): BrowserTabModel[] {
  const next = [...tabs];
  const from = next.findIndex((tab) => tab.id === sourceTabId);
  const to = next.findIndex((tab) => tab.id === targetTabId);
  if (from < 0 || to < 0 || from === to) return next;
  const [tab] = next.splice(from, 1);
  if (tab) next.splice(to, 0, tab);
  return next;
}
