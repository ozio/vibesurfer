import type { Meta, StoryObj } from "@storybook/react-vite";
import { Bot, Cloud, Cpu } from "lucide-react";
import { expect, fn, userEvent, within } from "storybook/test";
import { Badge } from "./Feedback";
import { RadioCard as UiRadioCard, RadioCardGroup, SegmentedControl as UiSegmentedControl, Switch as UiSwitch } from "./ChoiceControls";

const switchChange = fn();
const segmentChange = fn();
const radioChange = fn();

const meta = {
  title: "Components/UI/Choice controls",
  component: UiSwitch,
  subcomponents: { SegmentedControl: UiSegmentedControl, RadioCard: UiRadioCard, RadioCardGroup },
  decorators: [(Story) => <div className="story-surface story-surface--column"><div className="story-form-frame"><Story /></div></div>],
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: { description: { component: "Boolean, compact single-choice, and descriptive single-choice controls. Radix supplies roving focus and Arrow-key selection; labels and descriptions stay in the shared browser DOM." } },
  },
  args: { label: "Live updates" },
} satisfies Meta<typeof UiSwitch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Switch: Story = {
  render: () => (
    <div className="story-stack">
      <UiSwitch label="Live updates" description="Refresh active dynamic regions." onCheckedChange={switchChange} />
      <UiSwitch label="Restore session" description="Reopen tabs at launch." defaultChecked />
      <UiSwitch label="Managed policy" description="Controlled by the host environment." checked disabled />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const control = within(canvasElement).getByRole("switch", { name: "Live updates" });
    control.focus();
    await userEvent.keyboard(" ");
    await expect(control).toBeChecked();
    await expect(switchChange).toHaveBeenLastCalledWith(true);
  },
};

export const SegmentedControl: Story = {
  render: () => (
    <div className="story-stack">
      <UiSegmentedControl
        label="Tab layout"
        defaultValue="horizontal"
        onValueChange={segmentChange}
        options={[{ value: "horizontal", label: "Horizontal" }, { value: "vertical", label: "Vertical" }]}
      />
      <UiSegmentedControl
        label="Generation quality"
        defaultValue="balanced"
        options={[{ value: "fast", label: "Fast" }, { value: "balanced", label: "Balanced" }, { value: "quality", label: "Quality", disabled: true }]}
      />
      <UiSegmentedControl
        label="Vertical options"
        orientation="vertical"
        defaultValue="first"
        options={[{ value: "first", label: "First" }, { value: "second", label: "Second" }]}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.tab();
    await userEvent.keyboard("{ArrowRight}");
    const vertical = within(canvasElement).getByRole("radio", { name: "Vertical" });
    await expect(vertical).toHaveFocus();
    await userEvent.keyboard(" ");
    await expect(vertical).toBeChecked();
    await expect(segmentChange).toHaveBeenLastCalledWith("vertical");
  },
};

export const RadioCard: Story = {
  render: () => (
    <RadioCardGroup label="Generation runtime" defaultValue="local" onValueChange={radioChange}>
      <UiRadioCard value="local" label="Local runtime" description="Private and available offline." icon={<Cpu />} badge={<Badge variant="success" dot>Ready</Badge>} />
      <UiRadioCard value="cloud" label="Cloud provider" description="Use a connected API account." icon={<Cloud />} />
      <UiRadioCard value="codex" label="Codex" description="Requires a signed-in desktop session." icon={<Bot />} badge={<Badge>Beta</Badge>} />
      <UiRadioCard value="managed" label="Managed runtime" description="Unavailable for this profile." disabled />
    </RadioCardGroup>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.tab();
    await userEvent.keyboard("{ArrowDown}");
    const cloud = within(canvasElement).getByRole("radio", { name: /Cloud provider/ });
    await expect(cloud).toHaveFocus();
    await userEvent.keyboard(" ");
    await expect(cloud).toBeChecked();
    await expect(radioChange).toHaveBeenLastCalledWith("cloud");
  },
};
