import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../lib/platform";
import type {
  ArtifactSitePatch,
  FaviconDescriptor,
  PageArtifact,
  ProviderConnection,
  ProviderConnectionStatus,
  ProviderKind,
  SiteWorld,
  TokenUsage,
} from "../types/browser";

export interface RuntimeStatus {
  protocolVersion: number;
  workerAvailable: boolean;
  workerDescription: string;
  activeJobs: number;
  storageReady: boolean;
}

interface ProviderConnectionRecord {
  id: string;
  profileId: string;
  kind: string;
  displayName: string;
  baseUrl?: string;
  secretRef: string;
  enabled: boolean;
  status: string;
  lastVerifiedAt?: string;
  payload: { modelIds?: string[] } & Record<string, unknown>;
}

interface ArtifactRecord {
  id: string;
  profileId: string;
  siteId: string;
  url: string;
  title: string;
  html: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface SiteWorldRecord {
  id: string;
  profileId: string;
  origin: string;
  state: "active" | "archived";
  revision: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  payload: Record<string, unknown>;
}

export interface SaveProviderInput {
  id: string;
  profileId: string;
  kind: Exclude<ProviderKind, "codex" | "local">;
  displayName: string;
  baseUrl?: string;
  apiKey: string;
  modelIds: string[];
}

export async function getRuntimeStatus(): Promise<RuntimeStatus | undefined> {
  if (!isTauri()) return undefined;
  return invoke<RuntimeStatus>("runtime_status");
}

export async function listProviderConnections(profileId: string): Promise<ProviderConnection[]> {
  if (!isTauri()) return [];
  const records = await invoke<ProviderConnectionRecord[]>("list_provider_connections", { profileId });
  return records.map(fromRecord);
}

export async function listPersistedArtifacts(profileId: string, limit = 32): Promise<PageArtifact[]> {
  if (!isTauri()) return [];
  const records = await invoke<ArtifactRecord[]>("list_artifacts", { profileId, limit });
  return records.flatMap((record) => {
    if (record.profileId !== profileId) return [];
    const artifact = fromArtifactRecord(record);
    return artifact ? [artifact] : [];
  });
}

export async function getPersistedArtifact(profileId: string, id: string): Promise<PageArtifact | undefined> {
  if (!isTauri()) return undefined;
  const record = await invoke<ArtifactRecord | null>("get_artifact", { id, profileId });
  if (!record || record.id !== id || record.profileId !== profileId) return undefined;
  return fromArtifactRecord(record);
}

export async function getCachedArtifact(profileId: string, siteWorldId: string, url: string): Promise<PageArtifact | undefined> {
  if (!isTauri()) return undefined;
  const record = await invoke<ArtifactRecord | null>("get_cached_artifact", { profileId, siteId: siteWorldId, url });
  if (!record || record.profileId !== profileId || record.siteId !== siteWorldId || record.url !== url) return undefined;
  return fromArtifactRecord(record);
}

export async function listPersistedSiteWorlds(profileId: string, limit = 500): Promise<SiteWorld[]> {
  if (!isTauri()) return [];
  const records = await invoke<SiteWorldRecord[]>("list_site_worlds", { profileId, limit });
  return records.flatMap((record) => {
    const siteWorld = fromSiteWorldRecord(record);
    return siteWorld ? [siteWorld] : [];
  });
}

export async function getPersistedSiteWorld(profileId: string, id: string): Promise<SiteWorld | undefined> {
  if (!isTauri()) return undefined;
  const record = await invoke<SiteWorldRecord | null>("get_site_world", { id, profileId });
  return record ? fromSiteWorldRecord(record) : undefined;
}

export async function savePersistedSiteWorld(profileId: string, siteWorld: SiteWorld): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("upsert_site_world", {
    siteWorld: toSiteWorldRecord(profileId, siteWorld),
  });
}

