import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import type { GenerationStrategy } from "../../types/browser";
import { GenerationModeControl } from "./GenerationModeControl";

const changeStrategy = fn();

const meta = {
  title: "Components/Browser controls/GenerationModeControl",
  component: GenerationModeControl,
  decorators: [(Story) => <div className="story-surface"><div className="story-control-frame story-control-frame--compact"><Story /></div></div>],
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: { description: { component: "A controlled two-state browser control for Full and Turbo generation strategies." } },
  },
  args: { strategy: "full", onStrategyChange: changeStrategy },
} satisfies Meta<typeof GenerationModeControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Full: Story = {
  play: async ({ canvasElement, args }) => {
    const button = within(canvasElement).getByRole("button", { name: /Generation mode: Full/ });
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(button);
    await expect(args.onStrategyChange).toHaveBeenCalledWith("turbo");
  },
};

export const Turbo: Story = {
  args: { strategy: "turbo" },
  globals: { theme: "cyberpunk" },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const Interactive: Story = {
  render: () => <InteractiveGenerationMode />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Generation mode: Full/ }));
    await expect(canvas.getByRole("button", { name: /Generation mode: Turbo/ })).toHaveAttribute("aria-pressed", "true");
  },
};

function InteractiveGenerationMode() {
  const [strategy, setStrategy] = useState<GenerationStrategy>("full");
  return <GenerationModeControl strategy={strategy} onStrategyChange={setStrategy} />;
}
