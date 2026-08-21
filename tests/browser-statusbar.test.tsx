// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrowserStatusBar } from "../src/components/chrome/BrowserStatusBar";
import type { PageArtifact } from "../src/types/browser";
import { useBrowserStore } from "../src/store/browser-store";

describe("BrowserStatusBar", () => {
  it("shows Hallunet, exposes hovered URLs, and opens the activity page", () => {
    render(
      <BrowserStatusBar
        location="https://example.com/"
        hoveredLink="https://example.com/next"
        profileName="Personal"
        modelName="GPT Test"
        artifact={artifact()}
      />,
    );

    expect(screen.getByText("Hallunet")).toBeInTheDocument();
    expect(screen.getAllByText("https://example.com/next").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: /1 req · in 120 · out 80/i })[0]);
    const state = useBrowserStore.getState();
    expect(state.tabs.find((tab) => tab.id === state.activeTabId)).toMatchObject({ kind: "activity", location: "vibe://activity?job=job-one" });
  });
});

function artifact(): PageArtifact {
  return {
    id: "artifact-one",
    url: "https://example.com/",
    title: "Example",
    html: "<!doctype html><title>Example</title>",
    summary: "Example",
    siteWorldId: "site-one",
    generationJobId: "job-one",
    modelId: "gpt-test",
    promptVersion: 10,
    settingsFingerprint: "test",
    createdAt: "2026-08-12T00:00:01.000Z",
    usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200, requests: 1 },
    warnings: [],
    modelExchanges: [{
      id: "exchange-one",
      purpose: "page-director",
      providerId: "openai",
      modelId: "gpt-test",
      actualProviderKind: "openai",
      startedAt: "2026-08-12T00:00:00.000Z",
      completedAt: "2026-08-12T00:00:01.000Z",
      durationMs: 1_000,
      systemPrompt: "system prompt contents",
      prompt: "request contents",
      response: "response contents",
      usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200, requests: 1 },
    }],
  };
}
