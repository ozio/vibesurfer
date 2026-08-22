import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { StorybookConfig } from "@storybook/react-vite";
import type { Alias, AliasOptions, Plugin } from "vite";

const staticAssets = [
  {
    pathname: "/favicon.png",
    filename: resolve(process.cwd(), "public/favicon.png"),
    contentType: "image/png",
  },
  {
    pathname: "/brand/vibesurfer-logo.png",
    filename: resolve(process.cwd(), "public/brand/vibesurfer-logo.png"),
    contentType: "image/png",
  },
] as const;

function selectedStaticAssets(): Plugin {
  return {
    name: "vibesurfer-storybook-static-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split("?", 1)[0];
        const asset = staticAssets.find((candidate) => candidate.pathname === pathname);
        if (!asset) {
          next();
          return;
        }

        response.statusCode = 200;
        response.setHeader("Content-Type", asset.contentType);
        response.setHeader("Cache-Control", "no-cache");
        response.end(readFileSync(asset.filename));
      });
    },
    generateBundle() {
      for (const asset of staticAssets) {
        this.emitFile({
          type: "asset",
          fileName: asset.pathname.slice(1),
          source: readFileSync(asset.filename),
        });
      }
    },
  };
}

const config: StorybookConfig = {
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  addons: [
    "@storybook/addon-vitest",
    "@storybook/addon-a11y",
    "@storybook/addon-docs",
  ],
  framework: "@storybook/react-vite",
  docs: {
    defaultName: "Documentation",
  },
  async viteFinal(viteConfig) {
    const build = { ...viteConfig.build };
    delete build.rolldownOptions;

    return {
      ...viteConfig,
      publicDir: false,
      build,
      define: {
        ...viteConfig.define,
        "import.meta.env.VIBESURFER_STORYBOOK": JSON.stringify(true),
      },
      resolve: {
        ...viteConfig.resolve,
        alias: [
          {
            find: "../../audio/local-speech",
            replacement: resolve(process.cwd(), "src/storybook/LocalSpeechPlayer.stub.ts"),
          },
          ...normalizedAliases(viteConfig.resolve?.alias),
        ],
      },
      plugins: [...(viteConfig.plugins ?? []), selectedStaticAssets()],
    };
  },
};

function normalizedAliases(aliases: AliasOptions | undefined): Alias[] {
  if (Array.isArray(aliases)) return [...aliases];
  return Object.entries(aliases ?? {}).map(([find, replacement]) => ({ find, replacement }));
}

export default config;
