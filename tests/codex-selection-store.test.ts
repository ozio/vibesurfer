import assert from "node:assert/strict";
import { beforeEach, test } from "vitest";
import { createJSONStorage } from "zustand/middleware";
import { MODELS, modelCatalog } from "../src/data/catalog";
import {
  migrateBrowserState,
  useBrowserStore,
} from "../src/store/browser-store";
import type { CodexModel } from "../src/types/browser";

const initialState = useBrowserStore.getInitialState();
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

const codexModels: CodexModel[] = [
  {
    id: "gpt-default",
    model: "gpt-default-runtime",
    displayName: "GPT Default",
    isDefault: true,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "Faster" },
      { reasoningEffort: "medium", description: "Balanced" },
    ],
    serviceTiers: [],
  },
  {
    id: "gpt-reasoning",
    model: "gpt-reasoning-runtime",
    displayName: "GPT Reasoning",
    isDefault: false,
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: [
      { reasoningEffort: "high", description: "Thorough" },
      { reasoningEffort: "xhigh", description: "Most thorough" },
    ],
    serviceTiers: [{ id: "fast", name: "Fast", description: "Prioritized processing" }],
  },
];

beforeEach(() => {
  memoryStorage.clear();
  useBrowserStore.setState(initialState, true);
});

test("catalog exposes one selectable ChatGPT Codex provider option", () => {
  const codexOptions = modelCatalog([]).filter((model) => model.group === "codex");

  assert.equal(codexOptions.length, 1);
  assert.deepEqual(
    codexOptions.map(({ id, name, available }) => ({ id, name, available })),
    [{ id: "codex:chatgpt", name: "Codex (ChatGPT)", available: true }],
  );
  assert.equal(MODELS.some((model) => model.id === "codex:auto" || model.id === "codex:reasoning"), false);

  useBrowserStore.getState().setModel("codex:chatgpt");
  assert.equal(useBrowserStore.getState().activeModelId, "codex:chatgpt");
});

test("Codex choices resolve to a concrete immutable job snapshot", () => {
  const store = useBrowserStore.getState();
  store.setCodexModels(codexModels);
  assert.deepEqual(useBrowserStore.getState().codexSelection, {
    modelId: "gpt-default",
    reasoningEffort: "medium",
    serviceTier: undefined,
  });

  store.setModel("codex:chatgpt");
  store.patchCodexSelection({ modelId: "gpt-reasoning" });
  assert.deepEqual(useBrowserStore.getState().codexSelection, {
    modelId: "gpt-reasoning",
    reasoningEffort: "high",
    serviceTier: undefined,
  });
  store.patchCodexSelection({ reasoningEffort: "xhigh", serviceTier: "fast" });

  const jobId = store.navigate("welcome", "A compact project dashboard");
  assert.ok(jobId);
  const job = useBrowserStore.getState().generationJobs[jobId];
  assert.equal(job.modelId, "codex:gpt-reasoning-runtime");
  assert.equal(job.providerId, "codex");
  assert.equal(job.reasoningEffort, "xhigh");
  assert.equal(job.serviceTier, "fast");

  useBrowserStore.getState().patchCodexSelection({ modelId: "gpt-default" });
  assert.equal(useBrowserStore.getState().generationJobs[jobId].modelId, "codex:gpt-reasoning-runtime");
  assert.equal(useBrowserStore.getState().generationJobs[jobId].reasoningEffort, "xhigh");
  assert.equal(useBrowserStore.getState().generationJobs[jobId].serviceTier, "fast");
});

test("job provider follows the final per-mode model instead of the active model", () => {
  const store = useBrowserStore.getState();
  store.upsertProviderConnection({
    id: "anthropic-main",
    profileId: "personal",
    kind: "anthropic",
    displayName: "Anthropic",
    enabled: true,
    status: "valid",
    modelIds: ["anthropic:claude-test"],
  });
  store.patchGenerationSettings({ defaultModelByMode: { quick: "anthropic:claude-test" } });

  const jobId = store.navigate("welcome", "example.com");
  assert.ok(jobId);
  const job = useBrowserStore.getState().generationJobs[jobId];
  assert.equal(useBrowserStore.getState().activeModelId, "mock:preview");
  assert.equal(job.modelId, "anthropic:claude-test");
  assert.equal(job.providerId, "anthropic");
});

test("migration retains only valid persisted Codex selection fields and refreshes the catalog", () => {
  const migrated = migrateBrowserState({
    activeModelId: "codex:chatgpt",
    codexModels,
    codexSelection: {
      modelId: "  gpt-reasoning  ",
      reasoningEffort: 42,
      serviceTier: "   ",
    },
  }, 4);

  assert.equal(migrated.activeModelId, "codex:chatgpt");
  assert.deepEqual(migrated.codexModels, []);
  assert.deepEqual(migrated.codexSelection, {
    modelId: "gpt-reasoning",
    reasoningEffort: undefined,
    serviceTier: undefined,
  });
});
