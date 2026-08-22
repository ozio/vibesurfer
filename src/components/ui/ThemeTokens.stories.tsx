import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { UI_THEME_TOKENS, type UiThemeTokenDefinition } from "./theme-tokens";

function TokenSample({ token }: { token: UiThemeTokenDefinition }) {
  if (["Surface", "Text", "Border", "Accent", "Status", "Focus"].includes(token.category)) {
    return <span className="story-token-swatch" style={{ background: `var(${token.name})` }} />;
  }
  if (token.category === "Shadow") return <span className="story-token-shadow" style={{ boxShadow: `var(${token.name})` }} />;
  if (token.category === "Radius") return <span className="story-token-radius" style={{ borderRadius: `var(${token.name})` }} />;
  if (token.category === "Typography") return <span className="story-token-type" style={{ fontFamily: `var(${token.name})` }}>Aa</span>;
  return <span className="story-token-value">live</span>;
}

function ThemeTokenReference() {
  const categories = [...new Set(UI_THEME_TOKENS.map((token) => token.category))];
  return (
    <div className="story-token-reference">
      <header><span>Theme API</span><h1>Semantic browser tokens</h1><p>Every reusable primitive reads this contract. Switch Theme, Scheme, Platform, or Density in the toolbar to inspect the same component CSS against another implementation.</p></header>
      {categories.map((category) => (
        <section key={category}>
          <h2>{category}</h2>
          <div className="story-token-table" role="list" aria-label={`${category} tokens`}>
            {UI_THEME_TOKENS.filter((token) => token.category === category).map((token) => (
              <div key={token.name} role="listitem" data-theme-token={token.name}>
                <TokenSample token={token} />
                <code>{token.name}</code>
                <span>{token.purpose}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const meta = {
  title: "Foundation/Theme tokens",
  component: ThemeTokenReference,
  decorators: [(Story) => <div className="story-surface story-surface--docs"><Story /></div>],
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: { description: { component: "The complete supported theme-token surface for reusable browser UI. New themes must define this semantic contract before adding component-specific exceptions." } },
  },
} satisfies Meta<typeof ThemeTokenReference>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Reference: Story = {
  play: async ({ canvasElement }) => {
    const rows = within(canvasElement).getAllByRole("listitem");
    await expect(rows).toHaveLength(UI_THEME_TOKENS.length);
    const styles = getComputedStyle(canvasElement.ownerDocument.documentElement);
    for (const token of UI_THEME_TOKENS) {
      await expect(styles.getPropertyValue(token.name).trim(), `${token.name} must resolve in the active theme`).not.toBe("");
    }
  },
};

export const CompactReference: Story = {
  globals: { density: "compact" },
  render: () => <ThemeTokenReference />,
};

export const TokenContract: Story = {
  render: () => (
    <pre className="story-token-contract" tabIndex={0}>{JSON.stringify(UI_THEME_TOKENS, null, 2)}</pre>
  ),
  parameters: { docs: { source: { code: "import { UI_THEME_TOKENS } from './components/ui';" } } },
};
