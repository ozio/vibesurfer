import { z } from "zod";

import { ArtifactCapabilityUseSchema, CapabilityIdSchema } from "./capabilities/types.js";

import { IconSetSchema } from "./iconify/catalog.js";

export const PROTOCOL_VERSION = 1 as const;
export const GENERATION_PROMPT_VERSION = 16 as const;

export const DynamicModeSchema = z.enum(["off", "active", "always"]);
export type DynamicMode = z.infer<typeof DynamicModeSchema>;

export const DynamicRegionSchema = z.object({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/),
  refreshSeconds: z.number().int().min(60).max(3_600).optional(),
}).strict();
export type DynamicRegion = z.infer<typeof DynamicRegionSchema>;

export const DynamicActionSchema = z.object({
  action: z.string().regex(/^(?:state:(?:cart\.add|cart\.remove|cart\.setQuantity|wishlist\.toggle|value\.set)|model:[a-z][a-z0-9.-]{0,63})$/),
  execution: z.enum(["state", "model"]),
  targets: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/)).max(16),
}).strict().superRefine((value, context) => {
  if (!value.action.startsWith(`${value.execution}:`)) {
    context.addIssue({ code: "custom", path: ["execution"], message: "Dynamic action execution must match its namespace." });
  }
  if (new Set(value.targets).size !== value.targets.length) {
    context.addIssue({ code: "custom", path: ["targets"], message: "Dynamic action targets must be unique." });
  }
});
export type DynamicAction = z.infer<typeof DynamicActionSchema>;

export const DynamicManifestSchema = z.object({
  version: z.literal(1),
  regions: z.array(DynamicRegionSchema).max(16),
  actions: z.array(DynamicActionSchema).max(32),
  bindings: z.array(z.string().max(80)).max(64),
  localTabs: z.boolean().default(false),
}).strict();
export type DynamicManifest = z.infer<typeof DynamicManifestSchema>;

export const JsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string().max(16_384),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(JsonValueSchema).max(256),
  z.record(z.string().max(120), JsonValueSchema),
]));

export const DynamicRegionResultSchema = z.object({
  patches: z.array(z.object({
    regionId: z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/),
    html: z.string().max(64 * 1024),
  }).strict()).max(16),
  modelState: JsonValueSchema.optional(),
  announcement: z.string().max(500).optional(),
}).strict();
export type DynamicRegionResult = z.infer<typeof DynamicRegionResultSchema>;

export const ProviderKindSchema = z.enum([
  "mock",
  "openai",
  "anthropic",
  "google",
  "openai-compatible",
  "codex",
]);
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

export const BrowserThemeSchema = z.enum(["native", "sedative", "ie-classic", "cyberpunk"]);
export type BrowserTheme = z.infer<typeof BrowserThemeSchema>;

export const FaviconDescriptorSchema = z
  .object({
    kind: z.literal("glyph"),
    glyph: z.string().min(1).max(4),
    foreground: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    shape: z.enum(["circle", "rounded-square", "square"]),
  })
  .strict();
export type FaviconDescriptor = z.infer<typeof FaviconDescriptorSchema>;

export const RouteHintSchema = z
  .object({
    path: z.string().min(1).max(512),
    label: z.string().min(1).max(120),
    purpose: z.string().min(1).max(300),
  })
  .strict();
export type RouteHint = z.infer<typeof RouteHintSchema>;

export const SiteVisualLanguageSchema = z
  .object({
    palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).min(2).max(8),
    typography: z.string().min(1).max(200),
    density: z.enum(["compact", "comfortable", "spacious"]),
    radius: z.enum(["none", "subtle", "rounded", "pill"]),
    mood: z.string().min(1).max(200),
  })
  .strict();
export type SiteVisualLanguage = z.infer<typeof SiteVisualLanguageSchema>;

export const SiteWorldPatchSchema = z
  .object({
    name: z.string().min(1).max(160),
    purpose: z.string().min(1).max(500),
    audience: z.string().min(1).max(300),
    visualLanguage: SiteVisualLanguageSchema,
    establishedFacts: z.array(z.string().min(1).max(300)).max(24),
    routeHints: z.array(RouteHintSchema).min(4).max(30),
  })
  .strict();
export type SiteWorldPatch = z.infer<typeof SiteWorldPatchSchema>;

export const ProfilePromptSnapshotSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    vibe: z.string().max(1_000).default(""),
    prompt: z.string().max(20_000),
  })
  .strict();
export type ProfilePromptSnapshot = z.infer<typeof ProfilePromptSnapshotSchema>;

export const RolePaletteSchema = z
  .object({
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    surface: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    text: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    mutedText: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    accentText: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    border: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  })
  .strict();

export const FontSelectionSchema = z
  .object({
    body: z.string().min(1).max(120),
    heading: z.string().min(1).max(120),
    mono: z.string().min(1).max(120).optional(),
  })
  .strict();

