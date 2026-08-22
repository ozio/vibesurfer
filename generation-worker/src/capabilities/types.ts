import { z } from "zod";

export const CAPABILITY_IDS = [
  "semantic-navigation",
  "favicon-glyph",
  "tailwind-utilities",
  "inline-page-css",
  "image-intents",
  "local-dom-scripts",
  "pattern-background",
  "motion-presets",
  "data-chart",
  "diagram",
  "math",
  "code-highlight",
  "qr-code",
  "avatar",
  "synthetic-map",
  "micro-widgets",
  "carousel",
  "slideshow",
  "pseudo-video",
  "speech",
  "sound",
  "dynamic-regions",
  "external-media",
  "gifcities",
  "real-map",
] as const;

/**
 * Optional generation affordances that users can advertise to or withhold
 * from the Director independently. Structural contracts and integrations with
 * their own settings (images, Tailwind, scripts, dynamic regions) intentionally
 * stay outside this list.
 */
export const USER_CONFIGURABLE_CAPABILITY_IDS = [
  "pattern-background",
  "motion-presets",
  "data-chart",
  "diagram",
  "math",
  "code-highlight",
  "qr-code",
  "avatar",
  "synthetic-map",
  "micro-widgets",
  "carousel",
  "slideshow",
  "pseudo-video",
  "speech",
  "sound",
] as const satisfies readonly (typeof CAPABILITY_IDS[number])[];

export const CapabilityIdSchema = z.enum(CAPABILITY_IDS);
export type CapabilityId = z.infer<typeof CapabilityIdSchema>;
export type UserConfigurableCapabilityId = typeof USER_CONFIGURABLE_CAPABILITY_IDS[number];

export const CapabilityExecutionTargetSchema = z.enum(["compiler", "trusted-runtime", "host"]);
export type CapabilityExecutionTarget = z.infer<typeof CapabilityExecutionTargetSchema>;

export const ArtifactCapabilityUseSchema = z.object({
  id: CapabilityIdSchema,
  version: z.string().min(1).max(80),
  execution: CapabilityExecutionTargetSchema,
  instances: z.number().int().positive().max(256),
  noticeIds: z.array(z.string().min(1).max(160)).max(16),
}).strict();
export type ArtifactCapabilityUse = z.infer<typeof ArtifactCapabilityUseSchema>;

export interface ResolvedCapability {
  id: CapabilityId;
  builderContract: string;
  execution: CapabilityExecutionTarget;
  maxInstances: number;
  version: string;
  noticeIds: readonly string[];
}
