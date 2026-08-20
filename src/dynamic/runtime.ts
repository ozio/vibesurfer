import { Channel, invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

import type { ArtifactDynamicActionEvent, ArtifactDynamicRegionSnapshot } from "../artifacts/bridge-protocol";
import type { ArtifactFrameConnection } from "../artifacts/iframe-host";
import { getPersistedSiteSession, savePersistedSiteSession } from "../generation/host-api";
import { isTauri } from "../lib/platform";
import { useBrowserStore, type BrowserState } from "../store/browser-store";
import type {
  DynamicTabStatus,
  GenerationError,
  JsonValue,
  PageArtifact,
  SiteSessionState,
} from "../types/browser";
import {
  applyStateAction,
  bindingsForSession,
  canonicalPageUrl,
  createSiteSession,
  normalizeSiteSession,
  trustedStateForModel,
  updateRegionSnapshots,
} from "./state";
import {
  coalesceDynamicTargets,
  collectDueDynamicRegionIds,
  dynamicBackoffSeconds,
  hasDynamicJobCapacity,
  isDynamicTimerEligible,
  shouldCancelDynamicJob,
  shouldPauseDynamicRegion,
} from "./scheduler";

interface DynamicRuntimeStore {
  sessions: Record<string, SiteSessionState>;
  tabStatus: Record<string, DynamicTabStatus>;
  pagePaused: Record<string, boolean>;
}

export const useDynamicRuntimeStore = create<DynamicRuntimeStore>(() => ({ sessions: {}, tabStatus: {}, pagePaused: {} }));

interface FrameRegistration {
  tabId: string;
  artifact: PageArtifact;
  connection: ArtifactFrameConnection;
}

interface DynamicJob {
  id: string;
  tabId: string;
  artifactId: string;
  trigger: "action" | "timer" | "manual";
  requestId: string;
  targets: string[];
  baseRevisions: Record<string, number>;
  cancel: () => void;
  coalesced: Set<string>;
}

interface QueuedJob {
  tabId: string;
  artifact: PageArtifact;
  trigger: "action" | "timer" | "manual";
  requestId: string;
  action: string;
  targets: string[];
  fields: Record<string, string[]>;
  regions?: ArtifactDynamicRegionSnapshot[];
  coalescedTargets?: string[];
}

type DynamicHandleResult = "handled" | "restore-required" | "disabled";

const schedulerTickMs = 1_000;

class DynamicCoordinator {
  readonly #frames = new Map<string, FrameRegistration>();
  readonly #jobs = new Map<string, DynamicJob>();
  readonly #startingTabs = new Set<string>();
  readonly #queue: QueuedJob[] = [];
  readonly #sessionLoads = new Map<string, Promise<SiteSessionState>>();
  readonly #stateQueues = new Map<string, Promise<void>>();
  readonly #nextDue = new Map<string, number>();
  readonly #failures = new Map<string, number>();
  readonly #pausedRegions = new Set<string>();
  readonly #pagePauses = new Set<string>();
  readonly #scheduledArtifacts = new Map<string, string>();
  #unsubscribe?: () => void;
  #timer?: number;
  #started = false;

  start(): () => void {
    if (this.#started) return () => undefined;
    this.#started = true;
    this.#unsubscribe = useBrowserStore.subscribe(() => this.sync());
    const resync = () => this.sync();
    window.addEventListener("focus", resync);
    window.addEventListener("blur", resync);
    document.addEventListener("visibilitychange", resync);
    this.#timer = window.setInterval(() => this.tick(), schedulerTickMs);
    this.sync();
    return () => {
      this.#unsubscribe?.();
      window.removeEventListener("focus", resync);
      window.removeEventListener("blur", resync);
      document.removeEventListener("visibilitychange", resync);
      if (this.#timer !== undefined) window.clearInterval(this.#timer);
      for (const job of this.#jobs.values()) job.cancel();
      this.#jobs.clear();
      this.#queue.splice(0);
      this.#stateQueues.clear();
      this.#frames.clear();
      this.#scheduledArtifacts.clear();
      this.#started = false;
    };
  }

  attachFrame(registration: FrameRegistration): () => void {
    this.#frames.set(registration.tabId, registration);
    void this.syncFrame(registration);
    return () => {
      if (this.#frames.get(registration.tabId)?.connection === registration.connection) {
        this.#frames.delete(registration.tabId);
      }
    };
  }

  async handleAction(
    tabId: string,
    artifact: PageArtifact,
    event: ArtifactDynamicActionEvent,
  ): Promise<DynamicHandleResult> {
    const state = useBrowserStore.getState();
    if (state.generationSettings.dynamicMode === "off") {
      this.#frames.get(tabId)?.connection.setDynamicError({
        requestId: event.requestId,
        regionIds: event.targets,
        message: "Dynamic updates are disabled for this profile.",
        retryable: false,
      });
      return "disabled";
    }
    const tab = state.tabs.find((candidate) => candidate.id === tabId);
    const currentArtifactId = tab?.artifactId ?? tab?.fallbackArtifactId;
    if (currentArtifactId !== artifact.id || (artifact.profileId && artifact.profileId !== state.activeProfileId)) {
      this.#frames.get(tabId)?.connection.setDynamicError({
        requestId: event.requestId,
        regionIds: event.targets,
        message: "This live action belongs to a page that is no longer active.",
        retryable: false,
      });
      return "disabled";
    }
    const world = state.siteWorlds[artifact.siteWorldId];
    if (!world || world.state === "archived") return "restore-required";
    const declared = artifact.dynamicManifest?.actions.find((candidate) =>
      candidate.action === event.action
      && candidate.targets.length === event.targets.length
      && candidate.targets.every((target) => event.targets.includes(target)));
    if (!declared || event.regions.length !== event.targets.length
        || event.regions.some((region) => !event.targets.includes(region.regionId))) {
      this.#frames.get(tabId)?.connection.setDynamicError({
        requestId: event.requestId,
        regionIds: event.targets,
        message: "This live action is not authorized by the compiled page manifest.",
        retryable: false,
      });
      return "disabled";
    }

    if (declared.execution === "state") {
      const profileId = artifact.profileId ?? state.activeProfileId;
      const key = sessionKey(profileId, artifact.siteWorldId);
      const previous = this.#stateQueues.get(key) ?? Promise.resolve();
      const frame = this.#frames.get(tabId);
      frame?.connection.setDynamicPending(event.requestId, event.targets);
      const operation = previous.catch(() => undefined).then(async () => {
        const latestBrowser = useBrowserStore.getState();
        const latestWorld = latestBrowser.siteWorlds[artifact.siteWorldId];
        if (latestBrowser.generationSettings.dynamicMode === "off" || latestWorld?.state !== "active") {
          frame?.connection.setDynamicError({
            requestId: event.requestId,
            regionIds: event.targets,
            message: "Live state changed before this action could run.",
            retryable: false,
          });
          return;
        }
        const session = await this.ensureSession(profileId, artifact.siteWorldId);
        const next = applyStateAction(session, event.action, event.fields);
        if (next !== session) this.commitSession(next);
        this.syncSessionState(next, tabId, event.requestId);
        this.setStatus(tabId, { status: "live", consecutiveErrors: 0, lastUpdatedAt: new Date().toISOString() });
      }).catch((error) => {
        frame?.connection.setDynamicError({
          requestId: event.requestId,
          regionIds: event.targets,
          message: error instanceof Error ? error.message : "The live state action failed.",
          retryable: true,
        });
      }).finally(() => {
        if (this.#stateQueues.get(key) === operation) this.#stateQueues.delete(key);
      });
      this.#stateQueues.set(key, operation);
      await operation;
      return "handled";
    }

    this.enqueue({
      tabId,
      artifact,
      trigger: "action",
      requestId: event.requestId,
      action: event.action,
      targets: event.targets,
      fields: event.fields,
      regions: event.regions,
    });
    return "handled";
  }

  setPagePaused(tabId: string, paused: boolean): void {
    if (paused) {
      this.#pagePauses.add(tabId);
      const job = this.#jobs.get(tabId);
      if (job?.trigger === "timer") job.cancel();
    } else {
      this.#pagePauses.delete(tabId);
      for (const key of [...this.#pausedRegions]) if (key.startsWith(`${tabId}:`)) this.#pausedRegions.delete(key);
    }
    useDynamicRuntimeStore.setState((state) => ({ pagePaused: { ...state.pagePaused, [tabId]: paused } }));
    this.sync();
  }

  manualRefresh(tabId: string): void {
    const state = useBrowserStore.getState();
    const tab = state.tabs.find((candidate) => candidate.id === tabId);
    const artifactId = tab?.artifactId ?? tab?.fallbackArtifactId;
    const artifact = artifactId ? state.artifacts[artifactId] : undefined;
    if (!artifact?.dynamicManifest || state.generationSettings.dynamicMode === "off") return;
    const targets = artifact.dynamicManifest.regions.map((region) => region.id);
    if (targets.length === 0) return;
    this.enqueue({ tabId, artifact, trigger: "manual", requestId: crypto.randomUUID(), action: "manual:refresh", targets, fields: {} });
  }

  isPagePaused(tabId: string): boolean {
    return this.#pagePauses.has(tabId);
  }

  sync(): void {
    const state = useBrowserStore.getState();
    const openTabs = new Set(state.tabs.map((tab) => tab.id));
    for (const tabId of this.#scheduledArtifacts.keys()) {
      if (!openTabs.has(tabId)) this.clearTabSchedule(tabId);
    }
    for (const [tabId, job] of this.#jobs) {
      const tab = state.tabs.find((candidate) => candidate.id === tabId);
      const artifactId = tab?.artifactId ?? tab?.fallbackArtifactId;
      const shouldCancel = shouldCancelDynamicJob({
        tabOpen: openTabs.has(tabId),
        mode: state.generationSettings.dynamicMode,
        artifactMatches: artifactId === job.artifactId,
        eligible: this.jobEligible(state, tabId, job.trigger),
      });
      if (shouldCancel) job.cancel();
    }
    for (let index = this.#queue.length - 1; index >= 0; index -= 1) {
      const item = this.#queue[index]!;
      if (!this.itemEligible(state, item)) {
        this.#queue.splice(index, 1);
        this.#frames.get(item.tabId)?.connection.setDynamicError({
          requestId: item.requestId,
          regionIds: item.targets,
          message: "Live update was cancelled because the page is no longer active.",
          retryable: true,
        });
      }
    }

    for (const tab of state.tabs) {
      const artifactId = tab.artifactId ?? tab.fallbackArtifactId;
      const artifact = artifactId ? state.artifacts[artifactId] : undefined;
      if (!artifact?.dynamicManifest) {
        this.clearTabSchedule(tab.id);
        continue;
      }
      if (this.#scheduledArtifacts.get(tab.id) !== artifact.id) {
        this.clearTabSchedule(tab.id);
        this.#scheduledArtifacts.set(tab.id, artifact.id);
      }
      const world = state.siteWorlds[artifact.siteWorldId];
      const hasTimers = artifact.dynamicManifest.regions.some((region) => Boolean(region.refreshSeconds));
      const paused = state.generationSettings.dynamicMode === "off" || this.#pagePauses.has(tab.id) || world?.state === "archived"
        || (hasTimers && state.generationSettings.dynamicMode === "active" && !this.timerEligible(state, tab.id));
      if (paused) this.setStatus(tab.id, { status: "paused", consecutiveErrors: this.status(tab.id).consecutiveErrors });
      else if (!this.#jobs.has(tab.id) && this.status(tab.id).status !== "error") {
        this.setStatus(tab.id, { ...this.status(tab.id), status: "live" });
      }
      for (const region of artifact.dynamicManifest.regions) {
        if (!region.refreshSeconds) continue;
        const key = `${tab.id}:${region.id}`;
        if (!this.#nextDue.has(key)) this.#nextDue.set(key, Date.now() + region.refreshSeconds * 1_000);
      }
      this.updateNextTime(tab.id, artifact);
    }
    this.drain();
  }

  tick(): void {
    const state = useBrowserStore.getState();
    if (state.generationSettings.dynamicMode === "off") return;
    const now = Date.now();
    for (const tab of state.tabs) {
      if (!this.timerEligible(state, tab.id)) continue;
      const artifactId = tab.artifactId ?? tab.fallbackArtifactId;
      const artifact = artifactId ? state.artifacts[artifactId] : undefined;
      if (!artifact?.dynamicManifest) continue;
      const due = collectDueDynamicRegionIds({
        tabId: tab.id,
        regions: artifact.dynamicManifest.regions,
        nextDue: this.#nextDue,
        pausedRegions: this.#pausedRegions,
        now,
      });
      if (due.length === 0) continue;
      for (const regionId of due) {
        const interval = artifact.dynamicManifest.regions.find((region) => region.id === regionId)?.refreshSeconds;
        if (interval) this.#nextDue.set(`${tab.id}:${regionId}`, now + interval * 1_000);
      }
      this.enqueue({
        tabId: tab.id,
        artifact,
        trigger: "timer",
        requestId: crypto.randomUUID(),
        action: "timer:refresh",
        targets: due,
        fields: {},
      });
    }
  }

  private timerEligible(state: BrowserState, tabId: string): boolean {
    return this.jobEligible(state, tabId, "timer");
  }

  private jobEligible(state: BrowserState, tabId: string, trigger: QueuedJob["trigger"]): boolean {
    const tab = state.tabs.find((candidate) => candidate.id === tabId);
    const artifactId = tab?.artifactId ?? tab?.fallbackArtifactId;
    const artifact = artifactId ? state.artifacts[artifactId] : undefined;
    if (!artifact) return false;
    return isDynamicTimerEligible({
      mode: state.generationSettings.dynamicMode,
      activeTab: state.activeTabId === tabId,
      windowFocused: document.hasFocus(),
      documentVisible: document.visibilityState === "visible",
      siteWorldActive: state.siteWorlds[artifact.siteWorldId]?.state === "active",
      pagePaused: trigger === "timer" && this.#pagePauses.has(tabId),
    });
  }

  private itemEligible(state: BrowserState, item: QueuedJob): boolean {
    const tab = state.tabs.find((candidate) => candidate.id === item.tabId);
    const artifactId = tab?.artifactId ?? tab?.fallbackArtifactId;
    return !shouldCancelDynamicJob({
      tabOpen: Boolean(tab),
      mode: state.generationSettings.dynamicMode,
      artifactMatches: artifactId === item.artifact.id,
      eligible: this.jobEligible(state, item.tabId, item.trigger),
    });
  }

  private enqueue(item: QueuedJob): void {
    const active = this.#jobs.get(item.tabId);
    if (active) {
      if (item.trigger === "timer") item.targets.forEach((target) => active.coalesced.add(target));
      else this.#frames.get(item.tabId)?.connection.setDynamicError({
        requestId: item.requestId,
        regionIds: item.targets,
        message: "Another live update is already running for this tab.",
        retryable: true,
      });
      return;
    }
    if (this.#startingTabs.has(item.tabId)) {
      if (item.trigger !== "timer") this.#frames.get(item.tabId)?.connection.setDynamicError({
        requestId: item.requestId,
        regionIds: item.targets,
        message: "Another live update is already starting for this tab.",
        retryable: true,
      });
      return;
    }
    const queued = this.#queue.find((candidate) => candidate.tabId === item.tabId);
    if (queued) {
      if (item.trigger === "timer") {
        if (queued.trigger === "timer") queued.targets = coalesceDynamicTargets(queued.targets, item.targets);
        else queued.coalescedTargets = coalesceDynamicTargets(queued.coalescedTargets ?? [], item.targets);
      }
      return;
    }
    this.#queue.push(item);
    this.drain();
  }

  private drain(): void {
    while (hasDynamicJobCapacity(this.#jobs.size, this.#startingTabs.size) && this.#queue.length > 0) {
      const item = this.#queue.shift()!;
      this.#startingTabs.add(item.tabId);
      void this.startJob(item).finally(() => {
        this.#startingTabs.delete(item.tabId);
        this.drain();
      });
    }
  }

  private async startJob(item: QueuedJob): Promise<void> {
    const state = useBrowserStore.getState();
    if (!this.itemEligible(state, item)) return;
    const profileId = item.artifact.profileId ?? state.activeProfileId;
    const session = await this.ensureSession(profileId, item.artifact.siteWorldId);
    const launchState = useBrowserStore.getState();
    if (!this.itemEligible(launchState, item)) {
      this.#frames.get(item.tabId)?.connection.setDynamicError({
        requestId: item.requestId,
        regionIds: item.targets,
        message: "Live update was cancelled before it started.",
        retryable: true,
      });
      return;
    }
    const regions = item.regions?.length ? item.regions : this.regionInputs(item.artifact, session, item.targets);
    if (regions.length !== item.targets.length) {
      this.failItem(item, { code: "unsafe-output", message: "One or more live regions are unavailable.", retryable: true });
      return;
    }
    const frame = this.#frames.get(item.tabId);
    frame?.connection.setDynamicPending(item.requestId, item.targets);
    const id = crypto.randomUUID();
    const baseRevisions = Object.fromEntries(regions.map((region) => [region.regionId, region.revision]));
    const task = this.startProviderRequest(launchState, item, session, regions, id);
    const job: DynamicJob = {
      id,
      tabId: item.tabId,
      artifactId: item.artifact.id,
      trigger: item.trigger,
      requestId: item.requestId,
      targets: item.targets,
      baseRevisions,
      cancel: task.cancel,
      coalesced: new Set(item.coalescedTargets ?? []),
    };
    this.#jobs.set(item.tabId, job);
    this.#startingTabs.delete(item.tabId);
    this.setStatus(item.tabId, { ...this.status(item.tabId), status: "updating" });
    try {
      const result = await task.result;
      if (!this.itemEligible(useBrowserStore.getState(), item)) throw new DOMException("Cancelled", "AbortError");
      const latest = await this.ensureSession(profileId, item.artifact.siteWorldId);
      const canonicalUrl = canonicalPageUrl(item.artifact.url);
      const currentPage = latest.regionSnapshots[canonicalUrl] ?? {};
      const patches = result.patches.flatMap((patch) => {
        if (!item.targets.includes(patch.regionId)) return [];
        const currentRevision = currentPage[patch.regionId]?.revision ?? baseRevisions[patch.regionId] ?? 0;
        if (currentRevision > (baseRevisions[patch.regionId] ?? 0)) return [];
        return [{ regionId: patch.regionId, html: patch.html, revision: currentRevision + 1 }];
      });
      if (patches.length === 0) throw new Error("The live response was stale or empty.");
      const next = updateRegionSnapshots(latest, canonicalUrl, patches, result.modelState);
      this.commitSession(next);
      frame?.connection.patchDynamic({
        requestId: item.requestId,
        sessionRevision: next.revision,
        patches,
        announcement: result.announcement,
      });
      for (const other of this.#frames.values()) {
        if (other.tabId !== item.tabId && other.artifact.siteWorldId === item.artifact.siteWorldId
            && canonicalPageUrl(other.artifact.url) === canonicalUrl) void this.syncFrame(other);
      }
      const completedAt = new Date().toISOString();
      for (const target of item.targets) {
        const key = `${item.tabId}:${target}`;
        this.#failures.delete(key);
        this.#pausedRegions.delete(key);
        const interval = item.artifact.dynamicManifest?.regions.find((region) => region.id === target)?.refreshSeconds;
        if (interval) this.#nextDue.set(key, Date.now() + interval * 1_000);
      }
      this.setStatus(item.tabId, { status: "live", consecutiveErrors: 0, lastUpdatedAt: completedAt });
    } catch (error) {
      const normalized = normalizeDynamicError(error);
      if (normalized.code === "cancelled") {
        frame?.connection.setDynamicError({
          requestId: item.requestId,
          regionIds: item.targets,
          message: normalized.message,
          retryable: true,
        });
        this.setStatus(item.tabId, {
          ...this.status(item.tabId),
          status: this.itemEligible(useBrowserStore.getState(), item) ? "live" : "paused",
        });
      } else {
        this.failItem(item, normalized);
        for (const target of item.targets) this.applyBackoff(item, target);
      }
    } finally {
      const finished = this.#jobs.get(item.tabId);
      this.#jobs.delete(item.tabId);
      const currentState = useBrowserStore.getState();
      if (finished && finished.coalesced.size > 0 && this.itemEligible(currentState, item)) {
        this.enqueue({
          ...item,
          trigger: "timer",
          requestId: crypto.randomUUID(),
          action: "timer:refresh",
          targets: [...finished.coalesced],
          fields: {},
          regions: undefined,
          coalescedTargets: undefined,
        });
      }
      this.updateNextTime(item.tabId, item.artifact);
      this.sync();
    }
  }

  private startProviderRequest(
    state: BrowserState,
    item: QueuedJob,
    session: SiteSessionState,
    regions: ArtifactDynamicRegionSnapshot[],
    jobId: string,
  ): { cancel: () => void; result: Promise<DynamicResult> } {
    if (!isTauri()) {
      const controller = new AbortController();
      return {
        cancel: () => controller.abort(),
        result: new Promise((resolve, reject) => {
          const timer = window.setTimeout(() => resolve({
            patches: regions.map((region) => ({ regionId: region.regionId, html: `<div role="status"><strong>Updated</strong><p>Fresh local preview content for ${escapeHtml(region.regionId)}.</p></div>` })),
            announcement: "Live content updated.",
          }), 120);
          controller.signal.addEventListener("abort", () => { window.clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); }, { once: true });
        }),
      };
    }

    const provider = currentProvider(state);
    const world = state.siteWorlds[item.artifact.siteWorldId];
    const channel = new Channel<Record<string, unknown>>();
    let settled = false;
    let resolveResult!: (result: DynamicResult) => void;
    let rejectResult!: (error: unknown) => void;
    const result = new Promise<DynamicResult>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    channel.onmessage = (wire) => {
      if (wire.jobId !== jobId || settled) return;
      if (wire.type === "dynamic.completed" && isRecord(wire.result)) {
        settled = true;
        resolveResult(normalizeDynamicResult(wire.result));
      } else if (wire.type === "dynamic.failed") {
        settled = true;
        rejectResult(isRecord(wire.error) ? wire.error : wire);
      } else if (wire.type === "dynamic.cancelled") {
        settled = true;
        rejectResult(new DOMException("Cancelled", "AbortError"));
      }
    };
    const request = {
      kind: "dynamic-region",
      url: item.artifact.url,
      profileId: state.activeProfileId,
      siteWorldId: item.artifact.siteWorldId,
      browserTheme: state.preferences.theme,
      provider: provider.request,
      modelId: provider.modelId,
      worldPromptSnapshot: world?.promptSnapshot ?? item.artifact.worldPromptSnapshot ?? { revision: 0, vibe: "", prompt: "" },
      siteIdentity: world?.identity ?? item.artifact.siteIdentity,
      page: { title: item.artifact.title, summary: item.artifact.summary },
      action: { action: item.action, trigger: item.trigger, targets: item.targets, fields: item.fields },
      regions,
      trustedState: trustedStateForModel(session),
      modelState: session.modelState,
      settings: { ...state.generationSettings, motionEnabled: state.preferences.animations },
    };
    void invoke("start_generation", {
      input: {
        jobId,
        profileId: state.activeProfileId,
        ...(provider.credentialRef ? { credentialRef: provider.credentialRef } : {}),
        request,
      },
      onEvent: channel,
    }).catch((error) => {
      if (settled) return;
      settled = true;
      rejectResult(error);
    });
    return {
      result,
      cancel: () => {
        if (!settled) void invoke("cancel_generation", { jobId }).catch(() => undefined);
      },
    };
  }

  private regionInputs(artifact: PageArtifact, session: SiteSessionState, targets: string[]): ArtifactDynamicRegionSnapshot[] {
    const persisted = session.regionSnapshots[canonicalPageUrl(artifact.url)] ?? {};
    const parser = new DOMParser();
    const document = parser.parseFromString(artifact.html, "text/html");
    return targets.flatMap((regionId) => {
      const saved = persisted[regionId];
      if (saved) return [{ regionId, html: saved.html, revision: saved.revision }];
      const element = Array.from(document.querySelectorAll("[data-vibe-region]"))
        .find((candidate) => candidate.getAttribute("data-vibe-region") === regionId);
      return element ? [{ regionId, html: element.innerHTML.slice(0, 64 * 1024), revision: 0 }] : [];
    });
  }

  private async ensureSession(profileId: string, siteWorldId: string): Promise<SiteSessionState> {
    const key = sessionKey(profileId, siteWorldId);
    const cached = useDynamicRuntimeStore.getState().sessions[key];
    if (cached) return cached;
    const existing = this.#sessionLoads.get(key);
    if (existing) return existing;
    const load = getPersistedSiteSession(profileId, siteWorldId)
      .then((session) => normalizeSiteSession(session, profileId, siteWorldId))
      .catch(() => createSiteSession(profileId, siteWorldId))
      .then((session) => {
        this.setSession(session);
        this.#sessionLoads.delete(key);
        return session;
      });
    this.#sessionLoads.set(key, load);
    return load;
  }

  private commitSession(session: SiteSessionState): void {
    this.setSession(session);
    void savePersistedSiteSession(session).catch((error) => console.warn("Could not persist live site state", error));
  }

  private setSession(session: SiteSessionState): void {
    useDynamicRuntimeStore.setState((state) => ({ sessions: { ...state.sessions, [sessionKey(session.profileId, session.siteWorldId)]: session } }));
  }

  private syncSessionState(session: SiteSessionState, requestTabId?: string, requestId?: string): void {
    for (const frame of this.#frames.values()) {
      if (frame.artifact.siteWorldId !== session.siteWorldId || frame.artifact.profileId !== session.profileId) continue;
      frame.connection.syncState({
        ...(frame.tabId === requestTabId && requestId ? { requestId } : {}),
        sessionRevision: session.revision,
        bindings: bindingsForSession(session, frame.artifact.dynamicManifest?.bindings ?? []),
      });
    }
  }

  private async syncFrame(frame: FrameRegistration): Promise<void> {
    const state = useBrowserStore.getState();
    const session = await this.ensureSession(frame.artifact.profileId ?? state.activeProfileId, frame.artifact.siteWorldId);
    const page = session.regionSnapshots[canonicalPageUrl(frame.artifact.url)] ?? {};
    frame.connection.syncState({
      sessionRevision: session.revision,
      bindings: bindingsForSession(session, frame.artifact.dynamicManifest?.bindings ?? []),
      snapshots: Object.entries(page).map(([regionId, snapshot]) => ({ regionId, html: snapshot.html, revision: snapshot.revision })),
    });
  }

  private failItem(item: QueuedJob, error: GenerationError): void {
    this.#frames.get(item.tabId)?.connection.setDynamicError({
      requestId: item.requestId,
      regionIds: item.targets,
      message: error.code === "rate-limited" ? `${error.message} Retry or choose another model.` : error.message,
      retryable: error.retryable,
    });
    const previous = this.status(item.tabId);
    this.setStatus(item.tabId, { status: "error", consecutiveErrors: previous.consecutiveErrors + 1, error });
  }

  private applyBackoff(item: QueuedJob, target: string): void {
    const key = `${item.tabId}:${target}`;
    const failures = (this.#failures.get(key) ?? 0) + 1;
    this.#failures.set(key, failures);
    const interval = item.artifact.dynamicManifest?.regions.find((region) => region.id === target)?.refreshSeconds ?? 60;
    this.#nextDue.set(key, Date.now() + dynamicBackoffSeconds(interval, failures) * 1_000);
    if (shouldPauseDynamicRegion(failures)) this.#pausedRegions.add(key);
  }

  private status(tabId: string): DynamicTabStatus {
    return useDynamicRuntimeStore.getState().tabStatus[tabId] ?? { status: "paused", consecutiveErrors: 0 };
  }

  private setStatus(tabId: string, status: DynamicTabStatus): void {
    useDynamicRuntimeStore.setState((state) => ({ tabStatus: { ...state.tabStatus, [tabId]: status } }));
  }

  private updateNextTime(tabId: string, artifact: PageArtifact): void {
    const due = artifact.dynamicManifest?.regions
      .map((region) => this.#nextDue.get(`${tabId}:${region.id}`))
      .filter((value): value is number => value !== undefined)
      .sort((left, right) => left - right)[0];
    const current = this.status(tabId);
    this.setStatus(tabId, { ...current, ...(due ? { nextUpdateAt: new Date(due).toISOString() } : { nextUpdateAt: undefined }) });
  }

  private clearTabSchedule(tabId: string): void {
    this.#scheduledArtifacts.delete(tabId);
    this.#pagePauses.delete(tabId);
    for (const collection of [this.#nextDue, this.#failures]) {
      for (const key of collection.keys()) if (key.startsWith(`${tabId}:`)) collection.delete(key);
    }
    for (const key of [...this.#pausedRegions]) if (key.startsWith(`${tabId}:`)) this.#pausedRegions.delete(key);
    useDynamicRuntimeStore.setState((state) => {
      const tabStatus = { ...state.tabStatus };
      const pagePaused = { ...state.pagePaused };
      delete tabStatus[tabId];
      delete pagePaused[tabId];
      return { tabStatus, pagePaused };
    });
  }
}

interface DynamicResult {
  patches: Array<{ regionId: string; html: string }>;
  modelState?: JsonValue;
  announcement?: string;
}

const coordinator = new DynamicCoordinator();

export function startDynamicRuntime(): () => void {
  return coordinator.start();
}

export function attachDynamicFrame(registration: FrameRegistration): () => void {
  return coordinator.attachFrame(registration);
}

export function handleDynamicAction(tabId: string, artifact: PageArtifact, event: ArtifactDynamicActionEvent): Promise<DynamicHandleResult> {
  return coordinator.handleAction(tabId, artifact, event);
}

export function setDynamicPagePaused(tabId: string, paused: boolean): void {
  coordinator.setPagePaused(tabId, paused);
}

export function isDynamicPagePaused(tabId: string): boolean {
  return coordinator.isPagePaused(tabId);
}

export function refreshDynamicPage(tabId: string): void {
  coordinator.manualRefresh(tabId);
}

function sessionKey(profileId: string, siteWorldId: string): string {
  return `${profileId}\0${siteWorldId}`;
}

function currentProvider(state: BrowserState): {
  modelId: string;
  request: Record<string, unknown>;
  credentialRef?: string;
} {
  let modelId = state.activeModelId;
  let reasoningEffort: string | undefined;
  let serviceTier: string | undefined;
  if (modelId === "codex:chatgpt") {
    const model = state.codexModels.find((candidate) => candidate.id === state.codexSelection.modelId)
      ?? state.codexModels.find((candidate) => candidate.isDefault);
    const selected = model?.model ?? state.codexSelection.modelId;
    if (selected) modelId = selected.startsWith("codex:") ? selected : `codex:${selected}`;
    reasoningEffort = state.codexSelection.reasoningEffort;
    serviceTier = state.codexSelection.serviceTier;
  }
  const providerId = modelId.includes(":") ? modelId.split(":", 1)[0]! : "mock";
  const connection = state.providerConnections.find((candidate) => candidate.profileId === state.activeProfileId
    && (candidate.id === providerId || candidate.modelIds.includes(modelId)));
  const kind = connection?.kind ?? (providerId === "provider" ? "openai-compatible" : providerId);
  return {
    modelId,
    request: {
      connectionId: connection?.id ?? kind,
      id: connection?.id ?? kind,
      kind,
      modelId: stripProviderPrefix(modelId),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(serviceTier ? { serviceTier } : {}),
      ...(connection?.baseUrl ? { baseUrl: connection.baseUrl } : {}),
    },
    ...(connection?.secretRef ? { credentialRef: connection.secretRef } : {}),
  };
}

function stripProviderPrefix(modelId: string): string {
  const separator = modelId.indexOf(":");
  return separator >= 0 ? modelId.slice(separator + 1) : modelId;
}

function normalizeDynamicResult(value: Record<string, unknown>): DynamicResult {
  if (!Array.isArray(value.patches)) throw new Error("The live response did not contain patches.");
  const patches = value.patches.flatMap((candidate) => {
    if (!isRecord(candidate) || typeof candidate.regionId !== "string" || typeof candidate.html !== "string") return [];
    return [{ regionId: candidate.regionId, html: candidate.html }];
  });
  return {
    patches,
    ...(value.modelState !== undefined ? { modelState: value.modelState as JsonValue } : {}),
    ...(typeof value.announcement === "string" ? { announcement: value.announcement } : {}),
  };
}

function normalizeDynamicError(value: unknown): GenerationError {
  if (value instanceof DOMException && value.name === "AbortError") return { code: "cancelled", message: "Live update was cancelled.", retryable: true };
  const record = isRecord(value) ? value : {};
  const code = typeof record.code === "string" ? record.code : "unknown";
  const allowed: GenerationError["code"][] = ["provider-not-configured", "invalid-api-key", "rate-limited", "provider-unavailable", "provider-route-required", "timeout", "cancelled", "malformed-output", "unsafe-output", "worker-crashed", "unknown"];
  return {
    code: allowed.includes(code as GenerationError["code"]) ? code as GenerationError["code"] : "unknown",
    message: typeof record.message === "string" ? record.message : value instanceof Error ? value.message : "Live update failed.",
    retryable: typeof record.retryable === "boolean" ? record.retryable : true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}
