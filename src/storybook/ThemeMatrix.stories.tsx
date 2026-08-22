import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { BROWSER_EXPERIENCE_REGISTRY, BROWSER_THEME_IDS, type ThemeId } from "../browser/browser-experience-registry";

const canonicalStoryIds = {
  native: "browser-browsershell--native",
  sedative: "browser-browsershell--sedative",
  "ie-classic": "browser-browsershell--ie-classic",
  cyberpunk: "browser-browsershell--cyberpunk",
} as const satisfies Record<ThemeId, string>;

function canonicalStoryUrl(theme: ThemeId) {
  const globals = [
    `theme:${theme}`,
    "scheme:light",
    "platform:macos",
    "density:comfortable",
    "tabs:horizontal",
    "motion:reduced",
  ].join(";");
  return `./iframe.html?${new URLSearchParams({ id: canonicalStoryIds[theme], viewMode: "story", globals })}`;
}

function ThemeVisualMatrix() {
  return (
    <main className="story-theme-matrix">
      <header>
        <span>Canonical baseline</span>
        <h1>One browser, four theme implementations</h1>
        <p>Each viewport loads the same deterministic welcome fixture in an isolated Storybook preview. Component behavior and content stay fixed while the complete theme and chrome recipe change.</p>
      </header>
      <div className="story-theme-matrix__grid">
        {BROWSER_THEME_IDS.map((theme) => {
          const definition = BROWSER_EXPERIENCE_REGISTRY[theme];
          return (
            <figure key={theme} data-theme-matrix-cell={theme}>
              <figcaption>
                <span><strong>{definition.chrome.toolbarLabel}</strong><code>{theme}</code></span>
                <small>{definition.chrome.caption}</small>
              </figcaption>
              <div className="story-theme-matrix__viewport">
                <iframe title={`${definition.chrome.toolbarLabel} theme preview`} src={canonicalStoryUrl(theme)} loading="eager" />
              </div>
            </figure>
          );
        })}
      </div>
    </main>
  );
}

const meta = {
  title: "Foundation/Theme matrix",
  component: ThemeVisualMatrix,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: { description: { component: "The four canonical BrowserShell baselines shown together against the same fixture. Open an individual BrowserShell story to inspect toolbar axes at full size." } },
  },
} satisfies Meta<typeof ThemeVisualMatrix>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BrowserShells: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const frames = canvas.getAllByTitle(/theme preview$/i) as HTMLIFrameElement[];
    await expect(frames).toHaveLength(BROWSER_THEME_IDS.length);
    for (const [index, theme] of BROWSER_THEME_IDS.entries()) {
      await expect(frames[index].src).toContain(canonicalStoryIds[theme]);
      await expect(frames[index].src).toContain(`theme%3A${theme}`);
    }
  },
};
