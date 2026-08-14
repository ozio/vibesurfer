import {
  compileGeneratedArtifactDocument,
  type GeneratedArtifactDocument,
} from "../artifacts/document";
import type { ThemeId } from "../types/browser";

const palette: Record<ThemeId, { bg: string; surface: string; text: string; muted: string; accent: string }> = {
  native: { bg: "#f5f5f7", surface: "#ffffff", text: "#161617", muted: "#707077", accent: "#5e5ce6" },
  sedative: { bg: "#edf0f2", surface: "#ffffff", text: "#283036", muted: "#7a858c", accent: "#6f8390" },
  "ie-classic": { bg: "#008080", surface: "#d4d0c8", text: "#111111", muted: "#4f4f4f", accent: "#000080" },
  cyberpunk: { bg: "#060a11", surface: "#0d1521", text: "#e8fbff", muted: "#7896a1", accent: "#4df4ff" },
};

/**
 * Backwards-compatible demo artifact used while a generation job has not yet
 * produced persisted HTML. Real artifacts should call
 * `compileGeneratedArtifactDocument` with their stored HTML and URL.
 */
export function buildLegacyGeneratedArtifactDocument(
  prompt: string,
  theme: ThemeId,
  options: { artifactId?: string; url?: string } = {},
): GeneratedArtifactDocument {
  const colors = palette[theme];
  const safePrompt = escapeHtml(prompt);
  const title = sentenceCase(prompt);
  const safeTitle = escapeHtml(title);
  const cardRadius = theme === "ie-classic" ? "0" : theme === "sedative" ? "32px" : "18px";
  const cardBorder = theme === "sedative" ? "none" : `1px solid color-mix(in srgb, ${colors.text} 13%, transparent)`;
  const cardShadow = theme === "ie-classic"
    ? "inset 1px 1px white, inset -1px -1px #555"
    : theme === "sedative"
      ? "0 14px 40px rgba(62, 76, 86, .08)"
      : "0 18px 55px rgba(0,0,0,.08)";
  const sparkShadow = theme === "sedative" ? "none" : `0 0 18px ${colors.accent}`;
  const footerBorder = theme === "sedative" ? "none" : `1px solid color-mix(in srgb, ${colors.text} 12%, transparent)`;
  const eyebrowSpacing = theme === "sedative" ? ".025em" : ".14em";
  const eyebrowTransform = theme === "sedative" ? "none" : "uppercase";
  const url = options.url ?? `https://generated.vibe.local/${slugify(prompt)}`;
  const artifactId = options.artifactId ?? `legacy-${stableHash(`${prompt}:${theme}:${url}`)}`;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; color: ${colors.text}; background: ${colors.bg}; font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; }
    a { color: inherit; text-decoration: none; }
    a:focus-visible, button:focus-visible, input:focus-visible { outline: 3px solid ${colors.accent}; outline-offset: 3px; }
    .page { max-width: 1120px; margin: 0 auto; padding: clamp(32px, 7vw, 92px) clamp(24px, 5vw, 64px); }
    .eyebrow { display: inline-flex; align-items: center; gap: 8px; color: ${colors.accent}; font-size: 12px; font-weight: 650; letter-spacing: ${eyebrowSpacing}; text-transform: ${eyebrowTransform}; }
    .spark { width: 8px; height: 8px; border-radius: 50%; background: ${colors.accent}; box-shadow: ${sparkShadow}; }
    h1 { max-width: 850px; margin: 22px 0 18px; font-size: clamp(42px, 7vw, 86px); line-height: .98; letter-spacing: -.055em; }
    .lede { max-width: 640px; margin: 0; color: ${colors.muted}; font-size: clamp(17px, 2vw, 21px); line-height: 1.6; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-top: 58px; }
    .card { display: block; min-height: 190px; padding: 24px; border: ${cardBorder}; border-radius: ${cardRadius}; background: ${colors.surface}; box-shadow: ${cardShadow}; }
    .card:hover { transform: translateY(-2px); }
    .number { color: ${colors.accent}; font: 600 12px/1 ui-monospace, monospace; }
    h2 { margin: 54px 0 8px; font-size: 19px; letter-spacing: -.02em; }
    .card p { margin: 0; color: ${colors.muted}; line-height: 1.55; font-size: 14px; }
    .search { display: flex; gap: 8px; margin-top: 24px; }
    .search input { min-width: 0; flex: 1; padding: 12px 14px; border: ${cardBorder}; border-radius: 12px; background: ${colors.surface}; color: ${colors.text}; }
    .search button { padding: 12px 18px; border: 0; border-radius: 12px; background: ${colors.accent}; color: white; font-weight: 700; }
    .footer { display: flex; justify-content: space-between; gap: 24px; margin-top: 54px; padding-top: 18px; border-top: ${footerBorder}; color: ${colors.muted}; font-size: 12px; }
    @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } h2 { margin-top: 24px; } }
  </style>
</head>
<body>
  <main class="page">
    <div class="eyebrow"><span class="spark"></span>Overview</div>
    <h1>${safeTitle}</h1>
    <p class="lede">Explore “${safePrompt}” and follow any route to continue.</p>
    <form class="search" action="/search" method="get">
      <label hidden for="artifact-search">Search this site</label>
      <input id="artifact-search" name="q" placeholder="Search this site" />
      <button type="submit">Search</button>
    </form>
    <section class="grid" aria-label="Suggested routes">
      <a class="card" href="/discover"><span class="number">01 / ORIENT</span><h2>Discover</h2><p>Turn an idea into a navigable surface and continue into a related page.</p></a>
      <a class="card" href="/library"><span class="number">02 / SHAPE</span><h2>Library</h2><p>Browse a deeper collection without leaving this generated site world.</p></a>
      <a class="card" href="/about" target="_blank"><span class="number">03 / MOVE</span><h2>About this place</h2><p>Open another generated route in a new browser tab.</p></a>
    </section>
    <footer class="footer"><a href="#top">Back to top</a><span>${safeTitle}</span></footer>
  </main>
</body>
</html>`;

  return compileGeneratedArtifactDocument({ artifactId, url, title, html, browserTheme: theme });
}

export function buildGeneratedDocument(prompt: string, theme: ThemeId) {
  return buildLegacyGeneratedArtifactDocument(prompt, theme).srcDoc;
}

export { compileGeneratedArtifactDocument } from "../artifacts/document";
export type {
  ArtifactSanitizationWarning,
  ArtifactSanitizationWarningCode,
  GeneratedArtifactDocument,
  GeneratedArtifactDocumentInput,
} from "../artifacts/document";

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" };
    return entities[character];
  });
}

function sentenceCase(value: string) {
  const normalized = value.trim() || "Generated page";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z\d]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "untitled";
}

function stableHash(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}
