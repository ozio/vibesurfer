import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

import { ModelPicker } from "../src/components/chrome/ModelPicker";
import { MODELS } from "../src/data/catalog";

const props = {
  models: MODELS,
  activeModelId: "mock:preview",
  activeModelName: "Vibe Preview",
  onSelect: vi.fn(),
  onManageModels: vi.fn(),
};

describe("ModelPicker", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows a useful empty state and resets the query when reopened", async () => {
    render(<ModelPicker {...props} />);
    const trigger = screen.getByRole("button", { name: "Model: Vibe Preview" });

    fireEvent.click(trigger);
    const search = await screen.findByRole("combobox", { name: "Search models" });
    fireEvent.change(search, { target: { value: "zzzz-no-model" } });
    expect(screen.getByRole("status")).toHaveTextContent("No models found");

    fireEvent.keyDown(search, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "Search models" })).not.toBeInTheDocument());
    fireEvent.click(trigger);
    expect(await screen.findByRole("combobox", { name: "Search models" })).toHaveValue("");
  });

  it("moves focus into options with ArrowDown and restores the trigger on Escape", async () => {
    render(<ModelPicker {...props} />);
    const trigger = screen.getByRole("button", { name: "Model: Vibe Preview" });

    fireEvent.click(trigger);
    const search = await screen.findByRole("combobox", { name: "Search models" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[0]).toHaveFocus();

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
