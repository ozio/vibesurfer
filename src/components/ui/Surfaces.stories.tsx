import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChevronRight, Clock3, Globe2, Sparkles } from "lucide-react";
import { expect, fn, userEvent, within } from "storybook/test";
import { Button } from "./Button";
import { Badge } from "./Feedback";
import { Card as UiCard, ListRow as UiListRow } from "./Surfaces";

const rowAction = fn();

const meta = {
  title: "Components/UI/Surfaces",
  component: UiCard,
  subcomponents: { ListRow: UiListRow },
  decorators: [(Story) => <div className="story-surface story-surface--column"><div className="story-wide-frame"><Story /></div></div>],
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: { description: { component: "Composable containers for browser settings, history, profiles, and generation results. Card owns structural regions; ListRow is an explicitly interactive row with a native button contract." } },
  },
  args: { children: "Surface content" },
} satisfies Meta<typeof UiCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Card: Story = {
  render: () => (
    <div className="story-card-grid">
      <UiCard title="Default card" description="Bordered surface" footer="Updated just now">A calm default container for settings and browser metadata.</UiCard>
      <UiCard variant="elevated" title="Elevated card" description="Floating surface" headerAction={<Badge variant="success">Ready</Badge>}>Use elevation when a surface must sit above its surroundings.</UiCard>
      <UiCard variant="outlined" title="Outlined card" description="Transparent fill" footer={<Button size="small">Open details</Button>}>The surrounding canvas stays visible through this variant.</UiCard>
    </div>
  ),
};

export const ListRow: Story = {
  render: () => (
    <UiCard title="Recent pages" description="Interactive rows" variant="outlined">
      <div className="story-list">
        <UiListRow title="Hallunet welcome" description="vibe://welcome · just now" leading={<Sparkles />} trailing={<ChevronRight aria-hidden="true" />} onClick={rowAction} />
        <UiListRow title="Local model guide" description="vibe://docs/local-models · 4m" leading={<Globe2 />} trailing={<Badge variant="accent">Generated</Badge>} selected />
        <UiListRow title="Archived session" description="Unavailable in this profile" leading={<Clock3 />} disabled />
      </div>
    </UiCard>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Hallunet welcome/ }));
    await expect(rowAction).toHaveBeenCalledOnce();
    await expect(canvas.getByRole("button", { name: /Local model guide/ })).toHaveAttribute("aria-pressed", "true");
    await expect(canvas.getByRole("button", { name: /Archived session/ })).toBeDisabled();
  },
};