export async function deletePersistedSiteWorld(profileId: string, id: string): Promise<number> {
  if (!isTauri()) return 0;
  return invoke<number>("delete_site_world", { id, profileId });
}

export async function deletePersistedProfileSiteWorlds(profileId: string): Promise<number> {
  if (!isTauri()) return 0;
  return invoke<number>("delete_profile_site_worlds", { profileId });
}

export async function archivePersistedProfileSiteWorlds(profileId: string): Promise<number> {
  if (!isTauri()) return 0;
  return invoke<number>("archive_profile_site_worlds", { profileId });
}

export async function activatePersistedSiteWorld(profileId: string, id: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("activate_site_world", { profileId, id });
}

export async function deletePersistedProfileData(profileId: string): Promise<number> {
  if (!isTauri()) return 0;
  return invoke<number>("delete_profile_data", { profileId });
}

export async function saveProviderConnection(input: SaveProviderInput): Promise<ProviderConnection> {
  requireTauri();
  const secretRef = await invoke<string>("put_provider_secret", {
    profileId: input.profileId,
    connectionId: input.id,
    secret: input.apiKey,
  });
  const record: ProviderConnectionRecord = {
    id: input.id,
    profileId: input.profileId,
    kind: input.kind,
    displayName: input.displayName,
    baseUrl: input.baseUrl || undefined,
    secretRef,
    enabled: true,
    status: "unknown",
    payload: { modelIds: input.modelIds },
  };
  try {
    await invoke("upsert_provider_connection", { provider: record });
  } catch (error) {
    await invoke("delete_provider_secret", { secretRef }).catch(() => undefined);
    throw error;
  }
  return fromRecord(record);
}

export async function verifyProviderConnection(profileId: string, connection: ProviderConnection): Promise<ProviderConnection> {
  requireTauri();
  if (!connection.secretRef) throw new Error("This connection has no credential reference.");
  await invoke("verify_provider_connection", {
    request: {
      profileId,
      credentialRef: connection.secretRef,
      provider: {
        id: connection.id,
        connectionId: connection.id,
        kind: connection.kind,
        displayName: connection.displayName,
        baseUrl: connection.baseUrl,
        modelId: stripProviderPrefix(connection.modelIds[0]),
      },
    },
  });
  return { ...connection, status: "valid", lastVerifiedAt: new Date().toISOString() };
}

export async function removeProviderConnection(profileId: string, connection: ProviderConnection): Promise<void> {
  requireTauri();
  if (!connection.secretRef) throw new Error("This connection has no credential reference.");
  await invoke("delete_provider_connection", {
    id: connection.id,
    profileId,
    secretRef: connection.secretRef,
  });
}

function fromRecord(record: ProviderConnectionRecord): ProviderConnection {
  return {
    id: record.id,
    profileId: record.profileId,
    kind: normalizeProviderKind(record.kind),
    displayName: record.displayName,
    secretRef: record.secretRef,
    baseUrl: record.baseUrl,
    enabled: record.enabled,
    status: normalizeStatus(record.status),
    modelIds: Array.isArray(record.payload.modelIds)
      ? record.payload.modelIds.filter((model): model is string => typeof model === "string")
      : [],
    lastVerifiedAt: record.lastVerifiedAt,
  };
}