export const SiteIdentitySchema = SiteWorldPatchSchema.extend({
  classification: z.enum(["recognizable", "original"]),
  locale: z.string().min(1).max(80),
  era: z.string().min(1).max(120),
  palette: RolePaletteSchema,
  fonts: FontSelectionSchema,
  layoutSystem: z.string().min(1).max(300),
  favicon: FaviconDescriptorSchema,
}).strict();
export type SiteIdentity = z.infer<typeof SiteIdentitySchema>;

export const SiteWorldSchema = z.object({
  id: z.string().min(1).max(160),
  profileId: z.string().min(1).max(160),
  origin: z.string().url(),
  state: z.enum(["active", "archived"]),
  revision: z.number().int().nonnegative(),
  promptSnapshot: ProfilePromptSnapshotSchema,
  identity: SiteIdentitySchema,
  pageSummaries: z.array(z.lazy(() => PageSummarySchema)).max(100).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archivedAt: z.string().datetime().optional(),
}).strict();
export type SiteWorld = z.infer<typeof SiteWorldSchema>;

export const PageSummarySchema = z
  .object({
    artifactId: z.string().min(1).max(160),
    url: z.string().url(),
    title: z.string().min(1).max(240),
    purpose: z.string().min(1).max(500),
    factsIntroduced: z.array(z.string().min(1).max(300)).max(16),
    outboundRoutes: z.array(z.string().min(1).max(512)).max(40),
  })
  .strict();
export type PageSummary = z.infer<typeof PageSummarySchema>;

export const NavigationIntentSchema = z
  .object({
    kind: z.enum(["address", "link", "form", "regenerate"]),
    disposition: z.enum(["current", "background-tab", "foreground-tab"]),
    anchorText: z.string().max(300).default(""),
    ariaLabel: z.string().max(300).default(""),
    linkContext: z.string().max(1_500).default(""),
    surroundingText: z.string().max(1_500).default(""),
    sourceUrl: z.string().url().optional(),
    formFields: z.record(z.string(), z.string().max(2_000)).optional(),
  })
  .strict();
export type NavigationIntent = z.infer<typeof NavigationIntentSchema>;

export const ImageSettingsSchema = z
  .object({
    mode: z.enum(["off", "local", "tag-placeholder"]).default("tag-placeholder"),
    fetchExternal: z.boolean().default(true),
    safeContent: z.boolean().default(true),
  })
  .strict();
export type ImageSettings = z.infer<typeof ImageSettingsSchema>;

export const GenerationSettingsSchema = z
  .object({
    tailwindEnabled: z.boolean().default(true),
    tailwindVersion: z.string().min(1).max(40).default("4.3.3"),
    allowGeneratedScripts: z.boolean().default(false),
    motionEnabled: z.boolean().default(true),
    dynamicMode: DynamicModeSchema.default("active"),
    capabilities: z.object({
      audioSpeechEnabled: z.boolean().default(true),
      externalMediaEnabled: z.boolean().default(false),
      experimentalEnabled: z.boolean().default(false),
    }).strict().default({
      audioSpeechEnabled: true,
      externalMediaEnabled: false,
      experimentalEnabled: false,
    }),
    voice: z.object({
      engine: z.enum(["local", "system", "cloud"]).default("local"),
      provider: z.enum(["openai", "elevenlabs", "deepgram"]).default("openai"),
      model: z.string().max(120).default("kokoro-82m-q8"),
      voice: z.string().max(120).default("af_heart"),
      speed: z.number().min(0.6).max(1.5).default(1),
      musicEnabled: z.boolean().default(true),
    }).strict().default({ engine: "local", provider: "openai", model: "kokoro-82m-q8", voice: "af_heart", speed: 1, musicEnabled: true }),
    images: ImageSettingsSchema.default({
      mode: "tag-placeholder",
      fetchExternal: true,
      safeContent: true,
    }),
    maxOutputTokens: z.number().int().min(512).max(100_000).default(20_000),
    minInternalLinks: z.number().int().min(4).max(30).default(4),
    maxArtifactBytes: z.number().int().min(32_000).max(2_000_000).default(1_000_000),
  })
  .strict();
export type GenerationSettings = z.infer<typeof GenerationSettingsSchema>;

export const GenerationContextSchema = z
  .object({
    siteWorld: SiteWorldSchema.optional(),
    sourcePage: PageSummarySchema.optional(),
    relevantHistory: z.array(PageSummarySchema).max(8).default([]),
    navigationIntent: NavigationIntentSchema,
    parentArtifactId: z.string().min(1).max(160).optional(),
    identityStrategy: z.enum(["reuse", "create", "reimagine"]).default("reuse"),
  })
  .strict();
export type GenerationContext = z.infer<typeof GenerationContextSchema>;

export const ProviderReferenceSchema = z
  .object({
    connectionId: z.string().min(1).max(100),
    modelId: z.string().min(1).max(200),
    generationMode: z.enum(["directed", "compact"]).optional(),
    reasoningEffort: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
      .optional(),
    serviceTier: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
      .optional(),
  })
  .strict();
export type ProviderReference = z.infer<typeof ProviderReferenceSchema>;

