import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJSONStorage } from "zustand/middleware";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
});

import { ModelControl } from "../src/components/chrome/ModelControl";
import { useBrowserStore } from "../src/store/browser-store";

const memoryStorage = new Map<string, string>();
useBrowserStore.persist.setOptions({
  storage: createJSONStorage(() => ({
    getItem: (key) => memoryStorage.get(key) ?? null,
    setItem: (key, value) => {
      memoryStorage.set(key, value);
    },
    removeItem: (key) => {
      memoryStorage.delete(key);
    },
  })),
});
const initialState = useBrowserStore.getInitialState();

describe("ModelControl", () => {
  beforeEach(() => {
    memoryStorage.clear();
    useBrowserStore.setState(initialState, true);
  });

  afterEach(() => {
    cleanup();
    useBrowserStore.setState(initialState, true);
  });

  it("shows a useful empty state and resets the query when reopened", async () => {
    render(<ModelControl />);
    const trigger = screen.getByRole("button", { name: "Model: Vibe Preview" });

    fireEvent.click(trigger);
    const search = await screen.findByRole("combobox", { name: "Search models" });
    fireEvent.change(search, { target: { value: "zzzz-no-model" } });
    expect(screen.getByRole("status")).toHaveTextContent("No models match your search.");

    fireEvent.keyDown(search, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "Search models" })).not.toBeInTheDocument());
    fireEvent.click(trigger);
    expect(await screen.findByRole("combobox", { name: "Search models" })).toHaveValue("");
  });

  it("moves focus into options with ArrowDown and restores the trigger on Escape", async () => {
    render(<ModelControl />);
    const trigger = screen.getByRole("button", { name: "Model: Vibe Preview" });

    fireEvent.click(trigger);
    const search = await screen.findByRole("combobox", { name: "Search models" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[0]).toHaveFocus();

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
