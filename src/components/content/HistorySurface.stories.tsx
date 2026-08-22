import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { deterministicGlyphFavicon } from "../../lib/favicon";
import type { BrowsingHistoryEntry } from "../../types/browser";
import { HistoryEntryRow, HistorySurface } from "./HistorySurface";

const openEntry = fn();
const deleteEntry = fn();
const clearHistory = fn();

const ENTRIES: BrowsingHistoryEntry[] = [
  historyEntry({ id: "history-1", title: "Stillroom Radio", url: "https://stillroom.fm/live", status: "completed", artifactId: "artifact-1", openedAt: "2026-08-23T03:44:00.000Z" }),
  historyEntry({ id: "history-2", title: "Stillroom Radio — regenerated", url: "https://stillroom.fm/live", status: "cached", artifactId: "artifact-2", openedAt: "2026-08-23T03:12:00.000Z" }),
  historyEntry({ id: "history-3", title: "Rain Library", url: "https://stillroom.fm/rooms/rain-library", status: "loading", openedAt: "2026-08-22T19:30:00.000Z" }),
  historyEntry({ id: "history-4", title: "Broken coordinate", url: "https://atlas.invalid/missing", status: "error", errorMessage: "Model unavailable", openedAt: "2026-08-21T13:06:00.000Z" }),
];

const meta = {
  title: "Components/Content surfaces/History",
  component: HistorySurface,
  subcomponents: { HistoryEntryRow },
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: {
      story: { inline: false, height: "620px" },
      description: { component: "Store-independent browsing-history surface composed from Button, IconButton, ListRow, Badge, EmptyState and ConfirmDialog primitives. Date grouping and artifact version labels remain deterministic when `now` is supplied." },
    },
  },
  args: {
    entries: ENTRIES,
    now: "2026-08-23T04:00:00.000Z",
    onOpenEntry: openEntry,
    onDeleteEntry: deleteEntry,
    onClearHistory: clearHistory,
  },
} satisfies Meta<typeof HistorySurface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("version 2")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: /Stillroom Radio https:\/\/stillroom\.fm\/live/ }));
    await expect(args.onOpenEntry).toHaveBeenCalledWith(ENTRIES[0]);
    await userEvent.click(canvas.getByRole("button", { name: "Delete Rain Library from history" }));
    await expect(args.onDeleteEntry).toHaveBeenCalledWith(ENTRIES[2]);
  },
};

export const ClearConfirmation: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Clear history" }));
    const dialog = await within(canvasElement.ownerDocument.body).findByRole("alertdialog", { name: "Clear browsing history?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Clear history" }));
    await expect(args.onClearHistory).toHaveBeenCalledOnce();
  },
};

export const Empty: Story = {
  args: { entries: [] },
  globals: { theme: "sedative" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("No paths recorded yet")).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Clear history" })).not.toBeInTheDocument();
  },
};

export const ErrorAndLoading: Story = {
  args: { entries: ENTRIES.slice(2) },
  globals: { theme: "cyberpunk", scheme: "dark" },
};

function historyEntry(input: Partial<BrowsingHistoryEntry> & Pick<BrowsingHistoryEntry, "id" | "title" | "url" | "status" | "openedAt">): BrowsingHistoryEntry {
  return {
    profileId: "profile-native",
    updatedAt: input.openedAt,
    favicon: deterministicGlyphFavicon(input.url, input.title.charAt(0)),
    ...input,
  };
}
