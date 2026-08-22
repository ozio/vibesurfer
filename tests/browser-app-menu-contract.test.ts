import { describe, expect, it } from "vitest";
import { NATIVE_BROWSER_COMMAND_IDS } from "../src/browser/browser-command-registry";
import { BROWSER_APP_MENU_COMMAND_IDS } from "../src/components/chrome/BrowserAppMenu";

describe("browser app menu command contract", () => {
  it("uses only command IDs also understood by the native application menu", () => {
    expect(BROWSER_APP_MENU_COMMAND_IDS.every((id) => NATIVE_BROWSER_COMMAND_IDS.includes(id))).toBe(true);
  });
});
