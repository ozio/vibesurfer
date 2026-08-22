import {
  BROWSER_EXPERIENCE_REGISTRY,
  BROWSER_THEME_IDS,
  type ThemeId,
} from "../browser/browser-experience-registry";
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
  {
    id: "personal",
    name: "Personal",
    avatar: "O",
    caption: "Local browser workspace",
    chromeSkin: "native",
    worldPrompt: { revision: 0, vibe: "", prompt: "" },
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

export const PROFILE_PRESET_THEMES = {
  native: "native",
  quiet: "sedative",
  explorer: "ie-classic",
  cyberpunk: "cyberpunk",
} as const satisfies Record<string, ThemeId>;

export const PROFILE_PRESETS = Object.fromEntries(
  Object.entries(PROFILE_PRESET_THEMES).map(([presetId, chromeSkin]) => [
    presetId,
    { ...BROWSER_EXPERIENCE_REGISTRY[chromeSkin].generation.profilePreset, chromeSkin },
  ]),
) as Record<keyof typeof PROFILE_PRESET_THEMES, {
  name: string;
  avatar: string;
  chromeSkin: ThemeId;
  vibe: string;
  prompt: string;
}>;

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

export const THEME_LABELS = Object.fromEntries(
  BROWSER_THEME_IDS.map((theme) => [theme, {
    name: BROWSER_EXPERIENCE_REGISTRY[theme].chrome.settingsLabel,
    caption: BROWSER_EXPERIENCE_REGISTRY[theme].chrome.caption,
  }]),
) as Record<ThemeId, { name: string; caption: string }>;
