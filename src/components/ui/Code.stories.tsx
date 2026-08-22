import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { CodeBlock as UiCodeBlock, CopyButton as UiCopyButton, JsonViewer as UiJsonViewer } from "./Code";

const writeText = fn(async (_text: string) => undefined);
const circular: { name: string; self?: unknown; nested: { enabled: boolean; count: bigint } } = {
  name: "browser-state",
  nested: { enabled: true, count: 4n },
};
circular.self = circular;

const code = `export const theme = {
  id: "native",
  chrome: "modern",
};`;

const meta = {
  title: "Components/UI/Code and data",
  component: UiCopyButton,
  subcomponents: { CodeBlock: UiCodeBlock, JsonViewer: UiJsonViewer },
  decorators: [(Story) => <div className="story-surface story-surface--column"><div className="story-wide-frame"><Story /></div></div>],
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: { description: { component: "Safe, selectable technical output. Copy feedback is announced without changing layout; JSON serialization bounds depth and handles circular references and bigint values." } },
  },
  args: { text: "vibe://welcome", writeText },
} satisfies Meta<typeof UiCopyButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CopyButton: Story = {
  render: () => <div className="story-component-row"><UiCopyButton text="vibe://welcome" writeText={writeText} /><UiCopyButton text="vibe://settings" showLabel writeText={writeText} /><UiCopyButton text="" disabled showLabel /></div>,
  play: async ({ canvasElement }) => {
    const copy = within(canvasElement).getAllByRole("button", { name: "Copy" })[0]!;
    await userEvent.click(copy);
    await expect(writeText).toHaveBeenLastCalledWith("vibe://welcome");
    await expect(copy).toHaveAccessibleName("Copied");
  },
};

export const CodeBlock: Story = {
  render: () => (
    <div className="story-stack">
      <UiCodeBlock code={code} language="typescript" label="Theme registry" writeText={writeText} />
      <UiCodeBlock code="A very long generated line can wrap when the consumer opts in instead of forcing horizontal scrolling." label="Wrapped output" wrap copyable={false} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Theme registry")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Copy" }));
    await expect(writeText).toHaveBeenLastCalledWith(code);
  },
};

export const JsonViewer: Story = {
  render: () => (
    <div className="story-stack">
      <UiJsonViewer value={{ theme: "cyberpunk", tabs: ["welcome", "settings"], motion: "reduced" }} title="Story globals" writeText={writeText} />
      <UiJsonViewer value={circular} title="Bounded runtime state" collapsed defaultOpen={false} maxDepth={2} writeText={writeText} />
      <UiJsonViewer value={null} title="Empty payload" copyable={false} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/"theme": "cyberpunk"/)).toBeInTheDocument();
    await userEvent.click(canvas.getByText("Bounded runtime state"));
    await expect(canvas.getByText(/"\[Circular\]"/)).toBeVisible();
  },
};
