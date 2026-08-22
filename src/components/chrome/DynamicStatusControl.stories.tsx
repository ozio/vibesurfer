import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { DynamicStatusControl } from "./DynamicStatusControl";

const pauseChange = fn();
const refresh = fn();
const chooseModel = fn();

const meta = {
  title: "Components/Browser controls/DynamicStatusControl",
  component: DynamicStatusControl,
  decorators: [(Story) => <div className="story-surface story-surface--controls"><div className="story-control-frame story-control-frame--compact"><Story /></div></div>],
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: { description: { component: "Controlled live-region status and actions. Archived identity restoration uses the shared AlertDialog contract rather than window.confirm." } },
  },
  args: {
    status: "live",
    globalMode: "active",
    explicitlyPaused: false,
    lastUpdatedLabel: "12:42:18",
    nextUpdateLabel: "12:47:18",
    onPausedChange: pauseChange,
    onRefresh: refresh,
    onChooseModel: chooseModel,
  },
} satisfies Meta<typeof DynamicStatusControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Live: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("button", { name: "Live regions: Live" })).toHaveAttribute("data-dynamic-status", "live");
  },
};

export const Paused: Story = {
  args: { status: "paused", explicitlyPaused: true, defaultOpen: true },
  play: async ({ canvasElement, args }) => {
    const menu = await within(canvasElement.ownerDocument.body).findByRole("menu", { name: "Live regions: Paused" });
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Resume this page" }));
    await expect(args.onPausedChange).toHaveBeenCalledWith(false);
  },
};

export const Updating: Story = {
  args: { status: "updating", nextUpdateLabel: "Calculating…" },
  globals: { theme: "cyberpunk", motion: "reduced" },
};

export const Error: Story = {
  args: {
    status: "error",
    error: "The selected model reached its rate limit.",
    defaultOpen: true,
  },
  play: async ({ canvasElement, args }) => {
    const menu = await within(canvasElement.ownerDocument.body).findByRole("menu", { name: "Live regions: Error" });
    await expect(within(menu).getByRole("alert")).toHaveTextContent("rate limit");
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Choose model" }));
    await expect(args.onChooseModel).toHaveBeenCalledOnce();
  },
};

export const UpdatesOff: Story = {
  args: { status: "paused", globalMode: "off", defaultOpen: true },
  play: async ({ canvasElement }) => {
    const menu = await within(canvasElement.ownerDocument.body).findByRole("menu", { name: "Live regions: Paused" });
    await expect(within(menu).getByRole("menuitem", { name: "Pause this page" })).toHaveAttribute("data-disabled");
    await expect(within(menu).getByRole("menuitem", { name: "Refresh now" })).toHaveAttribute("data-disabled");
  },
};

export const ArchivedSiteWorld: Story = {
  args: { requiresRestoreConfirmation: true, defaultOpen: true },
  globals: { theme: "ie-classic" },
  play: async ({ canvasElement, args }) => {
    const body = within(canvasElement.ownerDocument.body);
    const menu = await body.findByRole("menu", { name: "Live regions: Live" });
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Refresh now" }));
    const dialog = await body.findByRole("alertdialog", { name: "Restore this SiteWorld?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Restore and refresh" }));
    await expect(args.onRefresh).toHaveBeenCalledOnce();
  },
};
