export type Platform = "macos" | "windows" | "linux";
export type ThemeId = "native" | "sedative" | "ie-classic" | "cyberpunk";
export type ColorScheme = "system" | "light" | "dark";
export type TabLayout = "horizontal" | "vertical";
export type Density = "comfortable" | "compact";
export type TabKind = "new-tab" | "remote" | "generated" | "settings" | "history";
export type LoadState = "idle" | "loading" | "error";
export type NavigationDisposition = "current" | "foreground-tab" | "background-tab";
export type NavigationTrigger =
  | "address-bar"
  | "link"
  | "form"
  | "history"
  | "reload"
  | "regenerate"
  | "session-restore";

export interface VirtualLocation {
  url: string;
  origin: string;
  pathname: string;
  search: string;
  hash: string;
}

export interface TabOpenerContext {
  tabId: string;
  artifactId?: string;
}

export interface NavigationIntent {
  trigger: NavigationTrigger;
  disposition: NavigationDisposition;
  requestedUrl: string;
  sourceTabId?: string;
  sourceArtifactId?: string;
  linkText?: string;
  ariaLabel?: string;
  surroundingText?: string;
  formFields?: Record<string, string>;
}

export interface HistoryEntry {
  id: string;
  location: string;
  title: string;
  kind: TabKind;
  prompt?: string;
  favicon?: FaviconSource;
  virtualLocation?: VirtualLocation;
  artifactId?: string;
  generationJobId?: string;
  siteWorldId?: string;
  archivedSiteWorldId?: string;
}

export interface BrowserTab {
  id: string;
  title: string;
  location: string;
  favicon?: FaviconSource;
  kind: TabKind;
  prompt?: string;
  virtualLocation?: VirtualLocation;
  artifactId?: string;
  fallbackArtifactId?: string;
  generationJobId?: string;
  siteWorldId?: string;
  archivedSiteWorldId?: string;
  luckyJobId?: string;
  opener?: TabOpenerContext;
  loadState: LoadState;
  reloadKey: number;
  history: HistoryEntry[];
  historyIndex: number;
  generatedWith?: string;
  hasUnseenUpdate?: boolean;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  requests?: number;
}

export interface ModelExchange {
  id: string;
  purpose: "page-director" | "page-builder";
  providerId: string;
  modelId: string;
  actualProviderKind: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  systemPrompt: string;
  prompt: string;
  response: string;
  usage: TokenUsage;
}

export interface GlyphFavicon {
  kind: "glyph";
  glyph: string;
  foreground: string;
  background: string;
  shape: "circle" | "rounded-square" | "square";
}

export interface ImageFavicon {
  kind: "image";
  src: string;
  mimeType?: string;
}

export type FaviconDescriptor = GlyphFavicon | ImageFavicon;
export type FaviconSource = string | FaviconDescriptor;

export interface ArtifactWarning {
  code: string;
  message: string;
}

export interface ArtifactSitePatch {
  name: string;
  purpose: string;
  audience: string;
  visualLanguage: {
    palette: string[];
    typography: string;
    density?: "compact" | "comfortable" | "spacious";
    radius?: "none" | "subtle" | "rounded" | "pill";
    mood?: string;
    layout?: string;
    tone?: string;
  };
  establishedFacts: string[];
  routeHints: RouteHint[];
}

export interface SiteAdditions {
  facts: string[];
  routes: RouteHint[];
}

export interface PageArtifact {
  id: string;
  profileId?: string;
  url: string;
  title: string;
  html: string;
  summary: string;
  siteWorldId: string;
  generationJobId: string;
  modelId: string;
  promptVersion: number;
  settingsFingerprint: string;
  createdAt: string;
  providerId?: string;
  favicon?: FaviconDescriptor;
  faviconUrl?: string;
  parentArtifactId?: string;
  usage?: TokenUsage;
  modelExchanges?: ModelExchange[];
  warnings: ArtifactWarning[];
  allowGeneratedScripts?: boolean;
  sitePatch?: ArtifactSitePatch;
  siteIdentity?: SiteIdentity;
  siteAdditions?: SiteAdditions;
  pageDirection?: PageDirection;
  worldPromptSnapshot?: ProfilePromptSnapshot;
}

export interface SiteVisualLanguage {
  palette: string[];
  typography: string;
  layout: string;
  tone: string;
}

