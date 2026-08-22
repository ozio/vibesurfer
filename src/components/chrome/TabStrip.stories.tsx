import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { useBrowserStore } from "../../store/browser-store";
import {
  OVERFLOW_TAB_STRIP_FIXTURE,
  TAB_STRIP_FIXTURE,
} from "../../storybook/browser-story-fixtures";
import { withBrowserStoryState } from "../../storybook/BrowserStoryHarness";
import { TabStrip } from "./TabStrip";

const meta = {
  title: "Components/Chrome/TabStrip",
  component: TabStrip,
  decorators: [withBrowserStoryState],
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    browserFixture: TAB_STRIP_FIXTURE,
    docs: {
      description: {
        component: "The connected tab collection used by horizontal title bars and vertical sidebars. It owns activation, closing, overflow, context actions, and drag reordering.",
      },
    },
  },
  args: {
    orientation: "horizontal",
  },
  render: (args) => (
    <div className="story-surface">
      <div className={`story-tab-frame story-tab-frame--${args.orientation}`}>
        <TabStrip {...args} />
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
    const next = canvas.getByRole("tab", { name: "Quiet interface" });
    first.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(next).toHaveFocus();
    await expect(next).toHaveAttribute("aria-selected", "true");
  },
};

export const Vertical: Story = {
  args: {
    orientation: "vertical",
  },
};

export const ActivateAndClose: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const quietTab = canvas.getByRole("tab", { name: "Quiet interface" });
    await userEvent.click(quietTab);
    await expect(quietTab).toHaveAttribute("aria-selected", "true");

    await userEvent.keyboard("{Delete}");
    await expect(canvas.queryByRole("tab", { name: "Quiet interface" })).not.toBeInTheDocument();
  },
};

export const AddTab: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const initialCount = canvas.getAllByRole("tab").length;
    await userEvent.click(canvas.getByRole("button", { name: "New tab" }));
    await waitFor(() => expect(canvas.getAllByRole("tab")).toHaveLength(initialCount + 1));
  },
};

export const ContextMenu: Story = {
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
  parameters: {
    browserFixture: OVERFLOW_TAB_STRIP_FIXTURE,
  },
  render: (args) => (
    <div className="story-surface">
      <div className="story-tab-frame story-tab-frame--overflow">
        <TabStrip {...args} />
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

export const Reorder: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const first = canvas.getByRole("tab", { name: "New tab" });
    first.focus();
    await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}");

    await waitFor(() => expect(useBrowserStore.getState().tabs[0]?.id).not.toBe("tab-active"));
  },
};
