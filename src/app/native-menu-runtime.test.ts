import { describe, expect, it, vi } from "vitest";
import {
  handleNativeMenuCommand,
  isNativeMenuCommand,
  type NativeMenuActions,
} from "./native-menu-runtime";

function actions(): NativeMenuActions {
  return {
    newTab: vi.fn(),
    closeTab: vi.fn(),
    focusAddress: vi.fn(),
    reload: vi.fn(),
    stop: vi.fn(),
    go: vi.fn(),
    home: vi.fn(),
    history: vi.fn(),
    switchTab: vi.fn(),
    reimagine: vi.fn(),
    openLiveSite: vi.fn(),
    setTabLayout: vi.fn(),
    openSettings: vi.fn(),
    openExternal: vi.fn(),
  };
}

describe("native menu runtime", () => {
  it("routes browser and VibeSurfer commands to their existing actions", () => {
    const target = actions();

    expect(handleNativeMenuCommand("new-tab", target)).toBe(true);
    expect(handleNativeMenuCommand("back", target)).toBe(true);
    expect(handleNativeMenuCommand("next-tab", target)).toBe(true);
    expect(handleNativeMenuCommand("regenerate", target)).toBe(true);
    expect(handleNativeMenuCommand("open-generation-settings", target)).toBe(true);
    expect(handleNativeMenuCommand("vertical-tabs", target)).toBe(true);

    expect(target.newTab).toHaveBeenCalledOnce();
    expect(target.go).toHaveBeenCalledWith(-1);
    expect(target.switchTab).toHaveBeenCalledWith(1);
    expect(target.reload).toHaveBeenCalledOnce();
    expect(target.openSettings).toHaveBeenCalledWith("generation");
    expect(target.setTabLayout).toHaveBeenCalledWith("vertical");
  });

  it("rejects unknown native payloads", () => {
    const target = actions();

    expect(isNativeMenuCommand("javascript:alert(1)")).toBe(false);
    expect(handleNativeMenuCommand({ command: "new-tab" }, target)).toBe(false);
    expect(target.newTab).not.toHaveBeenCalled();
  });
});
