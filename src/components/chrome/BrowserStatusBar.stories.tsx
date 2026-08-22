import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { DEFAULT_GENERATION_SETTINGS } from "../../store/browser-store";
import type { GenerationJob, PageArtifact } from "../../types/browser";
import { BrowserStatusBar } from "./BrowserStatusBar";

const openActivity = fn();

const meta = {
  title: "Components/Browser controls/BrowserStatusBar",
  component: BrowserStatusBar,
  decorators: [(Story) => <div className="story-surface story-surface--column"><div className="story-statusbar-frame"><Story /></div></div>],
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: { description: { component: "Controlled status bar with explicit standard/classic presentations. Only the selected recipe is rendered; the connected adapter supplies generation activity navigation." } },
  },
  args: {
    appearance: "standard",
    location: "https://hallunet.vibe/welcome",
    profileName: "Personal",
    modelName: "GPT-5.6 Codex",
    onOpenActivity: openActivity,
  },
} satisfies Meta<typeof BrowserStatusBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("button", { name: "No stats" })).toBeDisabled();
  },
};

export const GeneratedUsage: Story = {
  args: { artifact: artifact() },
  play: async ({ canvasElement, args }) => {
    const usage = within(canvasElement).getByRole("button", { name: /1 req · in 120 · out 80/ });
    await userEvent.click(usage);
    await expect(args.onOpenActivity).toHaveBeenCalledWith("job-one");
  },
};

export const HoveredLink: Story = {
  args: { hoveredLink: "https://hallunet.vibe/next", artifact: artifact() },
  globals: { theme: "sedative" },
};

export const Generating: Story = {
  args: {
    activeJob: generationJob({
      status: "running",
      phase: "generating",
      progress: {
        stage: "builder",
        stageIndex: 2,
        stageCount: 4,
        currentOutputTokens: 1_240,
        maxOutputTokens: 4_000,
        approximate: true,
        percent: 56,
        emittedAt: "2026-08-23T03:00:03.000Z",
      },
    }),
  },
  globals: { theme: "cyberpunk" },
};

export const Failed: Story = {
  args: {
    activeJob: generationJob({
      status: "failed",
      phase: "failed",
      error: { code: "rate-limited", message: "The provider reached its rate limit.", retryable: true },
    }),
  },
};

export const Classic: Story = {
  args: { appearance: "classic", artifact: artifact() },
  globals: { theme: "ie-classic" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Hallunet")).toBeInTheDocument();
    await expect(canvas.queryByText("Personal · GPT-5.6 Codex")).not.toBeInTheDocument();
  },
};

function generationJob(patch: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: "job-one",
    profileId: "personal",
    tabId: "tab-one",
    requestedUrl: "https://hallunet.vibe/welcome",
    normalizedUrl: "https://hallunet.vibe/welcome",
    modelId: "gpt-5.6-codex",
    browserTheme: "native",
    motionEnabled: true,
    worldPromptSnapshot: { revision: 1, vibe: "", prompt: "" },
    generationSettingsSnapshot: structuredClone(DEFAULT_GENERATION_SETTINGS),
    status: "queued",
    phase: "queued",
    navigationIntent: {
      trigger: "address-bar",
      disposition: "current",
      requestedUrl: "https://hallunet.vibe/welcome",
    },
    createdAt: "2026-08-23T03:00:00.000Z",
    updatedAt: "2026-08-23T03:00:00.000Z",
    ...patch,
  };
}

function artifact(): PageArtifact {
  return {
    id: "artifact-one",
    url: "https://hallunet.vibe/welcome",
    title: "Welcome",
    html: "<!doctype html><title>Welcome</title>",
    summary: "Welcome to Hallunet",
    siteWorldId: "site-one",
    generationJobId: "job-one",
    modelId: "gpt-5.6-codex",
    promptVersion: 10,
    settingsFingerprint: "storybook",
    createdAt: "2026-08-23T03:00:04.000Z",
    usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200, requests: 1 },
    warnings: [],
    modelExchanges: [],
  };
}
