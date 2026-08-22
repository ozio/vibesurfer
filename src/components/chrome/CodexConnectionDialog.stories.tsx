import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type { CodexModel } from "../../types/browser";
import { CodexConnectionDialog } from "./CodexConnectionDialog";

const CODEX_MODELS: CodexModel[] = [
  {
    id: "gpt-5.6-codex",
    model: "gpt-5.6-codex",
    displayName: "GPT-5.6 Codex",
    isDefault: true,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "Fast responses with lighter reasoning." },
      { reasoningEffort: "medium", description: "Balanced reasoning for browser generation." },
      { reasoningEffort: "high", description: "Deeper reasoning for complex pages." },
    ],
    serviceTiers: [{ id: "priority", name: "Priority", description: "Lower latency when available." }],
  },
  {
    id: "gpt-5.5",
    model: "gpt-5.5",
    displayName: "GPT-5.5",
    isDefault: false,
    supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Uses balanced reasoning." }],
    serviceTiers: [],
  },
];

const meta = {
  title: "Components/Browser controls/CodexConnectionDialog",
  component: CodexConnectionDialog,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: { description: { component: "Store-free Codex connection and generation-settings dialog. The connected adapter owns host calls; this component owns only accessible presentation." } },
  },
  args: {
    open: true,
    connection: { state: "signed-out", available: true, message: "Codex is ready to connect." },
    models: CODEX_MODELS,
    selection: { modelId: "gpt-5.6-codex", reasoningEffort: "medium" },
    onOpenChange: fn(),
    onRefresh: fn(),
    onBeginLogin: fn(),
    onUseCodex: fn(),
    onSelectionChange: fn(),
  },
} satisfies Meta<typeof CodexConnectionDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SignedOut: Story = {
  play: async ({ canvasElement, args }) => {
    const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Codex (ChatGPT)" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue with Codex" }));
    await expect(args.onBeginLogin).toHaveBeenCalledOnce();
  },
};

export const Checking: Story = {
  args: {
    connection: { state: "checking", available: true, message: "Checking Codex connection…" },
  },
  play: async ({ canvasElement }) => {
    const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Codex (ChatGPT)" });
    await expect(within(dialog).getByRole("button", { name: "Continue with Codex" })).toBeDisabled();
  },
};

export const WaitingForBrowser: Story = {
  args: {
    connection: { state: "waiting-browser", available: true, message: "Complete sign-in in your browser, then return here." },
  },
};

export const SignedIn: Story = {
  args: {
    connection: { state: "signed-in", available: true, message: "Signed in through the Codex App Server." },
  },
  play: async ({ canvasElement, args }) => {
    const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Codex (ChatGPT)" });
    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "Codex model" }), "gpt-5.5");
    await expect(args.onSelectionChange).toHaveBeenCalledWith({ modelId: "gpt-5.5" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Use Codex" }));
    await expect(args.onUseCodex).toHaveBeenCalledOnce();
  },
};

export const CatalogLoading: Story = {
  args: {
    connection: { state: "signed-in", available: true, message: "Signed in." },
    catalogLoading: true,
  },
};

export const CatalogError: Story = {
  args: {
    connection: { state: "signed-in", available: true, message: "Signed in." },
    catalogError: "The local Codex catalog did not respond.",
  },
  globals: { theme: "ie-classic" },
};

export const ConnectionError: Story = {
  args: {
    connection: { state: "error", available: false, message: "Codex App Server is unavailable." },
  },
  globals: { theme: "sedative" },
};
