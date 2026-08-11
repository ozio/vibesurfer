import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

export default defineConfig({
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
  },
});
