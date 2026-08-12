import type { BrowserProfile, ModelOption, ProviderConnection } from "../types/browser";

export const MODELS: ModelOption[] = [
  {
    id: "mock:preview",
    name: "Vibe Preview",
    provider: "On this device",
    description: "Deterministic, network-free generator for setup and testing.",
    group: "recommended",
    badge: "Offline",
    available: true,
  },
  {
    id: "codex:chatgpt",
    name: "Codex (ChatGPT)",
    provider: "OpenAI",
    description: "Use your signed-in ChatGPT session, then choose a model, speed, and reasoning effort.",
    group: "codex",
    requiresCodex: true,
    available: true,
  },
  {
    id: "local:auto",
    name: "Local Auto",
    provider: "On this device",
    description: "Uses the first compatible local model when a runtime is connected.",
    group: "local",
    badge: "Offline",
    available: false,
  },
  {
    id: "provider:custom",
    name: "Custom provider",
    provider: "Bring your own",
    description: "Configure an OpenAI-compatible endpoint in Settings.",
    group: "other",
    available: false,
  },
];

export const PROFILES: BrowserProfile[] = [
  { id: "personal", name: "Personal", avatar: "O", caption: "Local browser workspace" },
];

export function modelCatalog(connections: ProviderConnection[], profileId?: string): ModelOption[] {
  const configured = connections.filter((connection) => !profileId || connection.profileId === profileId).flatMap((connection) =>
    connection.modelIds.map((id) => ({
      id,
      name: displayModelId(id),
      provider: connection.displayName,
      description: `${connection.kind} · bring your own key`,
      group: "other" as const,
      badge: "BYOK",
      available: connection.enabled,
    })),
  );
  const seen = new Set<string>();
  return [...MODELS, ...configured].filter((model) => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

function displayModelId(modelId: string) {
  const separator = modelId.indexOf(":");
  return separator >= 0 ? modelId.slice(separator + 1) : modelId;
}

export const THEME_LABELS = {
  native: { name: "System Native", caption: "Quiet, familiar, platform-aware" },
  sedative: { name: "Sedative", caption: "Soft pills and zero visual urgency" },
  "ie-classic": { name: "Internet Explorer", caption: "Beveled chrome and classic blue" },
  cyberpunk: { name: "Cyberdeck", caption: "Dense neon instrumentation" },
} as const;
