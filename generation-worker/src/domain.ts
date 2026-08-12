import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;
export const GENERATION_PROMPT_VERSION = 1 as const;

export const ProviderKindSchema = z.enum([
  "mock",
  "openai",
  "anthropic",
  "google",
  "openai-compatible",
  "codex",
]);
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

export const GenerationModeSchema = z.enum(["quick", "deep"]);
export type GenerationMode = z.infer<typeof GenerationModeSchema>;

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

export const SiteWorldSchema = SiteWorldPatchSchema.extend({
  id: z.string().min(1).max(160),
  origin: z.string().url(),
  revision: z.number().int().nonnegative(),
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
    surroundingText: z.string().max(1_500).default(""),
    sourceUrl: z.string().url().optional(),
    formFields: z.record(z.string(), z.string().max(2_000)).optional(),
  })
  .strict();
export type NavigationIntent = z.infer<typeof NavigationIntentSchema>;

export const ImageSettingsSchema = z
  .object({
    mode: z.enum(["off", "local", "tag-placeholder"]).default("local"),
    fetchExternal: z.boolean().default(false),
    safeContent: z.boolean().default(true),
  })
  .strict();
export type ImageSettings = z.infer<typeof ImageSettingsSchema>;

export const GenerationSettingsSchema = z
  .object({
    tailwindEnabled: z.boolean().default(true),
    tailwindVersion: z.string().min(1).max(40).default("4.3.3"),
    images: ImageSettingsSchema.default({
      mode: "local",
      fetchExternal: false,
      safeContent: true,
    }),
    autoRepair: z.boolean().default(true),
    maxRequests: z.number().int().min(1).max(4).default(4),
    maxOutputTokens: z.number().int().min(512).max(100_000).default(20_000),
    minInternalLinks: z.number().int().min(4).max(30).default(12),
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
  })
  .strict();
export type GenerationContext = z.infer<typeof GenerationContextSchema>;

export const ProviderReferenceSchema = z
  .object({
    connectionId: z.string().min(1).max(100),
    modelId: z.string().min(1).max(200),
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

export const PageResultSchema = z
  .object({
    meta: z
      .object({
        title: z.string().min(1).max(240),
        description: z.string().min(1).max(500),
        pageSummary: z.string().min(1).max(1_000),
        favicon: FaviconDescriptorSchema,
        sitePatch: SiteWorldPatchSchema,
      })
      .strict(),
    html: z.string().min(200).max(1_500_000),
  })
  .strict();
export type PageResult = z.infer<typeof PageResultSchema>;

export const SiteArchitectureSchema = z
  .object({
    sitePatch: SiteWorldPatchSchema,
    favicon: FaviconDescriptorSchema,
    designRationale: z.string().min(1).max(800),
  })
  .strict();
export type SiteArchitecture = z.infer<typeof SiteArchitectureSchema>;

export const PagePlanSchema = z
  .object({
    pagePurpose: z.string().min(1).max(500),
    title: z.string().min(1).max(240),
    sections: z
      .array(
        z
          .object({
            id: z.string().min(1).max(80),
            heading: z.string().min(1).max(180),
            goal: z.string().min(1).max(400),
            layout: z.string().min(1).max(200),
          })
          .strict(),
      )
      .min(3)
      .max(16),
    internalLinks: z.array(RouteHintSchema).min(12).max(30),
    imageIntents: z.array(z.string().min(1).max(200)).max(12),
    consistencyNotes: z.array(z.string().min(1).max(300)).max(16),
  })
  .strict();
export type PagePlan = z.infer<typeof PagePlanSchema>;

export const TokenUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    requests: z.number().int().nonnegative(),
  })
  .strict();
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

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
    mode: GenerationModeSchema,
    promptVersion: z.number().int(),
    settingsFingerprint: z.string(),
    createdAt: z.string().datetime(),
    usage: TokenUsageSchema,
    warnings: z.array(ArtifactWarningSchema),
    sitePatch: SiteWorldPatchSchema,
    payload: z.record(z.string(), z.unknown()),
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
  | "planning-site"
  | "planning-page"
  | "generating"
  | "validating"
  | "repairing"
  | "compiling-styles"
  | "resolving-images"
  | "committing"
  | "completed";
