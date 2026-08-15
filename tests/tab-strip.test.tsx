import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Tooltip } from "radix-ui";
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

import { TabStrip } from "../src/components/chrome/TabStrip";
import { VerticalSidebar } from "../src/components/content/VerticalSidebar";
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
const scrollIntoView = vi.fn();

describe("TabStrip", () => {
  beforeEach(() => {
    memoryStorage.clear();
    useBrowserStore.setState(initialState, true);
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
  });

  afterEach(() => {
    cleanup();
    scrollIntoView.mockReset();
    useBrowserStore.setState(initialState, true);
  });

  it("keeps the active horizontal tab visible after activation, insertion, and reorder", () => {
    renderTabStrip();

    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest", inline: "nearest" });
    expect(scrollIntoView.mock.contexts.at(-1)).toHaveAttribute("aria-label", "New tab");

    act(() => useBrowserStore.getState().activateTab("quiet-interface"));
    expect(scrollIntoView.mock.contexts.at(-1)).toHaveAttribute(
      "aria-label",
      "A quiet interface for ideas",
    );

    act(() => useBrowserStore.getState().addTab());
    expect(scrollIntoView.mock.contexts.at(-1)).toHaveAttribute("aria-label", "New tab");

    const callsBeforeReorder = scrollIntoView.mock.calls.length;
    act(() => useBrowserStore.getState().reorderTabs("welcome", "quiet-interface"));
    expect(scrollIntoView).toHaveBeenCalledTimes(callsBeforeReorder + 1);
  });

  it("keeps the new-tab action outside the scrolling tab list", () => {
    const { container } = renderTabStrip();
    const newTabButton = screen.getByRole("button", { name: "New tab" });

    expect(newTabButton.closest(".tab-strip__items")).toBeNull();
    expect(container.querySelector(".tab-strip")?.lastElementChild).toBe(newTabButton);
  });

  it("adapts vertical tabs to a compact two-line list", () => {
    const { container } = renderTabStrip("vertical");

    expect(container.querySelectorAll(".browser-tab--vertical .browser-tab__meta")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "New tab" })).toHaveTextContent("New tab");
    expect(screen.queryByRole("button", { name: "Scroll tabs left" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Scroll tabs right" })).not.toBeInTheDocument();
  });

  it("uses the vertical sidebar header for tab count instead of a fake collapse action", () => {
    render(
      <Tooltip.Provider>
        <VerticalSidebar />
      </Tooltip.Provider>,
    );

    expect(screen.getByLabelText("2 open tabs")).toHaveTextContent("2");
    expect(screen.queryByRole("button", { name: "Collapse sidebar" })).not.toBeInTheDocument();
  });

  it("shows pinned overflow controls and updates their edge states", () => {
    const { container } = renderTabStrip();
    const items = container.querySelector<HTMLElement>(".tab-strip__items")!;
    Object.defineProperties(items, {
      clientWidth: { configurable: true, value: 200 },
      scrollLeft: { configurable: true, value: 0, writable: true },
      scrollWidth: { configurable: true, value: 600 },
    });

    act(() => fireEvent.scroll(items));
    expect(screen.getByRole("button", { name: "Scroll tabs left" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Scroll tabs right" })).toBeEnabled();

    items.scrollLeft = 400;
    act(() => fireEvent.scroll(items));
    expect(screen.getByRole("button", { name: "Scroll tabs left" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Scroll tabs right" })).toBeDisabled();
  });

  it("opens native tab commands and inserts a new tab immediately to the right", async () => {
    renderTabStrip();
    const sourceTab = screen.getByRole("tab", { name: "A quiet interface for ideas" });

    fireEvent.contextMenu(sourceTab);
    const newTabToRight = await screen.findByRole("menuitem", { name: "New tab to the right" });
    expect(screen.getByRole("menuitem", { name: "Reload" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Close" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Close other tabs" })).toBeVisible();

    fireEvent.click(newTabToRight);
    const state = useBrowserStore.getState();
    const sourceIndex = state.tabs.findIndex((tab) => tab.id === "quiet-interface");
    expect(state.tabs[sourceIndex + 1]?.id).toBe(state.activeTabId);
  });
});

function renderTabStrip(orientation: "horizontal" | "vertical" = "horizontal") {
  return render(
    <Tooltip.Provider>
      <TabStrip orientation={orientation} />
    </Tooltip.Provider>,
  );
}