function fromArtifactRecord(record: ArtifactRecord): PageArtifact | undefined {
  if (!record.id || !record.url || !record.title || !record.html || !record.siteId) return undefined;
  const payload = isRecord(record.payload) ? record.payload : {};
  const generationJobId = stringValue(payload.generationId) ?? `persisted-${record.id}`;
  const modelId = stringValue(payload.modelId) ?? "unknown";
  return {
    id: record.id,
    profileId: record.profileId,
    url: record.url,
    title: record.title,
    html: record.html,
    summary: stringValue(payload.summary) ?? stringValue(payload.description) ?? "Generated page",
    siteWorldId: record.siteId,
    generationJobId,
    modelId,
    promptVersion: numberValue(payload.promptVersion) ?? 1,
    settingsFingerprint: stringValue(payload.settingsFingerprint) ?? "persisted",
    allowGeneratedScripts: payload.allowGeneratedScripts === true,
    createdAt: record.createdAt,
    providerId: stringValue(payload.providerId),
    favicon: isRecord(payload.favicon) ? payload.favicon as unknown as FaviconDescriptor : undefined,
    parentArtifactId: stringValue(payload.parentArtifactId),
    usage: isRecord(payload.usage) ? payload.usage as unknown as TokenUsage : undefined,
    modelExchanges: Array.isArray(payload.modelExchanges)
      ? payload.modelExchanges as unknown as PageArtifact["modelExchanges"]
      : undefined,
    warnings: Array.isArray(payload.warnings)
      ? payload.warnings.flatMap((warning) => isRecord(warning) && stringValue(warning.code) && stringValue(warning.message)
        ? [{ code: stringValue(warning.code)!, message: stringValue(warning.message)! }]
        : [])
      : [],
    sitePatch: isRecord(payload.sitePatch) ? payload.sitePatch as unknown as ArtifactSitePatch : undefined,
    siteIdentity: isRecord(payload.siteIdentity) ? payload.siteIdentity as unknown as PageArtifact["siteIdentity"] : undefined,
    siteAdditions: isRecord(payload.siteAdditions) ? payload.siteAdditions as unknown as PageArtifact["siteAdditions"] : undefined,
    pageDirection: isRecord(payload.pageDirection) ? payload.pageDirection as unknown as PageArtifact["pageDirection"] : undefined,
    worldPromptSnapshot: isRecord(payload.worldPromptSnapshot)
      ? payload.worldPromptSnapshot as unknown as PageArtifact["worldPromptSnapshot"]
      : undefined,
  };
}

export function toSiteWorldRecord(profileId: string, siteWorld: SiteWorld): SiteWorldRecord {
  return {
    id: siteWorld.id,
    profileId,
    origin: siteWorld.origin,
    state: siteWorld.state,
    revision: siteWorld.revision,
    createdAt: siteWorld.createdAt,
    updatedAt: siteWorld.updatedAt,
    archivedAt: siteWorld.archivedAt,
    payload: { ...siteWorld },
  };
}

