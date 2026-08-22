import type { Preview } from "@storybook/react-vite";
import { withBrowserStoryEnvironment } from "../src/storybook/BrowserStoryEnvironment";
import "../src/styles/app.css";
import "../src/storybook/storybook.css";

const preview: Preview = {
  decorators: [withBrowserStoryEnvironment],
  tags: ["autodocs"],
  globalTypes: {
    theme: {
      description: "Browser chrome theme",
      toolbar: {
        icon: "paintbrush",
        items: [
          { value: "native", title: "Native" },
          { value: "sedative", title: "Sedative" },
          { value: "ie-classic", title: "IE Classic" },
          { value: "cyberpunk", title: "Cyberpunk" },
        ],
        dynamicTitle: true,
      },
    },
    scheme: {
      description: "Color scheme",
      toolbar: {
        icon: "mirror",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
          { value: "system", title: "System" },
        ],
        dynamicTitle: true,
      },
    },
    platform: {
      description: "Host operating system",
      toolbar: {
        icon: "browser",
        items: [
          { value: "macos", title: "macOS" },
          { value: "windows", title: "Windows" },
          { value: "linux", title: "Linux" },
        ],
        dynamicTitle: true,
      },
    },
    density: {
      description: "Control density",
      toolbar: {
        icon: "dashboard",
        items: [
          { value: "comfortable", title: "Comfortable" },
          { value: "compact", title: "Compact" },
        ],
        dynamicTitle: true,
      },
    },
    tabs: {
      description: "Tab placement",
      toolbar: {
        icon: "sidebar",
        items: [
          { value: "horizontal", title: "Horizontal" },
          { value: "vertical", title: "Vertical" },
        ],
        dynamicTitle: true,
      },
    },
    motion: {
      description: "Animation behavior",
      toolbar: {
        icon: "lightning",
        items: [
          { value: "reduced", title: "Reduced" },
          { value: "full", title: "Full" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: "native",
    scheme: "light",
    platform: "macos",
    density: "comfortable",
    tabs: "horizontal",
    motion: "reduced",
  },
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      test: "error",
    },
    options: {
      storySort: {
        order: ["Foundation", "Browser", "Components"],
      },
    },
  },
};

export default preview;
