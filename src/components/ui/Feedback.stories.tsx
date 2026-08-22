import type { Meta, StoryObj } from "@storybook/react-vite";
import { FolderOpen, RefreshCw } from "lucide-react";
import { expect, fn, userEvent, within } from "storybook/test";
import { Button } from "./Button";
import { Badge as UiBadge, Callout as UiCallout, EmptyState as UiEmptyState, Progress as UiProgress, Spinner as UiSpinner } from "./Feedback";

const emptyAction = fn();

const meta = {
  title: "Components/UI/Feedback",
  component: UiBadge,
  subcomponents: { Spinner: UiSpinner, Progress: UiProgress, Callout: UiCallout, EmptyState: UiEmptyState },
  decorators: [(Story) => <div className="story-surface story-surface--column"><div className="story-wide-frame"><Story /></div></div>],
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: { description: { component: "Status primitives communicate state through text and ARIA semantics in addition to color. They share the browser accent/status tokens and respect reduced motion." } },
  },
  args: { children: "Neutral" },
} satisfies Meta<typeof UiBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Badge: Story = {
  render: () => (
    <div className="story-component-row">
      <UiBadge>Neutral</UiBadge>
      <UiBadge variant="accent" dot>Updating</UiBadge>
      <UiBadge variant="success" dot>Connected</UiBadge>
      <UiBadge variant="warning" dot>Pending</UiBadge>
      <UiBadge variant="danger" dot>Failed</UiBadge>
    </div>
  ),
};

export const Spinner: Story = {
  render: () => <div className="story-component-row"><UiSpinner size="small" label="Loading tab" /><UiSpinner label="Generating page" /><UiSpinner size="large" label="Starting runtime" /></div>,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status", { name: "Generating page" })).toBeVisible();
  },
};

export const Progress: Story = {
  render: () => (
    <div className="story-stack">
      <UiProgress label="Generating page" value={42} />
      <UiProgress label="Preparing local runtime" value={null} />
      <UiProgress label="Model download" value={768} max={1024} formatValue={(value, max) => `${value} / ${max} MB`} />
      <UiProgress label="Complete" value={100} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const progress = within(canvasElement).getByRole("progressbar", { name: "Generating page" });
    await expect(progress).toHaveAttribute("aria-valuenow", "42");
    await expect(progress).toHaveAccessibleName("Generating page");
  },
};

export const Callout: Story = {
  render: () => (
    <div className="story-stack">
      <UiCallout title="Generated content is isolated">Pages cannot read browser credentials or host storage.</UiCallout>
      <UiCallout title="Runtime ready" variant="success">The local worker passed its smoke check.</UiCallout>
      <UiCallout title="High token use" variant="warning" actions={<Button size="small" variant="ghost">Review</Button>}>Always-on updates can continue in background tabs.</UiCallout>
      <UiCallout title="Provider disconnected" variant="danger">Reconnect before starting a new generation.</UiCallout>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("alert")).toHaveTextContent("Provider disconnected");
  },
};

export const EmptyState: Story = {
  render: () => (
    <UiEmptyState
      icon={<FolderOpen />}
      title="No saved sites"
      description="Generated pages you save will appear here for this profile."
      primaryAction={<Button variant="primary" onClick={emptyAction}>Create a site</Button>}
      secondaryAction={<Button leadingIcon={<RefreshCw aria-hidden="true" />}>Refresh</Button>}
    />
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Create a site" }));
    await expect(emptyAction).toHaveBeenCalledOnce();
  },
};
