import { describe, expect, it } from "vitest";
import { browserShortcutLabels, externalHttpUrl, nativeWindowCornerRadius } from "../src/lib/platform";

describe("external HTTP navigation", () => {
  it("accepts only credential-free HTTP(S) URLs", () => {
    expect(externalHttpUrl("https://example.com/docs?q=1#top")).toBe("https://example.com/docs?q=1#top");
    expect(externalHttpUrl("http://example.com")).toBe("http://example.com/");
    expect(externalHttpUrl("https://user:secret@example.com/private")).toBeUndefined();
    expect(externalHttpUrl("javascript:alert(1)")).toBeUndefined();
    expect(externalHttpUrl("file:///etc/passwd")).toBeUndefined();
    expect(externalHttpUrl("httpx://example.com")).toBeUndefined();
    expect(externalHttpUrl(" https://example.com")).toBeUndefined();
  });
});

describe("browser shortcut labels", () => {
  it("keeps native macOS shortcuts even when the visual theme imitates IE", () => {
    expect(browserShortcutLabels("macos", "ie-classic")).toMatchObject({
      focusAddress: "⌘L",
      newTab: "⌘T",
      openInNewTab: "⌥↵",
      settings: "⌘,",
      usesMacSymbols: true,
    });
  });

  it("keeps native macOS symbols in modern themes", () => {
    expect(browserShortcutLabels("macos", "native")).toMatchObject({
      focusAddress: "⌘L",
      newTab: "⌘T",
      openInNewTab: "⌥↵",
      settings: "⌘,",
      usesMacSymbols: true,
    });
  });
});

describe("native window theme shape", () => {
  it("uses square IE corners and the softest Sedative corners", () => {
    expect(nativeWindowCornerRadius("ie-classic")).toBe(0);
    expect(nativeWindowCornerRadius("cyberpunk")).toBe(4);
    expect(nativeWindowCornerRadius("native")).toBe(12);
    expect(nativeWindowCornerRadius("sedative")).toBe(28);
  });
});
