import { describe, expect, it } from "vitest";
import { searchPortal } from "../src/components/content/NewTabPage";

describe("new-tab themed search", () => {
  it("uses Google or Yandex in the native world based on locale", () => {
    expect(searchPortal("native", false).url("three byte")).toBe("https://www.google.com/search?q=three%20byte");
    expect(searchPortal("native", true).url("три байта")).toBe("https://yandex.ru/search/?text=%D1%82%D1%80%D0%B8%20%D0%B1%D0%B0%D0%B9%D1%82%D0%B0");
  });

  it("uses MSN or Rambler for the classic browser", () => {
    expect(searchPortal("ie-classic", false).url("metacode")).toContain("https://www.msn.com/search?q=");
    expect(searchPortal("ie-classic", true).url("метакод")).toContain("https://www.rambler.ru/search?query=");
  });

  it("keeps the cyberpunk query inside its fictional network", () => {
    expect(searchPortal("cyberpunk", false).url("citizen zero")).toBe("https://search.nexus.city/query?q=citizen%20zero");
  });
});
