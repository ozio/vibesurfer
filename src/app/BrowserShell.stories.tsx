import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  BROWSER_SHELL_CANONICAL_THEMES,
  WELCOME_BROWSER_FIXTURE,
} from "../storybook/browser-story-fixtures";
import { readBrowserStoryGlobals } from "../storybook/BrowserStoryEnvironment";
import { withBrowserStoryState } from "../storybook/BrowserStoryHarness";
import { BrowserShell } from "./BrowserShell";

const meta = {
  title: "Browser/BrowserShell",
  component: BrowserShell,
  decorators: [withBrowserStoryState],
  parameters: {
    layout: "fullscreen",
    a11y: { test: "todo" },
    browserFixture: WELCOME_BROWSER_FIXTURE,
    docs: {
      description: {
        component: "The complete browser interface without host generation or dynamic-content runtimes. Use the toolbar to inspect every theme and host variant against the same deterministic session.",
      },
    },
  },
  render: (_args, context) => (
    <BrowserShell platform={readBrowserStoryGlobals(context.globals).platform} />
  ),
} satisfies Meta<typeof BrowserShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Native: Story = {
  globals: { theme: BROWSER_SHELL_CANONICAL_THEMES[0] },
};

export const Sedative: Story = {
  globals: { theme: BROWSER_SHELL_CANONICAL_THEMES[1] },
};

export const IEClassic: Story = {
  globals: { theme: BROWSER_SHELL_CANONICAL_THEMES[2] },
};

export const Cyberpunk: Story = {
  globals: { theme: BROWSER_SHELL_CANONICAL_THEMES[3] },
};

export const Editorial: Story = {
  globals: { theme: BROWSER_SHELL_CANONICAL_THEMES[4] },
};
