import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { WindowControls } from "./WindowControls";

const meta = {
  title: "Components/Chrome/WindowControls",
  component: WindowControls,
  parameters: {
    layout: "centered",
    a11y: { test: "error" },
    docs: {
      description: {
        component: "Controlled native-window affordances. The component has no Tauri dependency: hosts receive minimize, toggleMaximize, and close actions through one callback, while platform and recipe control presentation only.",
      },
    },
  },
  args: {
    platform: "macos",
    appearance: "standard",
    onAction: fn(),
  },
  decorators: [(Story) => <div className="story-window-controls-frame"><Story /></div>],
} satisfies Meta<typeof WindowControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MacOS: Story = {
  play: async ({ args, canvasElement }) => {
    const controls = within(canvasElement).getByRole("group", { name: "Window controls" });
    await userEvent.click(within(controls).getByRole("button", { name: "Close" }));
    await userEvent.click(within(controls).getByRole("button", { name: "Minimize" }));
    await userEvent.click(within(controls).getByRole("button", { name: "Maximize" }));
    await expect(args.onAction).toHaveBeenNthCalledWith(1, "close");
    await expect(args.onAction).toHaveBeenNthCalledWith(2, "minimize");
    await expect(args.onAction).toHaveBeenNthCalledWith(3, "toggleMaximize");
  },
};

export const Windows: Story = {
  args: { platform: "windows" },
  globals: { platform: "windows" },
};

export const Linux: Story = {
  args: { platform: "linux" },
  globals: { platform: "linux" },
};

export const Maximized: Story = {
  args: { platform: "windows", maximized: true },
  globals: { platform: "windows" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("button", { name: "Restore" })).toBeInTheDocument();
  },
};

export const Disabled: Story = {
  args: { platform: "windows", disabled: true },
  globals: { platform: "windows" },
  play: async ({ args, canvasElement }) => {
    const buttons = within(canvasElement).getAllByRole("button");
    for (const button of buttons) await expect(button).toBeDisabled();
    await userEvent.click(buttons[0]!);
    await expect(args.onAction).not.toHaveBeenCalled();
  },
};

export const ClassicRecipe: Story = {
  args: { platform: "windows", appearance: "classic" },
  globals: { theme: "ie-classic", platform: "windows" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("group", { name: "Window controls" })).toHaveAttribute("data-appearance", "classic");
  },
};