export const PageDirectionSchema = z
  .object({
    siteClassification: z.enum(["recognizable", "original"]),
    locale: z.string().min(1).max(80),
    era: z.string().min(1).max(120),
    palette: RolePaletteSchema,
    fonts: FontSelectionSchema,
    favicon: FaviconDescriptorSchema,
    density: z.enum(["compact", "comfortable", "spacious"]),
    layout: z.string().min(1).max(300),
    composition: z.array(z.string().min(1).max(300)).min(1).max(16),
    sections: z
      .array(
        z
          .object({
            id: z.string().min(1).max(80),
            heading: z.string().min(1).max(180),
            goal: z.string().min(1).max(400),
            layout: z.string().min(1).max(240),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    iconSet: IconSetSchema.nullable(),
    imagery: z.array(z.string().min(1).max(200)).max(16),
    selectedCapabilities: z.array(CapabilityIdSchema).max(16),
    creativeRationale: z.string().min(1).max(1_500),
    implementationNotes: z.string().min(1).max(2_000),
  })
  .strict();
export type PageDirection = z.infer<typeof PageDirectionSchema>;

export const SiteAdditionsSchema = z
  .object({
    facts: z.array(z.string().min(1).max(300)).max(16),
    routes: z.array(RouteHintSchema).max(20),
  })
  .strict();

const DirectorBaseShape = {
  direction: PageDirectionSchema,
  additions: SiteAdditionsSchema,
};

export const NewSiteDirectorResultSchema = z
  .object({ ...DirectorBaseShape, identity: SiteIdentitySchema })
  .strict();
export const ExistingSiteDirectorResultSchema = z.object(DirectorBaseShape).strict();
export type DirectorResult = z.infer<typeof ExistingSiteDirectorResultSchema> & {
  identity?: SiteIdentity;
};

export const ApprovedPageBriefSchema = z
  .object({
    identity: SiteIdentitySchema,
    direction: PageDirectionSchema,
    additions: SiteAdditionsSchema,
    selectedCapabilityContracts: z.partialRecord(CapabilityIdSchema, z.string()),
  })
  .strict();
export type ApprovedPageBrief = z.infer<typeof ApprovedPageBriefSchema>;

export const PageResultSchema = z
  .object({
    meta: z
      .object({
        title: z.string().min(1).max(240),
        description: z.string().min(1).max(500),
        pageSummary: z.string().min(1).max(1_000),
      })
      .strict(),
    html: z.string().min(200).max(1_500_000),
  })
  .strict();
export type PageResult = z.infer<typeof PageResultSchema>;

export const TokenUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    requests: z.number().int().nonnegative(),
  })
  .strict();
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const ModelExchangeSchema = z
  .object({
    id: z.string().min(1).max(160),
    purpose: z.enum(["page-director", "page-builder", "region-builder"]),
    providerId: z.string().min(1).max(200),
    modelId: z.string().min(1).max(300),
    actualProviderKind: ProviderKindSchema,
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    durationMs: z.number().int().nonnegative(),
    systemPrompt: z.string().max(2_000_000),
    prompt: z.string().max(2_000_000),
    response: z.string().max(2_000_000),
    usage: TokenUsageSchema,
  })
  .strict();
export type ModelExchange = z.infer<typeof ModelExchangeSchema>;

export const ArtifactWarningSchema = z
  .object({
    code: z.string().min(1).max(80),
    message: z.string().min(1).max(500),
  })
  .strict();
export type ArtifactWarning = z.infer<typeof ArtifactWarningSchema>;

export const PageArtifactSchema = z
  .object({
    id: z.string(),
    url: z.string().url(),
    title: z.string(),
    description: z.string(),
    favicon: FaviconDescriptorSchema,
    html: z.string(),
    summary: z.string(),
    siteId: z.string(),
    parentArtifactId: z.string().optional(),
    generationId: z.string(),
    providerId: z.string(),
    modelId: z.string(),
    actualProviderKind: ProviderKindSchema,
    promptVersion: z.number().int(),
    settingsFingerprint: z.string(),
    allowGeneratedScripts: z.boolean(),
    createdAt: z.string().datetime(),
    usage: TokenUsageSchema,
    modelExchanges: z.array(ModelExchangeSchema).min(1).max(2),
    warnings: z.array(ArtifactWarningSchema),
    sitePatch: SiteWorldPatchSchema,
    payload: z.record(z.string(), z.unknown()),
    capabilityManifest: z.array(ArtifactCapabilityUseSchema).max(64).default([]),
    dynamicManifest: DynamicManifestSchema.optional(),
  })
  .strict();
export type PageArtifact = z.infer<typeof PageArtifactSchema>;

export const HtmlIssueSchema = z
  .object({
    severity: z.enum(["error", "warning"]),
    code: z.string(),
    message: z.string(),
  })
  .strict();
export type HtmlIssue = z.infer<typeof HtmlIssueSchema>;

export type GenerationPhase =
  | "queued"
  | "preparing-context"
  | "directing"
  | "generating"
  | "validating"
  | "compiling-styles"
  | "resolving-images"
  | "committing"
  | "completed";
