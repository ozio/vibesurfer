import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { createJSONStorage } from "zustand/middleware";
import { SettingsPage } from "../src/components/settings/SettingsPage";
import { GENERATION_CAPABILITY_OPTIONS } from "../src/generation/capability-settings";
import { useBrowserStore } from "../src/store/browser-store";

const initialState = useBrowserStore.getInitialState();
const memoryStorage = new Map<string, string>();
useBrowserStore.persist.setOptions({
  storage: createJSONStorage(() => ({
    getItem: (key) => memoryStorage.get(key) ?? null,
    setItem: (key, value) => void memoryStorage.set(key, value),
    removeItem: (key) => void memoryStorage.delete(key),
  })),
});

beforeEach(() => {
  memoryStorage.clear();
  useBrowserStore.setState(initialState, true);
});
afterEach(cleanup);

function renderProfiles() {
  render(
    <MemoryRouter initialEntries={["/settings/profiles"]}>
      <Routes><Route path="/settings/:section" element={<SettingsPage />} /></Routes>
    </MemoryRouter>,
  );
}

function renderGeneration() {
  render(
    <MemoryRouter initialEntries={["/settings/generation"]}>
      <Routes><Route path="/settings/:section" element={<SettingsPage />} /></Routes>
    </MemoryRouter>,
  );
}

describe("profile settings", () => {
  it("treats presets as draft choices and creates only from the explicit button", () => {
    renderProfiles();
    const before = useBrowserStore.getState().profiles.length;
    fireEvent.click(screen.getByRole("radio", { name: /Quiet Web/i }));
    expect(useBrowserStore.getState().profiles).toHaveLength(before);

    fireEvent.click(screen.getByRole("button", { name: "Create profile" }));
    const state = useBrowserStore.getState();
    expect(state.profiles).toHaveLength(before + 1);
    expect(state.profiles.find((profile) => profile.id === state.activeProfileId)?.name).toBe("Quiet Web");
    expect(state.tabs.find((tab) => tab.id === state.activeTabId)).toMatchObject({
      kind: "settings",
      location: "vibe://settings/profiles",
    });
  });

  it("keeps appearance controls in Profiles instead of a separate section", () => {
    renderProfiles();
    expect(screen.queryByRole("link", { name: "Appearance" })).not.toBeInTheDocument();
    expect(screen.getByText("Interface animations")).toBeInTheDocument();
    expect(screen.getByText("Vibe", { selector: "h2" })).toBeInTheDocument();
    expect(screen.getAllByText("Advanced world rules")).toHaveLength(2);
  });
});

describe("generation settings", () => {
  it("toggles every optional capability independently", () => {
    renderGeneration();
    for (const option of GENERATION_CAPABILITY_OPTIONS) {
      const toggle = screen.getByRole("switch", { name: option.title });
      expect(toggle, option.id).toBeChecked();
      fireEvent.click(toggle);
      const disabled = useBrowserStore.getState().generationSettings.capabilities.enabled;
      expect(disabled[option.id], option.id).toBe(false);
      for (const other of GENERATION_CAPABILITY_OPTIONS) {
        if (other.id !== option.id) expect(disabled[other.id], `${option.id} changed ${other.id}`).toBe(true);
      }
      fireEvent.click(toggle);
      expect(useBrowserStore.getState().generationSettings.capabilities.enabled[option.id], option.id).toBe(true);
    }
  });

  it("keeps images, icons, Tailwind, scripts, and dynamic regions as separate controls", () => {
    renderGeneration();
    fireEvent.click(screen.getByRole("switch", { name: "Use LoremFlickr images" }));
    expect(useBrowserStore.getState().generationSettings.images.enabled).toBe(false);
    expect(useBrowserStore.getState().generationSettings.capabilities.iconsEnabled).toBe(true);

    fireEvent.click(screen.getByRole("switch", { name: "Icon library" }));
    expect(useBrowserStore.getState().generationSettings.capabilities.iconsEnabled).toBe(false);
    expect(useBrowserStore.getState().generationSettings.style.tailwindEnabled).toBe(true);

    fireEvent.click(screen.getByRole("switch", { name: "Compile Tailwind utilities" }));
    fireEvent.click(screen.getByRole("switch", { name: "Allow generated JavaScript" }));
    expect(useBrowserStore.getState().generationSettings.style).toMatchObject({ tailwindEnabled: false, allowGeneratedScripts: true });

    const dynamicControl = screen.getByLabelText("Dynamic update mode");
    fireEvent.click(within(dynamicControl).getByRole("radio", { name: "Off" }));
    expect(useBrowserStore.getState().generationSettings.dynamicMode).toBe("off");
  });
});
