import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowRight, Plus } from "lucide-react";
import { expect, fn, userEvent, within } from "storybook/test";
import { Button } from "./Button";

const meta = {
  title: "Components/UI/Button",
  component: Button,
  decorators: [(Story) => <div className="story-surface"><Story /></div>],
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: { description: { component: "The shared text action. Variants remain semantic while each browser theme supplies surfaces, borders, radii, type, focus, and motion through tokens." } },
  },
  args: { children: "Create tab" },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { onClick: fn() },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole("button", { name: "Create tab" });
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};

export const Variants: Story = {
  render: () => (
    <div className="story-component-row">
      <Button leadingIcon={<Plus aria-hidden="true" />}>Default</Button>
      <Button variant="primary">Primary</Button>
      <Button variant="danger">Danger</Button>
      <Button variant="ghost" trailingIcon={<ArrowRight aria-hidden="true" />}>Ghost</Button>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => <div className="story-component-row"><Button size="small">Small</Button><Button>Medium</Button><Button size="large">Large</Button></div>,
};

export const Disabled: Story = {
  args: { disabled: true, onClick: fn() },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole("button");
    await expect(button).toBeDisabled();
    await userEvent.click(button);
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};

export const Loading: Story = {
  args: { loading: true, children: "Creating tab" },
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole("button", { name: "Creating tab" });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("aria-busy", "true");
  },
};

export const KeyboardFocus: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.tab();
    await expect(within(canvasElement).getByRole("button")).toHaveFocus();
  },
};
