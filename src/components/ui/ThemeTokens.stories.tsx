import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import {
  UI_COMPONENT_THEME_TOKENS,
  UI_THEME_TOKENS,
  type UiComponentThemeTokenDefinition,
  type UiThemeTokenDefinition,
} from "./theme-tokens";

type DisplayToken = UiThemeTokenDefinition | UiComponentThemeTokenDefinition;

function TokenSample({ token }: { token: DisplayToken }) {
  if (["Surface", "Text", "Border", "Accent", "Status", "Focus", "Control", "Field", "Overlay", "Card", "Selection", "Browser"].includes(token.category)) {
    return <span className="story-token-swatch" style={{ background: `var(${token.name})` }} />;
  }
  if (token.category === "Shadow") return <span className="story-token-shadow" style={{ boxShadow: `var(${token.name})` }} />;
  if (token.category === "Radius") return <span className="story-token-radius" style={{ borderRadius: `var(${token.name})` }} />;
  if (token.category === "Typography") return <span className="story-token-type" style={{ fontFamily: `var(${token.name})` }}>Aa</span>;
  return <span className="story-token-value">live</span>;
}

function ThemeTokenReference() {
  const tokenSets = [
    { id: "foundation", title: "Foundation tokens", description: "Every registered theme defines this complete visual foundation.", tokens: UI_THEME_TOKENS },
    { id: "components", title: "Component tokens", description: "Stable aliases customize reusable UI without copying component selectors.", tokens: UI_COMPONENT_THEME_TOKENS },
  ] as const;

  return (
    <div className="story-token-reference">
      <header><span>Theme API</span><h1>Semantic browser tokens</h1><p>Every reusable primitive reads this contract. Switch Theme, Scheme, Platform, or Density in the toolbar to inspect the same component CSS against another implementation.</p></header>
      {tokenSets.map((set) => (
        <section key={set.id} aria-labelledby={`${set.id}-tokens`}>
          <h2 id={`${set.id}-tokens`}>{set.title}</h2>
          <p>{set.description}</p>
          {[...new Set(set.tokens.map((token) => token.category))].map((category) => (
            <div key={category} className="story-token-category">
              <h3>{category}</h3>
              <div className="story-token-table" role="list" aria-label={`${category} tokens`}>
                {set.tokens.filter((token) => token.category === category).map((token) => (
                  <div key={token.name} role="listitem" data-theme-token={token.name}>
                    <TokenSample token={token} />
                    <code>{token.name}</code>
                    <span>{token.purpose}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
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
    docs: { description: { component: "The complete foundation and component-token surface for reusable browser UI. New themes define the foundation contract before adding component-token overrides or narrow selector exceptions." } },
  },
} satisfies Meta<typeof ThemeTokenReference>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Reference: Story = {
  play: async ({ canvasElement }) => {
    const tokens = [...UI_THEME_TOKENS, ...UI_COMPONENT_THEME_TOKENS];
    const rows = within(canvasElement).getAllByRole("listitem");
    await expect(rows).toHaveLength(tokens.length);
    const styles = getComputedStyle(canvasElement.ownerDocument.documentElement);
    for (const token of tokens) {
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
    <pre className="story-token-contract" tabIndex={0}>{JSON.stringify({ foundation: UI_THEME_TOKENS, components: UI_COMPONENT_THEME_TOKENS }, null, 2)}</pre>
  ),
  parameters: { docs: { source: { code: "import { UI_COMPONENT_THEME_TOKENS, UI_THEME_TOKENS } from './components/ui';" } } },
};
