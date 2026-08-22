import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import type { GlyphFavicon, SystemFaviconName } from "../../types/browser";
import { Favicon } from "./Favicon";

const validImage = "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='4' fill='%235b5df0'/%3E%3Cpath d='M4 8h8' stroke='white' stroke-width='2'/%3E%3C/svg%3E";

const meta = {
  title: "Components/UI/Favicon",
  component: Favicon,
  decorators: [
    (Story) => (
      <div className="story-surface">
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: {
      description: {
        component: "A decorative, host-owned page identity with deterministic glyph and safe inline-image fallbacks.",
      },
    },
  },
  args: {
    title: "Vibesurfer",
  },
} satisfies Meta<typeof Favicon>;

export default meta;
type Story = StoryObj<typeof meta>;

const systemIcons: SystemFaviconName[] = [
  "new-tab",
  "settings",
  "history",
  "activity",
  "capabilities",
  "generation-debug",
];

export const SystemIcons: Story = {
  render: () => (
    <div className="story-favicon-grid">
      {systemIcons.map((icon) => (
        <span className="story-favicon-item" key={icon}>
          <Favicon source={{ kind: "system", icon }} title={icon} />
          <small>{icon}</small>
        </span>
      ))}
    </div>
  ),
};

const glyphs: GlyphFavicon[] = [
  { kind: "glyph", glyph: "C", foreground: "#ffffff", background: "#2563eb", shape: "circle" },
  { kind: "glyph", glyph: "R", foreground: "#ffffff", background: "#7c3aed", shape: "rounded-square" },
  { kind: "glyph", glyph: "S", foreground: "#111111", background: "#facc15", shape: "square" },
];

export const GlyphShapes: Story = {
  render: () => (
    <div className="story-component-row">
      {glyphs.map((source) => (
        <span className="story-favicon-item" key={source.shape}>
          <Favicon source={source} title={source.shape} />
          <small>{source.shape}</small>
        </span>
      ))}
    </div>
  ),
};

export const ShortString: Story = {
  args: {
    source: "VS",
    seed: "vibesurfer",
  },
};

export const Generated: Story = {
  args: {
    generated: true,
  },
};

export const InlineImage: Story = {
  args: {
    source: { kind: "image", src: validImage, mimeType: "image/svg+xml" },
  },
  play: async ({ canvasElement }) => {
    const image = canvasElement.querySelector("img");
    await expect(image).not.toBeNull();
    await expect(image).toHaveAttribute("src", validImage);
  },
};

export const BrokenImageFallback: Story = {
  args: {
    source: { kind: "image", src: "data:image/png;base64,not-a-png" },
    title: "Broken source",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText("B")).toBeInTheDocument());
  },
};

export const EmptyFallback: Story = {
  args: {
    source: undefined,
    title: "",
  },
};
