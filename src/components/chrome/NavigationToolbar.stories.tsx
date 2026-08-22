import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { useBrowserStore } from "../../store/browser-store";
import { storyTab } from "../../storybook/browser-story-fixtures";
import { withBrowserStoryState, type BrowserStoryFixture } from "../../storybook/BrowserStoryHarness";
import { NavigationToolbar, ConnectedNavigationToolbar, type NavigationToolbarAction } from "./NavigationToolbar";
import { Omnibox } from "./Omnibox";
import {
  CLASSIC_NAVIGATION_RECIPE,
  STANDARD_NAVIGATION_RECIPE,
  type BrowserNavigationRecipe,
} from "./navigation-recipes";

const action = (label: string, enabled = true): NavigationToolbarAction => ({
  label,
  enabled,
  onExecute: fn(),
});

function ToolbarOmnibox({ recipe }: { recipe: BrowserNavigationRecipe }) {
  const [value, setValue] = useState("https://quiet.vibe/ideas");
  const [open, setOpen] = useState(false);
  return (
    <Omnibox
      recipe={recipe.omnibox}
      value={value}
      committedValue="https://quiet.vibe/ideas"
      suggestions={[]}
      open={open}
      placeholder="Enter an address or search"
      onValueChange={setValue}
      onOpenChange={setOpen}
      onActiveSuggestionChange={() => undefined}
      onSubmit={() => undefined}
      onSuggestionSelect={() => undefined}
    />
  );
}

const connectedTab = storyTab({
  id: "navigation-story",
  title: "Current page",
  location: "https://current.vibe/",
  kind: "remote",
});

const connectedNavigationFixture: BrowserStoryFixture = {
  tabs: [{
    ...connectedTab,
    history: [
      {
        id: "navigation-history-start",
        title: "Start page",
        location: "https://start.vibe/",
        kind: "remote",
      },
      connectedTab.history[0]!,
    ],
    historyIndex: 1,
  }],
  activeTabId: "navigation-story",
};

const meta = {
  title: "Components/Chrome/NavigationToolbar",
  component: NavigationToolbar,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: {
      description: {
        component: "A pure browser navigation toolbar. Command presentation and execution are injected as actions, loading chooses Reload or Stop, the omnibox is a slot, and the recipe controls classic versus standard presentation. ConnectedNavigationToolbar is the production adapter for BrowserCommandRegistry and Zustand.",
      },
    },
  },
  args: {
    recipe: STANDARD_NAVIGATION_RECIPE,
    loading: false,
    back: action("Back"),
    forward: action("Forward"),
    reload: action("Reload"),
    stop: action("Stop"),
    home: action("Home"),
    omnibox: null,
  },
  render: (args) => (
    <div className="story-surface story-surface--toolbar">
      <div className="story-navigation-frame">
        <NavigationToolbar {...args} omnibox={<ToolbarOmnibox recipe={args.recipe} />} />
      </div>
    </div>
  ),
} satisfies Meta<typeof NavigationToolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Standard: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Back" }));
    await userEvent.click(canvas.getByRole("button", { name: "Forward" }));
    await userEvent.click(canvas.getByRole("button", { name: "Reload" }));
    await userEvent.click(canvas.getByRole("button", { name: "Home" }));
    await expect(args.back.onExecute).toHaveBeenCalledOnce();
    await expect(args.forward.onExecute).toHaveBeenCalledOnce();
    await expect(args.reload.onExecute).toHaveBeenCalledOnce();
    await expect(args.home.onExecute).toHaveBeenCalledOnce();
    await expect(canvas.getByRole("toolbar", { name: "Page navigation" })).toBeInTheDocument();
  },
};

export const LoadingUsesStop: Story = {
  args: { loading: true },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("button", { name: "Reload" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Stop" }));
    await expect(args.stop.onExecute).toHaveBeenCalledOnce();
    await expect(canvas.getByRole("status", { name: "Page loading" })).toBeInTheDocument();
  },
};

export const DisabledHistory: Story = {
  args: {
    back: action("Back", false),
    forward: action("Forward", false),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Back" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Forward" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Reload" })).toBeEnabled();
  },
};

export const ClassicAddressAndGoRecipe: Story = {
  args: { recipe: CLASSIC_NAVIGATION_RECIPE },
  globals: { theme: "ie-classic", platform: "windows" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toolbar = canvas.getByRole("navigation", { name: "Browser navigation" });
    await expect(toolbar).toHaveAttribute("data-navigation-recipe", "classic");
    await expect(canvas.getByText("Address")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Go to address" })).toBeVisible();
    await expect(canvasElement.querySelector(".omnibox__search")).not.toBeInTheDocument();
  },
};

export const StandardRecipeHasNoClassicMarkup: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText("Address")).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Go to address" })).not.toBeInTheDocument();
    await expect(canvasElement.querySelector(".omnibox__search")).toBeInTheDocument();
  },
};

export const ConnectedCommandRegistry: Story = {
  decorators: [withBrowserStoryState],
  parameters: { browserFixture: connectedNavigationFixture },
  render: () => <div className="story-surface story-surface--toolbar"><div className="story-navigation-frame"><ConnectedNavigationStory /></div></div>,
  play: async ({ canvasElement }) => {
    const back = within(canvasElement).getByRole("button", { name: "Back" });
    await expect(back).toBeEnabled();
    await userEvent.click(back);
    const active = useBrowserStore.getState().tabs.find((tab) => tab.id === "navigation-story");
    await expect(active?.historyIndex).toBe(0);
    await expect(active?.location).toBe("https://start.vibe/");
  },
};

function ConnectedNavigationStory() {
  const tab = useBrowserStore((state) => state.tabs.find((candidate) => candidate.id === state.activeTabId) ?? state.tabs[0]!);
  return <ConnectedNavigationToolbar tab={tab} recipe={STANDARD_NAVIGATION_RECIPE} />;
}
