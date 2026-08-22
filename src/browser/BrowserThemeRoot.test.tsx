import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStorybookBrowserServices } from "./browser-service-adapters";
import { BrowserServicesProvider } from "./browser-services";
import { BrowserThemeRoot } from "./BrowserThemeRoot";

const root = document.documentElement;
const originalClassName = root.className;
const originalDataset = { ...root.dataset };

afterEach(() => {
  root.className = originalClassName;
  for (const key of Object.keys(root.dataset)) delete root.dataset[key];
  Object.assign(root.dataset, originalDataset);
});

describe("BrowserThemeRoot", () => {
  it("applies and restores the shared root and native-window contract without DOM", () => {
    const applyTheme = vi.fn();
    const services = createStorybookBrowserServices("windows", { applyTheme });
    root.dataset.theme = "cyberpunk";
    root.dataset.platform = "linux";
    root.classList.remove("reduce-motion");

    const view = render(
      <BrowserServicesProvider services={services}>
        <BrowserThemeRoot
          theme="sedative"
          colorScheme="dark"
          density="compact"
          tabLayout="vertical"
          motion="reduced"
        >
          <span data-testid="content">Browser</span>
        </BrowserThemeRoot>
      </BrowserServicesProvider>,
    );

    expect(view.container.innerHTML).toBe('<span data-testid="content">Browser</span>');
    expect(root.dataset).toMatchObject({
      theme: "sedative",
      platform: "windows",
      tabs: "vertical",
      density: "compact",
      colorScheme: "dark",
      runtime: "storybook",
    });
    expect(root).toHaveClass("reduce-motion");
    expect(applyTheme).toHaveBeenCalledWith({ cornerRadius: 28 });

    view.rerender(
      <BrowserServicesProvider services={services}>
        <BrowserThemeRoot
          theme="sedative"
          colorScheme="light"
          density="comfortable"
          tabLayout="horizontal"
          motion="full"
        >
          <span data-testid="content">Browser</span>
        </BrowserThemeRoot>
      </BrowserServicesProvider>,
    );
    expect(applyTheme).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(root.dataset.theme).toBe("cyberpunk");
    expect(root.dataset.platform).toBe("linux");
    expect(root).not.toHaveClass("reduce-motion");
    expect(applyTheme).toHaveBeenLastCalledWith({ cornerRadius: 4 });
  });

  it("lets an outer root own globals for nested BrowserShell surfaces", () => {
    const applyTheme = vi.fn();
    const services = createStorybookBrowserServices("macos", { applyTheme });

    render(
      <BrowserServicesProvider services={services}>
        <BrowserThemeRoot theme="native" colorScheme="light" density="comfortable" tabLayout="horizontal" motion="full">
          <BrowserThemeRoot theme="cyberpunk" colorScheme="dark" density="compact" tabLayout="vertical" motion="reduced">
            <span />
          </BrowserThemeRoot>
        </BrowserThemeRoot>
      </BrowserServicesProvider>,
    );

    expect(root.dataset.theme).toBe("native");
    expect(applyTheme).toHaveBeenCalledTimes(1);
  });
});
