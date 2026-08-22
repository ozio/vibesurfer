import assert from "node:assert/strict";
import { test } from "vitest";
import {
  isSameVirtualDocument,
  looksLikeUrl,
  normalizeVirtualUrl,
  resolveNavigation,
  resolveRealNavigation,
  resolveVirtualLink,
} from "../src/lib/navigation";

test("HTTP(S) and domain inputs normalize to virtual generated navigation", () => {
  const explicit = resolveNavigation("HTTP://WWW.YANDEX.RU:80/news?q=one#top", "codex:auto");
  assert.equal(explicit.kind, "generated");
  assert.equal(explicit.location, "http://www.yandex.ru/news?q=one#top");
  assert.equal(explicit.prompt, undefined);
  assert.equal(explicit.requiresGeneration, true);

  const domain = resolveNavigation("example.com", "provider:custom");
  assert.equal(domain.kind, "generated");
  assert.equal(domain.location, "https://example.com/");
  assert.equal(domain.favicon, "◆");
});

test("real-web navigation is explicit and limited to HTTP(S)", () => {
  const target = resolveRealNavigation("example.com/docs");
  assert.equal(target.kind, "remote");
  assert.equal(target.location, "https://example.com/docs");
  assert.equal(target.requiresGeneration, false);
  assert.throws(() => resolveRealNavigation("javascript:alert(1)"), /HTTP\(S\)/);
});

test("relative virtual links resolve against the current generated page", () => {
  const target = resolveNavigation("../news?day=today", "codex:auto", {
    baseUrl: "https://example.com/account/profile",
  });
  assert.equal(target.location, "https://example.com/news?day=today");
  assert.equal(target.requiresGeneration, true);
  assert.equal(
    resolveNavigation("latest", "codex:auto", { baseUrl: "https://example.com/news/" }).location,
    "https://example.com/news/latest",
  );
  assert.deepEqual(resolveVirtualLink("/help#faq", "https://example.com/account"), {
    url: "https://example.com/help#faq",
    origin: "https://example.com",
    pathname: "/help",
    search: "",
    hash: "#faq",
  });
});

test("same-document and hash navigation do not require generation", () => {
  const hash = resolveNavigation("#pricing", "codex:auto", {
    baseUrl: "https://example.com/product?plan=pro",
  });
  assert.equal(hash.location, "https://example.com/product?plan=pro#pricing");
  assert.equal(hash.requiresGeneration, false);
  assert.equal(
    isSameVirtualDocument("https://example.com/product#one", "https://example.com/product#two"),
    true,
  );
});

test("unsafe and credential-bearing schemes are never treated as navigable URLs", () => {
  assert.equal(looksLikeUrl("javascript:alert(1)"), false);
  assert.equal(normalizeVirtualUrl("https://user:secret@example.com"), undefined);
  const target = resolveNavigation("javascript:alert(1)", "codex:auto");
  assert.equal(target.kind, "generated");
  assert.match(target.location, /^vibe:\/\/generated\//);
});

test("repairs quote escaping wrapped around generated navigation URLs", () => {
  assert.equal(
    normalizeVirtualUrl(String.raw`https://wildberries.ru/%22/catalog/0/detail.aspx?cardId=845121\%22`)?.url,
    "https://wildberries.ru/catalog/0/detail.aspx?cardId=845121",
  );
  assert.equal(
    resolveNavigation(String.raw`\"/catalog/0/detail.aspx?cardId=845121\"`, "codex:auto", {
      baseUrl: "https://wildberries.ru/search",
    }).location,
    "https://wildberries.ru/catalog/0/detail.aspx?cardId=845121",
  );
  assert.equal(
    normalizeVirtualUrl("https://example.com/search?q=%22sale%22")?.url,
    "https://example.com/search?q=%22sale%22",
  );
});

test("generation debug is a host-owned vibe page and never starts generation", () => {
  const target = resolveNavigation("vibe://generation-debug", "codex:auto");
  assert.equal(target.kind, "generation-debug");
  assert.equal(target.location, "vibe://generation-debug");
  assert.equal(target.requiresGeneration, false);
});