export function fromSiteWorldRecord(record: SiteWorldRecord): SiteWorld | undefined {
  const id = stringValue(record.id);
  const profileId = stringValue(record.profileId);
  const origin = httpOrigin(record.origin);
  const revision = nonNegativeInteger(record.revision);
  const updatedAt = stringValue(record.updatedAt);
  if (!id || !profileId || !origin || revision === undefined || !updatedAt) return undefined;

  const payload = isRecord(record.payload) ? record.payload : {};
  const identity = isRecord(payload.identity) ? payload.identity as unknown as SiteWorld["identity"] : undefined;
  const visualLanguage = isRecord(payload.visualLanguage) ? payload.visualLanguage : {};
  const name = stringValue(payload.name) ?? new URL(origin).hostname.replace(/^www\./, "");
  const legacyPalette = stringArray(visualLanguage.palette, 32);
  const fallbackIdentity: SiteWorld["identity"] = {
    classification: "original",
    locale: "en",
    era: "contemporary",
    name,
    purpose: stringValue(payload.purpose) ?? "",
    audience: stringValue(payload.audience) ?? "",
    visualLanguage: {
      palette: legacyPalette.length >= 2 ? legacyPalette : ["#0f172a", "#2563eb", "#f8fafc"],
      typography: stringValue(visualLanguage.typography) ?? "Arimo Variable",
      density: "comfortable",
      radius: "rounded",
      mood: stringValue(visualLanguage.tone) ?? "clear",
    },
    establishedFacts: stringArray(payload.establishedFacts, 48),
    routeHints: routeHints(payload.informationArchitecture),
    palette: { background: "#f8fafc", surface: "#ffffff", text: "#0f172a", mutedText: "#64748b", accent: "#2563eb", accentText: "#ffffff", border: "#cbd5e1" },
    fonts: { body: "Arimo Variable", heading: "Arimo Variable" },
    layoutSystem: stringValue(visualLanguage.layout) ?? "Page-specific layout",
    favicon: { kind: "glyph", glyph: name.slice(0, 1).toUpperCase() || "•", foreground: "#ffffff", background: "#2563eb", shape: "rounded-square" },
  };
  const resolvedIdentity = identity ?? fallbackIdentity;
  const summaries = pageSummaries(payload.pageSummaries ?? payload.visitedPageSummaries);
  return {
    id,
    profileId,
    origin,
    state: record.state ?? (payload.state === "archived" ? "archived" : "active"),
    promptSnapshot: isRecord(payload.promptSnapshot)
      ? payload.promptSnapshot as unknown as SiteWorld["promptSnapshot"]
      : { revision: 0, prompt: "" },
    identity: resolvedIdentity,
    pageSummaries: summaries,
    archivedAt: record.archivedAt ?? stringValue(payload.archivedAt),
    name: resolvedIdentity.name,
    purpose: resolvedIdentity.purpose,
    audience: resolvedIdentity.audience,
    visualLanguage: {
      palette: stringArray(visualLanguage.palette, 32),
      typography: stringValue(visualLanguage.typography) ?? "",
      layout: stringValue(visualLanguage.layout) ?? "",
      tone: stringValue(visualLanguage.tone) ?? "",
    },
    informationArchitecture: routeHints(payload.informationArchitecture),
    establishedFacts: stringArray(payload.establishedFacts, 48),
    visitedPageSummaries: summaries,
    revision,
    createdAt: record.createdAt ?? stringValue(payload.createdAt) ?? updatedAt,
    updatedAt,
  };
}

function normalizeProviderKind(value: string): ProviderKind {
  if (
    value === "openai" ||
    value === "anthropic" ||
    value === "google" ||
    value === "openai-compatible" ||
    value === "codex" ||
    value === "local"
  ) {
    return value;
  }
  return "openai-compatible";
}

function normalizeStatus(value: string): ProviderConnectionStatus {
  return value === "valid" || value === "invalid" || value === "unreachable" ? value : "unknown";
}

function requireTauri(): void {
  if (!isTauri()) throw new Error("Provider keys can only be stored by the desktop app.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function httpOrigin(value: unknown): string | undefined {
  const raw = stringValue(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

function stringArray(value: unknown, limit: number): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const parsed = stringValue(item);
        return parsed ? [parsed] : [];
      }).slice(0, limit)
    : [];
}

function routeHints(value: unknown): SiteWorld["informationArchitecture"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const path = stringValue(item.path);
    const label = stringValue(item.label);
    if (!path || !label) return [];
    const purpose = stringValue(item.purpose);
    return [{ path, label, ...(purpose ? { purpose } : {}) }];
  }).slice(0, 128);
}

function pageSummaries(value: unknown): SiteWorld["visitedPageSummaries"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const artifactId = stringValue(item.artifactId);
    const url = stringValue(item.url);
    const title = stringValue(item.title);
    const purpose = stringValue(item.purpose);
    if (!artifactId || !url || !title || !purpose) return [];
    return [{
      artifactId,
      url,
      title,
      purpose,
      factsIntroduced: stringArray(item.factsIntroduced, 48),
      outboundRoutes: stringArray(item.outboundRoutes, 128),
    }];
  }).slice(-24);
}

function stripProviderPrefix(modelId: string | undefined): string | undefined {
  if (!modelId) return undefined;
  const separator = modelId.indexOf(":");
  return separator >= 0 ? modelId.slice(separator + 1) : modelId;
}
