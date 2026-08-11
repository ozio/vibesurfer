import { describe, expect, it } from "vitest";
import { externalHttpUrl } from "../src/lib/platform";

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
