import type { GenerateCommand } from "../src/protocol/types.js";

export function generationCommand(overrides: Partial<GenerateCommand> = {}): GenerateCommand {
  const base: GenerateCommand = {
    v: 1,
    type: "generate",
    requestId: "request-1",
    jobId: "job-1",
    url: "https://example.com/",
    mode: "quick",
    provider: { connectionId: "mock", modelId: "mock-v1" },
    editableInstruction: "Make the page calm and concise.",
    settings: {
      tailwindEnabled: false,
      tailwindVersion: "4.3.3",
      images: { mode: "local", fetchExternal: false, safeContent: true },
      autoRepair: true,
      maxRequests: 4,
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
        surroundingText: "",
      },
    },
  };
  return { ...base, ...overrides };
}
