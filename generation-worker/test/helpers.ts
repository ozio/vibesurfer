import type { GenerateCommand } from "../src/protocol/types.js";

export function generationCommand(overrides: Partial<GenerateCommand> = {}): GenerateCommand {
  const base: GenerateCommand = {
    v: 1,
    type: "generate",
    requestId: "request-1",
    jobId: "job-1",
    profileId: "personal",
    siteWorldId: "site-example-1",
    url: "https://example.com/",
    browserTheme: "native",
    provider: { connectionId: "mock", modelId: "mock-v1" },
    worldPromptSnapshot: { revision: 1, vibe: "Quiet archival web", prompt: "Make this world calm and concise." },
    settings: {
      tailwindEnabled: false,
      tailwindVersion: "4.3.3",
      allowGeneratedScripts: false,
      motionEnabled: true,
      images: { mode: "local", fetchExternal: false, safeContent: true },
      maxOutputTokens: 20_000,
      minInternalLinks: 12,
      maxArtifactBytes: 1_000_000,
    },
    context: {
      relevantHistory: [],
      navigationIntent: {
        kind: "address",
        disposition: "current",
        anchorText: "",
        ariaLabel: "",
        linkContext: "",
        surroundingText: "",
      },
      identityStrategy: "create",
    },
  };
  return { ...base, ...overrides };
}
