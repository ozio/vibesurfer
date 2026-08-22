import type { Meta, StoryObj } from "@storybook/react-vite";
import { Plus } from "lucide-react";
import { expect, fn, userEvent, within } from "storybook/test";
import { IconButton } from "./IconButton";

const meta = {
  title: "Components/UI/IconButton",
  component: IconButton,
  decorators: [
    (Story) => (
      <div className="story-surface">
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: {
      description: {
        component: "The shared icon-only browser action. It owns its accessible name, disabled behavior, focus treatment, and delayed tooltip.",
      },
    },
  },
  argTypes: {
    children: { control: false },
  },
  args: {
    label: "New tab",
    children: <Plus aria-hidden="true" />,
  },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole("button", { name: "New tab" });
    await expect(button).toBeEnabled();
  },
};

export const Click: Story = {
  args: {
    onClick: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole("button", { name: "New tab" });
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    onClick: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole("button", { name: "New tab" });
    await expect(button).toBeDisabled();
    await userEvent.click(button);
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};

export const VariantsAndSizes: Story = {
  render: () => (
    <div className="story-component-row">
      <IconButton label="Small action" size="small"><Plus aria-hidden="true" /></IconButton>
      <IconButton label="Primary action" variant="primary"><Plus aria-hidden="true" /></IconButton>
      <IconButton label="Danger action" variant="danger"><Plus aria-hidden="true" /></IconButton>
      <IconButton label="Large action" size="large"><Plus aria-hidden="true" /></IconButton>
    </div>
  ),
};

export const Loading: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole("button", { name: "New tab" });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("aria-busy", "true");
  },
};

export const KeyboardFocus: Story = {
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole("button", { name: "New tab" });
    await userEvent.tab();
    await expect(button).toHaveFocus();
  },
};

export const TooltipOpen: Story = {
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole("button", { name: "New tab" });
    await userEvent.hover(button);
    const tooltip = await within(canvasElement.ownerDocument.body).findByRole("tooltip");
    await expect(tooltip).toHaveTextContent("New tab");
  },
};
