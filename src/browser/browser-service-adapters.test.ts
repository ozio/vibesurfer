import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createStorybookBrowserServices,
  createTauriBrowserServices,
  createWebBrowserServices,
} from "./browser-service-adapters";

const tauri = vi.hoisted(() => ({
  openUrl: vi.fn(),
  invoke: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
  close: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: tauri.openUrl }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: tauri.listen }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: tauri.minimize,
    toggleMaximize: tauri.toggleMaximize,
    close: tauri.close,
  }),
}));

describe("browser service adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauri.listen.mockResolvedValue(tauri.unlisten);
  });

  it("opens only bounded HTTP(S) URLs in the web adapter", async () => {
    const open = vi.fn();
    const services = createWebBrowserServices("linux", { open } as Pick<Window, "open">);

    await expect(services.external.open("https://example.com/path")).resolves.toBe(true);
    expect(open).toHaveBeenCalledWith("https://example.com/path", "_blank", "noopener,noreferrer");
    await expect(services.external.open("javascript:alert(1)")).resolves.toBe(false);
    expect(open).toHaveBeenCalledOnce();
    await expect(services.window.perform("close")).resolves.toBeUndefined();
    await expect(services.nativeMenu.update({
      canGoBack: false,
      canGoForward: false,
      isLoading: false,
      isGenerated: false,
      isArchived: false,
      hasLiveSite: false,
      horizontalTabs: true,
    })).resolves.toBeUndefined();
  });

  it("keeps Storybook side-effect free while exposing injectable spies", async () => {
    const externalOpen = vi.fn();
    const windowAction = vi.fn();
    const applyTheme = vi.fn();
    const services = createStorybookBrowserServices("windows", {
      externalOpen,
      windowAction,
      applyTheme,
    });

    await expect(services.external.open("https://example.com/")).resolves.toBe(false);
    await services.window.perform("minimize");
    await services.window.applyTheme({ cornerRadius: 28 });
    expect(externalOpen).toHaveBeenCalledWith("https://example.com/");
    expect(windowAction).toHaveBeenCalledWith("minimize");
    expect(applyTheme).toHaveBeenCalledWith({ cornerRadius: 28 });
    expect(services.runtime).toBe("storybook");
  });

  it("contains all lazy Tauri UI operations behind one adapter", async () => {
    const services = createTauriBrowserServices("macos");
    const listener = vi.fn();

    await expect(services.external.open("https://example.com/")).resolves.toBe(true);
    await services.window.perform("toggleMaximize");
    await services.window.applyTheme({ cornerRadius: 4 });
    const dispose = await services.nativeMenu.listen(listener);
    const eventHandler = tauri.listen.mock.calls[0]?.[1] as ((event: { payload: unknown }) => void);
    eventHandler({ payload: "new-tab" });

    expect(tauri.openUrl).toHaveBeenCalledWith("https://example.com/");
    expect(tauri.toggleMaximize).toHaveBeenCalledOnce();
    expect(tauri.invoke).toHaveBeenCalledWith("set_window_corner_radius", { radius: 4 });
    expect(tauri.listen).toHaveBeenCalledWith("vibesurfer://native-menu", expect.any(Function));
    expect(listener).toHaveBeenCalledWith("new-tab");
    dispose();
    expect(tauri.unlisten).toHaveBeenCalledOnce();
  });
});
