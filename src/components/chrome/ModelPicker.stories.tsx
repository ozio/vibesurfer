import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { MODELS } from "../../data/catalog";
import { ModelOption, ModelPicker } from "./ModelPicker";

const selectModel = fn();
const manageModels = fn();

const meta = {
  title: "Components/Browser controls/ModelPicker",
  component: ModelPicker,
  subcomponents: { ModelOption },
  decorators: [(Story) => <div className="story-surface story-surface--controls"><div className="story-control-frame"><Story /></div></div>],
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: { description: { component: "Controlled model chooser with a searchable listbox, exported ModelOption rows, roving keyboard focus, and no browser-store dependency." } },
  },
  args: {
    models: MODELS,
    activeModelId: "mock:preview",
    activeModelName: "Vibe Preview",
    connectionState: "signed-out",
    onSelect: selectModel,
    onManageModels: manageModels,
  },
} satisfies Meta<typeof ModelPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Model: Vibe Preview" }));
    const body = within(canvasElement.ownerDocument.body);
    const listbox = await body.findByRole("listbox", { name: "Models" });
    await expect(within(listbox).getAllByRole("option")).toHaveLength(MODELS.length);
    await expect(within(listbox).getByRole("option", { name: /Vibe Preview/ })).toHaveAttribute("aria-selected", "true");
  },
};

export const CodexConnected: Story = {
  args: {
    activeModelId: "codex:chatgpt",
    activeModelName: "GPT-5.6 Codex",
    connectionState: "signed-in",
    defaultOpen: true,
  },
  globals: { theme: "cyberpunk" },
};

export const SetupRequired: Story = {
  args: { activeModelId: "local:auto", activeModelName: "Local Auto", defaultOpen: true },
  play: async ({ canvasElement }) => {
    const option = await within(canvasElement.ownerDocument.body).findByRole("option", { name: /Custom provider/ });
    await expect(option).toHaveTextContent("Set up");
  },
};

export const SearchAndEmptyState: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: "Model: Vibe Preview" });
    await userEvent.click(trigger);
    const body = within(canvasElement.ownerDocument.body);
    const search = await body.findByRole("combobox", { name: "Search models" });
    await userEvent.type(search, "zzzz-no-model");
    await expect(body.getByRole("status")).toHaveTextContent("No models found");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(body.queryByRole("combobox", { name: "Search models" })).not.toBeInTheDocument());
    await userEvent.click(trigger);
    await expect(await body.findByRole("combobox", { name: "Search models" })).toHaveValue("");
  },
};

export const KeyboardNavigation: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Model: Vibe Preview" }));
    const body = within(canvasElement.ownerDocument.body);
    const search = await body.findByRole("combobox", { name: "Search models" });
    await userEvent.keyboard("{ArrowDown}{End}{Enter}");
    await expect(args.onSelect).toHaveBeenCalledWith(MODELS.at(-1));
    await expect(search).toHaveAttribute("aria-controls");
  },
};

export const UniqueIdsPerInstance: Story = {
  render: (args) => (
    <div className="story-control-pair">
      <ModelPicker {...args} />
      <ModelPicker {...args} activeModelId="codex:chatgpt" activeModelName="Codex (ChatGPT)" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole("button", { name: "Model: Vibe Preview" }));
    const firstId = (await body.findByRole("combobox", { name: "Search models" })).getAttribute("aria-controls");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(canvas.getByRole("button", { name: "Model: Codex (ChatGPT)" }));
    const secondId = (await body.findByRole("combobox", { name: "Search models" })).getAttribute("aria-controls");
    await expect(firstId).not.toBe(secondId);
  },
};
