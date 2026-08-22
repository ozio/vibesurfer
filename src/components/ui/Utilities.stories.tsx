import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { ResizeHandle as UiResizeHandle, Shortcut as UiShortcut } from "./Utilities";

function ResizeDemo({ orientation = "vertical", disabled = false }: { orientation?: "horizontal" | "vertical"; disabled?: boolean }) {
  const [value, setValue] = useState(280);
  return (
    <div className={`story-resize-demo story-resize-demo--${orientation}`}>
      <div style={orientation === "vertical" ? { width: value } : { height: value }}><strong>Resizable panel</strong><small>{value}px</small></div>
      <UiResizeHandle orientation={orientation} value={value} min={200} max={360} step={10} disabled={disabled} onValueChange={setValue} />
      <div>Browser content</div>
    </div>
  );
}

const meta = {
  title: "Components/UI/Utilities",
  component: UiResizeHandle,
  subcomponents: { Shortcut: UiShortcut },
  decorators: [(Story) => <div className="story-surface story-surface--column"><div className="story-wide-frame"><Story /></div></div>],
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: { description: { component: "Small behavioral utilities: an ARIA separator with pointer and keyboard resizing, plus a semantic shortcut renderer for menus, hints, and command documentation." } },
  },
  args: { value: 280, onValueChange: () => undefined },
} satisfies Meta<typeof UiResizeHandle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ResizeHandle: Story = {
  render: () => <ResizeDemo />,
  play: async ({ canvasElement }) => {
    const separator = within(canvasElement).getByRole("separator", { name: "Resize panel" });
    separator.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(separator).toHaveAttribute("aria-valuenow", "290");
    await userEvent.keyboard("{End}");
    await expect(separator).toHaveAttribute("aria-valuenow", "360");
    await userEvent.keyboard("{Home}");
    await expect(separator).toHaveAttribute("aria-valuenow", "200");
  },
};

export const ResizeOrientations: Story = {
  render: () => <div className="story-stack"><ResizeDemo /><ResizeDemo orientation="horizontal" /><ResizeDemo disabled /></div>,
};

export const Shortcut: Story = {
  render: () => (
    <div className="story-component-row">
      <UiShortcut keys={["⌘", "K"]} label="Command K" />
      <UiShortcut keys="Ctrl+Shift+P" />
      <UiShortcut keys={["Alt", "←"]} separator=" " />
      <UiShortcut keys="Esc" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("img", { name: "Command K" })).toHaveTextContent("⌘+K");
  },
};