export interface RouteHint {
  path: string;
  label: string;
  purpose?: string;
}

export interface PageSummary {
  artifactId: string;
  url: string;
  title: string;
  purpose: string;
  factsIntroduced: string[];
  outboundRoutes: string[];
}

export interface ProfilePromptSnapshot {
  revision: number;
  prompt: string;
}

export interface RolePalette {
  background: string;
  surface: string;
  text: string;
  mutedText: string;
  accent: string;
  accentText: string;
  border: string;
}

export interface SiteIdentity extends ArtifactSitePatch {
  classification: "recognizable" | "original";
  locale: string;
  era: string;
  palette: RolePalette;
  fonts: { body: string; heading: string; mono?: string };
  layoutSystem: string;
  favicon: GlyphFavicon;
}

export interface PageDirection {
  siteClassification: "recognizable" | "original";
  locale: string;
  era: string;
  palette: RolePalette;
  fonts: { body: string; heading: string; mono?: string };
  favicon: GlyphFavicon;
  density: "compact" | "comfortable" | "spacious";
  layout: string;
  composition: string[];
  sections: Array<{ id: string; heading: string; goal: string; layout: string }>;
  iconSet: "lucide" | "carbon" | "ph" | "pepicons-pop" | "streamline-cyber" | "pixelarticons" | "fa" | "streamline-freehand" | "flat-color-icons" | "game-icons" | null;
  imagery: string[];
  selectedCapabilities: string[];
  creativeRationale: string;
  implementationNotes: string;
}

