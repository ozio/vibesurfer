import { describe, expect, test } from "vitest";
import {
  navigationDisposition,
  sameDocumentHashNavigation,
} from "../../src/artifacts/frame-navigation";

const leftClick = { button: 0, shiftKey: false, metaKey: false, ctrlKey: false };

describe("artifact frame navigation", () => {
  test("recognizes only same-document HTTP(S) fragments", () => {
    expect(sameDocumentHashNavigation("https://example.test/catalog?q=one", "#details")).toEqual({
      href: "https://example.test/catalog?q=one#details",
      hash: "#details",
    });
    expect(sameDocumentHashNavigation("https://example.test/catalog?q=one", "/catalog?q=two#details")).toBeUndefined();
    expect(sameDocumentHashNavigation("https://example.test/catalog?q=one", "https://other.test/catalog#details")).toBeUndefined();
    expect(sameDocumentHashNavigation("https://example.test/catalog?q=one", "javascript:alert(1)")).toBeUndefined();
  });

  test("maps hash modifiers and targets to browser tab dispositions", () => {
    expect(navigationDisposition(leftClick, "")).toBe("current");
    expect(navigationDisposition({ ...leftClick, button: 1 }, "")).toBe("background-tab");
    expect(navigationDisposition({ ...leftClick, ctrlKey: true }, "")).toBe("background-tab");
    expect(navigationDisposition({ ...leftClick, metaKey: true }, "")).toBe("background-tab");
    expect(navigationDisposition(leftClick, "_blank")).toBe("background-tab");
    expect(navigationDisposition({ ...leftClick, shiftKey: true }, "_blank")).toBe("foreground-tab");
  });
});
