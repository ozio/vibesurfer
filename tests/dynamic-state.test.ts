import { describe, expect, it } from "vitest";

import {
  applyStateAction,
  bindingsForSession,
  cartCount,
  cartTotal,
  createSiteSession,
  normalizeSiteSession,
  updateRegionSnapshots,
} from "../src/dynamic/state";

describe("trusted site-session reducers", () => {
  it("updates absolute quantities, count, and one-currency minor-unit totals", () => {
    let state = createSiteSession("p", "s");
    state = applyStateAction(state, "state:cart.add", {
      productId: ["sku-204"], quantity: ["2"], unitPriceMinor: ["1499"], currency: ["USD"],
    });
    state = applyStateAction(state, "state:cart.add", {
      productId: ["sku-204"], quantity: ["1"], unitPriceMinor: ["1499"], currency: ["USD"],
    });
    expect(cartCount(state)).toBe(3);
    expect(cartTotal(state)).toMatch(/44\.97/);
    state = applyStateAction(state, "state:cart.setQuantity", { productId: ["sku-204"], quantity: ["5"] });
    expect(cartCount(state)).toBe(5);
    state = applyStateAction(state, "state:cart.setQuantity", { productId: ["sku-204"], quantity: ["0"] });
    expect(cartCount(state)).toBe(0);
  });

  it("refuses mixed-currency totals and maintains wishlist and generic bindings", () => {
    let state = createSiteSession("p", "s");
    state = applyStateAction(state, "state:cart.add", { productId: ["usd"], quantity: ["1"], unitPriceMinor: ["100"], currency: ["USD"] });
    state = applyStateAction(state, "state:cart.add", { productId: ["eur"], quantity: ["1"], unitPriceMinor: ["100"], currency: ["EUR"] });
    expect(cartTotal(state)).toBe("—");
    state = applyStateAction(state, "state:wishlist.toggle", { productId: ["usd"] });
    state = applyStateAction(state, "state:value.set", { key: ["delivery.note"], value: ["Leave by the door"] });
    expect(bindingsForSession(state, ["wishlist.count", "value.delivery.note"])).toEqual({
      "wishlist.count": "1",
      "value.delivery.note": "Leave by the door",
    });
  });

  it("persists model state separately from identity and ignores stale snapshots", () => {
    const initial = createSiteSession("p", "s");
    const first = updateRegionSnapshots(initial, "https://example.com/chat", [{ regionId: "thread", html: "<p>one</p>", revision: 1 }], { cursor: 1 });
    const stale = updateRegionSnapshots(first, "https://example.com/chat", [{ regionId: "thread", html: "<p>stale</p>", revision: 1 }]);
    const restored = normalizeSiteSession(JSON.parse(JSON.stringify(stale)), "p", "s");
    expect(restored.regionSnapshots["https://example.com/chat"]?.thread?.html).toBe("<p>one</p>");
    expect(restored.modelState).toEqual({ cursor: 1 });
    expect(restored).not.toHaveProperty("establishedFacts");
  });
});