export interface SiteWorld {
  id: string;
  profileId: string;
  origin: string;
  state: "active" | "archived";
  promptSnapshot: ProfilePromptSnapshot;
  identity: SiteIdentity;
  pageSummaries: PageSummary[];
  archivedAt?: string;
  // Flattened compatibility fields are kept for the existing UI and migration.
  name: string;
  purpose: string;
  audience: string;
  visualLanguage: SiteVisualLanguage;
  informationArchitecture: RouteHint[];
  establishedFacts: string[];
  visitedPageSummaries: PageSummary[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export type GenerationJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type GenerationPhase =
  | "queued"
  | "preparing-context"
  | "directing"
  | "generating"
  | "validating"
  | "compiling-styles"
  | "resolving-images"
  | "committing"
  | "completed"
  | "failed"
  | "cancelled";

export type GenerationErrorCode =
  | "provider-not-configured"
  | "invalid-api-key"
  | "rate-limited"
  | "provider-unavailable"
  | "provider-route-required"
  | "timeout"
  | "cancelled"
  | "malformed-output"
  | "unsafe-output"
  | "style-compilation-failed"
  | "image-resolution-failed"
  | "worker-crashed"
  | "unknown";

export interface GenerationError {
  code: GenerationErrorCode;
  message: string;
  retryable: boolean;
}

export interface GenerationJob {
  id: string;
  purpose?: "page" | "lucky-urls";
  profileId: string;
  tabId: string;
  requestedUrl: string;
  normalizedUrl?: string;
  siteWorldId?: string;
  sourceArtifactId?: string;
  sourceHistoryEntryId?: string;
  artifactId?: string;
  providerId?: string;
  modelId: string;
  reasoningEffort?: string;
  serviceTier?: string;
  identityStrategy?: "reuse" | "create" | "reimagine";
  browserTheme: ThemeId;
  worldPromptSnapshot: ProfilePromptSnapshot;
  generationSettingsSnapshot: GenerationSettings;
  status: GenerationJobStatus;
  phase: GenerationPhase;
  navigationIntent: NavigationIntent;
  provisionalTitle?: string;
  provisionalFavicon?: FaviconSource;
  provisionalSummary?: string;
  previewHtml?: string;
  previewRevision?: number;
  error?: GenerationError;
  usage?: TokenUsage;
  createdAt: string;
  startedAt?: string;
  updatedAt: string;
}

export type BrowsingHistoryStatus = "loading" | "cached" | "completed" | "error";

export interface BrowsingHistoryEntry {
  id: string;
  profileId: string;
  url: string;
  title: string;
  status: BrowsingHistoryStatus;
  openedAt: string;
  updatedAt: string;
  favicon?: FaviconSource;
  artifactId?: string;
  generationJobId?: string;
  errorMessage?: string;
}

export type GenerationRuntimeEvent =
  | { type: "generation.started"; jobId: string }
  | { type: "generation.phase"; jobId: string; phase: GenerationPhase }
  | {
      type: "generation.metadata";
      jobId: string;
      metadata: { title?: string; favicon?: FaviconSource; summary?: string };
    }
  | { type: "generation.preview"; jobId: string; html: string; revision?: number }
  | { type: "generation.completed"; jobId: string; artifact: PageArtifact }
  | { type: "generation.failed"; jobId: string; error: GenerationError }
  | { type: "generation.cancelled"; jobId: string };

export interface ModelCapabilities {
  streaming: boolean;
  structuredOutput: boolean;
  reasoning: boolean;
  imageGeneration: boolean;
  maxOutputTokens?: number;
}

export type ProviderKind = "openai" | "anthropic" | "google" | "openai-compatible" | "codex" | "local";
export type ProviderConnectionStatus = "unknown" | "valid" | "invalid" | "unreachable";

export interface ProviderConnection {
  id: string;
  profileId: string;
  kind: ProviderKind;
  displayName: string;
  secretRef?: string;
  baseUrl?: string;
  enabled: boolean;
  status: ProviderConnectionStatus;
  maskedSecretSuffix?: string;
  modelIds: string[];
  generationMode?: "directed" | "compact";
  lastVerifiedAt?: string;
}

export interface CodexReasoningEffortOption {
  reasoningEffort: string;
  description: string;
}

export interface CodexServiceTierOption {
  id: string;
  name: string;
  description: string;
}

/** A model advertised by the signed-in Codex App Server session. */
export interface CodexModel {
  id: string;
  model: string;
  displayName: string;
  isDefault: boolean;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts: CodexReasoningEffortOption[];
  serviceTiers: CodexServiceTierOption[];
}

/** Persisted user choices for jobs routed through the ChatGPT Codex session. */
export interface CodexGenerationSelection {
  modelId?: string;
  reasoningEffort?: string;
  serviceTier?: string;
}

export type ImageProviderMode = "off" | "tag-placeholder" | "stock-api" | "generated" | "local-library";

export interface ArtifactStyleSettings {
  tailwindEnabled: boolean;
  tailwindVersion: string;
  allowArbitraryUtilities: boolean;
  customCssInstruction: string;
  allowGeneratedScripts: boolean;
  progressiveRendering: boolean;
}

export interface ImageGenerationSettings {
  enabled: boolean;
  provider: ImageProviderMode;
  safeContent: boolean;
  allowExternalRequests: boolean;
}

export interface GenerationPrivacySettings {
  includeNavigationHistory: boolean;
  sameSiteSummariesOnly: boolean;
  diagnosticsEnabled: boolean;
}

export interface GenerationSettings {
  promptVersion: number;
  maxOutputTokens: number;
  reuseCachedPages: boolean;
  style: ArtifactStyleSettings;
  images: ImageGenerationSettings;
  privacy: GenerationPrivacySettings;
}

export interface BrowserProfile {
  id: string;
  name: string;
  avatar: string;
  caption: string;
  chromeSkin: ThemeId;
  worldPrompt: ProfilePromptSnapshot;
  createdAt: string;
}

export interface ProfileWorkspace {
  tabs: BrowserTab[];
  activeTabId: string;
  activeModelId: string;
  preferences: BrowserPreferences;
  codexSelection: CodexGenerationSelection;
  generationSettings: GenerationSettings;
}

export interface ModelOption {
  id: string;
  name: string;
  provider: string;
  description: string;
  group: "recommended" | "codex" | "local" | "other";
  badge?: string;
  requiresCodex?: boolean;
  available: boolean;
  capabilities?: ModelCapabilities;
}

export interface BrowserPreferences {
  theme: ThemeId;
  colorScheme: ColorScheme;
  tabLayout: TabLayout;
  density: Density;
  animations: boolean;
  reopenSession: boolean;
  openBlockedExternally: boolean;
  sidebarWidth: number;
}

export interface CodexConnection {
  state: "checking" | "signed-out" | "starting" | "waiting-browser" | "signed-in" | "error";
  available: boolean;
  message: string;
  pendingModelId?: string;
}
