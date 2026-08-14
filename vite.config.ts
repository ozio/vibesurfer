import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AtRule, Plugin as PostCssPlugin, Root } from "postcss";

const host = process.env.TAURI_DEV_HOST;
const frameRuntimeSource = readFileSync(
  resolve(process.cwd(), "src/artifacts/frame-runtime.js"),
  "utf8",
);
export const artifactFrameRuntimeHash = `sha256-${createHash("sha256").update(frameRuntimeSource).digest("base64")}`;

export function injectArtifactFrameRuntime(html: string) {
  return html
    .replace("__FRAME_RUNTIME_CSP_HASH__", artifactFrameRuntimeHash)
    .replace(
      '<script data-vibesurfer-frame-runtime></script>',
      `<script data-vibesurfer-frame-runtime>${frameRuntimeSource}</script>`,
    );
}

const ARTIFACT_FONT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "Arimo Variable": ["Arial", "Verdana", "MS Sans Serif"],
  Tinos: ["MS Serif", "Times New Roman"],
  Cousine: ["Courier New", "Monaco"],
  "Roboto Condensed Variable": ["Arial Narrow"],
  "Source Sans 3 Variable": [
    "Tahoma",
    "Trebuchet MS",
    "Lucida Sans Unicode",
    "Helvetica Neue",
    "Helvetica",
    "Geneva",
    "Lucida Grande",
    "Myriad",
    "Myriad Pro",
  ],
  "Gelasio Variable": ["Georgia"],
  "Comic Neue": ["Comic Sans MS"],
  Anton: ["Impact"],
  "Archivo Black": ["Arial Black"],
};

function artifactFontAliases(): PostCssPlugin {
  return {
    postcssPlugin: "vibesurfer-artifact-font-aliases",
    Once(root: Root) {
      const input = root.source?.input.file?.replaceAll("\\", "/") ?? "";
      if (!input.endsWith("/src/artifacts/artifact-fonts.css")) return;

      const aliases: AtRule[] = [];
      root.walkAtRules("font-face", (fontFace) => {
        let family = "";
        fontFace.walkDecls("font-family", (declaration) => {
          family ||= declaration.value.replace(/^['\"]|['\"]$/g, "");
        });
        fontFace.walkDecls("src", (declaration) => {
          // Fontsource keeps WOFF as an old-browser fallback. The artifact
          // WebView supports WOFF2, so shipping both would double the CJK pack.
          declaration.value = declaration.value.replace(
            /,\s*url\([^)]*\.woff\)\s*format\((['\"])woff\1\)/gi,
            "",
          );
        });
        for (const alias of ARTIFACT_FONT_ALIASES[family] ?? []) {
          const clone = fontFace.clone();
          clone.walkDecls("font-family", (declaration) => {
            declaration.value = JSON.stringify(alias);
          });
          clone.walkDecls("src", (declaration) => {
            declaration.value = `local(${JSON.stringify(alias)}), ${declaration.value}`;
          });
          aliases.push(clone);
        }
      });
      root.append(aliases);
    },
  };
}

export default defineConfig({
  css: {
    postcss: {
      plugins: [artifactFontAliases()],
    },
  },
  plugins: [
    react(),
    {
      name: "inline-artifact-frame-runtime",
      transformIndexHtml: {
        order: "post",
        handler(html, context) {
          if (!context.filename.endsWith("artifact-frame.html")) return html;
          return injectArtifactFrameRuntime(html);
        },
      },
    },
  ],
  clearScreen: false,
  build: {
    rolldownOptions: {
      input: {
        app: "index.html",
        artifactFrame: "artifact-frame.html",
      },
      output: {
        codeSplitting: {
          minSize: 12_000,
          groups: [
            {
              name: "react-runtime",
              test: /node_modules\/(react|react-dom|react-router|react-router-dom)\//,
            },
            {
              name: "ui-primitives",
              test: /node_modules\/(radix-ui|@radix-ui|motion|lucide-react)\//,
            },
            {
              name: "drag-and-drop",
              test: /node_modules\/@dnd-kit\//,
            },
          ],
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    headers: {
      // Artifact frames intentionally have an opaque sandbox origin. Local
      // immutable CSS/font assets therefore need an explicit CORS grant.
      "Access-Control-Allow-Origin": "*",
    },
  },
  preview: {
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
  },
});
