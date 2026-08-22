import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { useBrowserStore } from "../../store/browser-store";
import type { GenerationJob } from "../../types/browser";
import {
  ActivityJobOverview,
  ActivityJobRow,
  ActivityStageTimeline,
  ActivitySurface,
  type ActivityDetailRecord,
  type ActivityFilter,
  type ActivityJobRecord,
  type ActivitySurfaceProps,
} from "./ActivitySurface";

const selectJob = fn();
const filterChange = fn();
const loadOlder = fn();

const JOBS: ActivityJobRecord[] = [
  activityJob({ id: "job-running", status: "running", url: "https://stillroom.fm/live", createdAt: "2026-08-23T03:58:00.000Z", updatedAt: "2026-08-23T03:59:00.000Z" }),
  activityJob({ id: "job-completed", status: "completed", url: "https://library.atlas/rooms/door-zero", createdAt: "2026-08-23T03:40:00.000Z", updatedAt: "2026-08-23T03:40:08.400Z" }),
  activityJob({ id: "job-failed", status: "failed", url: "https://weather.mars/olympus-mons", createdAt: "2026-08-23T03:22:00.000Z", updatedAt: "2026-08-23T03:22:04.000Z", errorPayload: { code: "rate-limited", message: "Retry after 60 seconds" } }),
];

const RUNNING_MEMORY = generationJob({
  id: "job-running",
  status: "running",
  phase: "generating",
  requestedUrl: "https://stillroom.fm/live",
  createdAt: "2026-08-23T03:58:00.000Z",
  startedAt: "2026-08-23T03:58:01.000Z",
  updatedAt: "2026-08-23T03:59:00.000Z",
  progress: {
    stage: "builder",
    stageIndex: 2,
    stageCount: 5,
    currentOutputTokens: 4_320,
    maxOutputTokens: 8_000,
    approximate: true,
    percent: 68,
    emittedAt: "2026-08-23T03:59:00.000Z",
  },
});

const COMPLETED_DETAIL: ActivityDetailRecord = {
  job: JOBS[1]!,
  events: [
    { eventType: "generation.started", timestamp: "2026-08-23T03:40:00.200Z", payload: {} },
    { eventType: "generation.completed", timestamp: "2026-08-23T03:40:08.400Z", payload: { usage: { inputTokens: 3_240, outputTokens: 5_810, totalTokens: 9_050 } } },
  ],
  stages: [
    { jobId: "job-completed", stage: "page-director", status: "completed", startedAt: "2026-08-23T03:40:00.200Z", completedAt: "2026-08-23T03:40:02.000Z", payload: { routes: 4, identityStrategy: "create" } },
    { jobId: "job-completed", stage: "page-builder", status: "completed", startedAt: "2026-08-23T03:40:02.000Z", completedAt: "2026-08-23T03:40:08.000Z", payload: { outputTokens: 5_810, capabilities: ["data-chart", "motion-presets"] } },
  ],
};

const meta = {
  title: "Components/Content surfaces/Activity",
  component: ActivitySurface,
  subcomponents: { ActivityJobRow, ActivityJobOverview, ActivityStageTimeline },
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: {
      story: { inline: false, height: "620px" },
      description: { component: "Controlled activity presentation built from SegmentedControl, ListRow, Badge, Progress, JsonViewer, EmptyState and Button. SQLite pagination and activity-detail polling stay in the connected ActivityPage controller." },
    },
  },
  args: {
    jobs: JOBS,
    selectedId: "job-running",
    selectedMemoryJob: RUNNING_MEMORY,
    filter: "all",
    now: "2026-08-23T04:00:00.000Z",
    onFilterChange: filterChange,
    onSelectJob: selectJob,
    onLoadOlder: loadOlder,
  },
  render: (args) => <ControlledActivityStory {...args} />,
} satisfies Meta<typeof ActivitySurface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("progressbar", { name: /Builder/ })).toHaveAttribute("aria-valuenow", "68");
    await userEvent.click(canvas.getByRole("radio", { name: "Failed" }));
    await expect(args.onFilterChange).toHaveBeenCalledWith("failed");
    const list = within(canvas.getByRole("region", { name: "Generation jobs" }));
    await expect(list.getByText("weather.mars")).toBeInTheDocument();
    await expect(list.queryByText("stillroom.fm")).not.toBeInTheDocument();
  },
};

export const Completed: Story = {
  args: { selectedId: "job-completed", selectedMemoryJob: undefined, detail: COMPLETED_DETAIL },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/9\.1K total/)).toBeInTheDocument();
    await userEvent.click(canvas.getByText("Generation request"));
    await expect(canvas.getByText((_, element) => element?.tagName === "CODE" && element.textContent?.includes('"url": "https://library.atlas/rooms/door-zero"') === true)).toBeInTheDocument();
  },
};

export const Failed: Story = {
  args: { selectedId: "job-failed", selectedMemoryJob: undefined, detail: { job: JOBS[2]!, events: [], stages: [] } },
  globals: { theme: "cyberpunk", scheme: "dark" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("Terminal error")).toBeInTheDocument();
  },
};

export const Empty: Story = {
  args: { jobs: [], selectedId: undefined, selectedMemoryJob: undefined, onLoadOlder: undefined },
  globals: { theme: "sedative" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("Select a generation job")).toBeInTheDocument();
  },
};

export const Paginated: Story = {
  args: { hasMore: true },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Load older jobs" }));
    await expect(args.onLoadOlder).toHaveBeenCalledOnce();
  },
};

function ControlledActivityStory({ filter: initialFilter, selectedId: initialSelectedId, onFilterChange, onSelectJob, ...args }: ActivitySurfaceProps) {
  const [filter, setFilter] = useState<ActivityFilter>(initialFilter);
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  return (
    <ActivitySurface
      {...args}
      filter={filter}
      selectedId={selectedId}
      onFilterChange={(value) => { setFilter(value); onFilterChange(value); }}
      onSelectJob={(value) => { setSelectedId(value); onSelectJob(value); }}
    />
  );
}

function activityJob({ id, status, url, createdAt, updatedAt, errorPayload }: {
  id: string;
  status: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  errorPayload?: Record<string, unknown>;
}): ActivityJobRecord {
  return {
    id,
    profileId: "profile-native",
    status,
    requestPayload: { url, modelId: "gpt-5.6", settings: { maxOutputTokens: 8_000 } },
    errorPayload,
    createdAt,
    updatedAt,
  };
}

function generationJob(input: Pick<GenerationJob, "id" | "status" | "phase" | "requestedUrl" | "createdAt" | "updatedAt"> & Partial<GenerationJob>): GenerationJob {
  const initial = useBrowserStore.getInitialState();
  return {
    profileId: initial.activeProfileId,
    tabId: "story-activity",
    modelId: "gpt-5.6",
    browserTheme: "native",
    motionEnabled: false,
    worldPromptSnapshot: { revision: 1, vibe: "Quiet research", prompt: "Build a calm local surface." },
    generationSettingsSnapshot: structuredClone(initial.generationSettings),
    navigationIntent: { trigger: "address-bar", disposition: "current", requestedUrl: input.requestedUrl },
    ...input,
  };
}
