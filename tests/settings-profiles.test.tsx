import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SettingsPage } from "../src/components/settings/SettingsPage";
import { useBrowserStore } from "../src/store/browser-store";

const initialState = useBrowserStore.getInitialState();

beforeEach(() => useBrowserStore.setState(initialState, true));
afterEach(cleanup);

function renderProfiles() {
  render(
    <MemoryRouter initialEntries={["/settings/profiles"]}>
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
