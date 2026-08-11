import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Info, LoaderCircle, TriangleAlert } from "lucide-react";
import { connectArtifactFrame, type ArtifactFrameConnection } from "../../artifacts/iframe-host";
import type { ArtifactFrameEvent } from "../../artifacts/bridge-protocol";
import "../../artifacts/artifact-surface.css";
import { modelCatalog } from "../../data/catalog";
import {
  buildLegacyGeneratedArtifactDocument,
  compileGeneratedArtifactDocument,
} from "../../lib/generated-document";
import { openExternal } from "../../lib/platform";
import { useBrowserStore } from "../../store/browser-store";
import type {
  BrowserTab,
  GenerationPhase,
  NavigationIntent,
} from "../../types/browser";
import { NewTabPage } from "./NewTabPage";

const PHASE_LABELS: Record<GenerationPhase, string> = {
  queued: "Waiting for the model",
  "preparing-context": "Preparing site context",
  planning: "Imagining the site",
  generating: "Writing the page",
  validating: "Checking the result",
  "compiling-styles": "Compiling styles",
  "resolving-images": "Resolving images",
  committing: "Saving the artifact",
  completed: "Opening the page",
  failed: "Generation failed",
  cancelled: "Generation stopped",
};

export function PageSurface({ tab }: { tab: BrowserTab }) {
  if (tab.kind === "new-tab") return <NewTabPage />;
  if (tab.kind === "generated") return <GeneratedPageSurface tab={tab} />;

  return (
    <div className="page-surface page-surface--remote">
      <div className="surface-error">
        <Info aria-hidden="true" />
        <h2>Live web stays outside VibeSurfer</h2>
        <p>This legacy tab will not contact <strong>{safeHostname(tab.location)}</strong>. Generate an imagined version from the address bar, or explicitly open the live site in your system browser.</p>
        <button className="button button--primary" type="button" onClick={() => void openExternal(tab.location)}><ExternalLink aria-hidden="true" /> Open live site externally</button>
      </div>
    </div>
  );
}

function GeneratedPageSurface({ tab }: { tab: BrowserTab }) {
  const theme = useBrowserStore((state) => state.preferences.theme);
  const providerConnections = useBrowserStore((state) => state.providerConnections);
  const activeProfileId = useBrowserStore((state) => state.activeProfileId);
  const artifact = useBrowserStore((state) => tab.artifactId ? state.artifacts[tab.artifactId] : undefined);
  const job = useBrowserStore((state) => tab.generationJobId ? state.generationJobs[tab.generationJobId] : undefined);
  const navigate = useBrowserStore((state) => state.navigate);
  const addTab = useBrowserStore((state) => state.addTab);
  const setLoadState = useBrowserStore((state) => state.setLoadState);
  const setTabMetadata = useBrowserStore((state) => state.setTabMetadata);
  const regenerate = useBrowserStore((state) => state.regenerate);
  const reload = useBrowserStore((state) => state.reload);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const connectionRef = useRef<{
    key: string;
    connection: ArtifactFrameConnection;
  } | null>(null);
  const readyKeyRef = useRef<string | undefined>(undefined);
  const [readyKey, setReadyKey] = useState<string>();
  const [armedKey, setArmedKey] = useState<string>();
  const [bridgeFailure, setBridgeFailure] = useState<{ key: string; message: string }>();
  const [runtimeWarning, setRuntimeWarning] = useState<{ key: string; message: string }>();

  const isGenerating = job?.status === "queued" || job?.status === "running";
  const generationFailed = job?.status === "failed" || job?.status === "cancelled";
  const hasRecoverableArtifact = Boolean(artifact);
  const legacyPrompt = artifact ? undefined : tab.prompt ?? tab.title;
  const legacyArtifactId = artifact ? undefined : tab.artifactId ?? `legacy-${tab.id}`;
  const legacyUrl = artifact
    ? undefined
    : tab.virtualLocation?.url ?? (tab.location.startsWith("http") ? tab.location : undefined);
  const compiledResult = useMemo(() => {
    if (isGenerating || (generationFailed && !hasRecoverableArtifact)) return undefined;
    try {
      const document = artifact
        ? compileGeneratedArtifactDocument({
            artifactId: artifact.id,
            url: artifact.url,
            title: artifact.title,
            html: artifact.html,
          })
        : buildLegacyGeneratedArtifactDocument(legacyPrompt ?? "Generated page", theme, {
            artifactId: legacyArtifactId,
            url: legacyUrl,
          });
      return { ok: true as const, document };
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : "The generated document could not be prepared.",
      };
    }
  }, [artifact, generationFailed, hasRecoverableArtifact, isGenerating, legacyArtifactId, legacyPrompt, legacyUrl, tab.reloadKey, theme]);

  const documentKey = compiledResult?.ok
    ? `${compiledResult.document.artifactId}:${compiledResult.document.nonce}:${tab.reloadKey}`
    : undefined;
  const frameReady = documentKey !== undefined && readyKey === documentKey;
  const frameUrl = compiledResult?.ok
    ? artifactFrameUrl(compiledResult.document)
    : undefined;
  const currentBridgeFailure = documentKey && bridgeFailure?.key === documentKey ? bridgeFailure.message : undefined;
  const currentRuntimeWarning = documentKey && runtimeWarning?.key === documentKey ? runtimeWarning.message : undefined;
  const displayedWarning = currentRuntimeWarning
    ?? (generationFailed && hasRecoverableArtifact
      ? `${job?.error?.message ?? "Generation stopped"}. Showing the previous artifact.`
      : undefined);
  const models = useMemo(() => modelCatalog(providerConnections, activeProfileId), [activeProfileId, providerConnections]);
  const modelLabel = models.find((model) => model.id === (artifact?.modelId ?? tab.generatedWith))?.name
    ?? artifact?.modelId
    ?? tab.generatedWith
    ?? "Model";

  useEffect(() => {
    const effectKey = documentKey;
    return () => {
      const current = connectionRef.current;
      if (current && current.key === effectKey) {
        current.connection.disconnect();
        connectionRef.current = null;
      }
    };
  }, [documentKey]);

  const handleFrameEvent = useCallback((event: ArtifactFrameEvent, key: string, artifactUrl: string, artifactId: string) => {
    if (event.type === "ready-for-render") return;
    if (event.type === "ready") {
      readyKeyRef.current = key;
      setReadyKey(key);
      setLoadState(tab.id, "idle");
      if (event.title) setTabMetadata(tab.id, { title: event.title }, tab.generationJobId);
      return;
    }

    if (event.type === "runtime-error") {
      setRuntimeWarning({ key, message: event.message });
      return;
    }

    if (event.type === "title-change") {
      setTabMetadata(tab.id, { title: event.title }, tab.generationJobId);
      return;
    }

    if (event.type === "form-submit") {
      const destination = appendFormFields(event.action, event.fields);
      const formFields = flattenFormFields(event.fields);
      navigate(tab.id, destination, {
        baseUrl: artifactUrl,
        intent: {
          trigger: "form",
          disposition: "current",
          requestedUrl: destination,
          sourceTabId: tab.id,
          sourceArtifactId: artifactId,
          formFields,
        },
      });
      return;
    }

    if (event.type === "hash-change") {
      navigate(tab.id, event.href, {
        baseUrl: artifactUrl,
        intent: {
          trigger: "link",
          disposition: "current",
          requestedUrl: event.href,
          sourceTabId: tab.id,
          sourceArtifactId: artifactId,
        },
      });
      return;
    }

    const intent: Partial<NavigationIntent> = {
      trigger: "link",
      disposition: event.disposition,
      requestedUrl: event.href,
      sourceTabId: tab.id,
      sourceArtifactId: artifactId,
      linkText: event.linkText,
      ariaLabel: event.ariaLabel,
      surroundingText: event.context,
    };
    if (event.disposition === "current") {
      navigate(tab.id, event.href, { baseUrl: artifactUrl, intent });
    } else {
      addTab(event.href, {
        disposition: event.disposition,
        opener: { tabId: tab.id, artifactId },
        baseUrl: artifactUrl,
        intent,
      });
    }
  }, [addTab, navigate, setLoadState, setTabMetadata, tab.generationJobId, tab.id]);

  const ensureFrameConnection = useCallback(() => {
    const current = connectionRef.current;
    if (current && current.key === documentKey) return;
    connectionRef.current?.connection.disconnect();
    connectionRef.current = null;
    if (!compiledResult?.ok || !documentKey) return;
    readyKeyRef.current = undefined;
    const { document } = compiledResult;
    const artifactUrl = artifact?.url ?? tab.virtualLocation?.url ?? tab.location;
    const connection = connectArtifactFrame({
      getIframe: () => frameRef.current,
      artifactId: document.artifactId,
      nonce: document.nonce,
      render: document.payload,
      onEvent: (event) => handleFrameEvent(event, documentKey, artifactUrl, document.artifactId),
      onRuntimeRestart: () => {
        readyKeyRef.current = undefined;
        setReadyKey((current) => current === documentKey ? undefined : current);
      },
      onProtocolError: (message) => {
        if (readyKeyRef.current === documentKey) setRuntimeWarning({ key: documentKey, message });
        else setBridgeFailure({ key: documentKey, message });
      },
    });
    connectionRef.current = { key: documentKey, connection };
  }, [artifact?.url, compiledResult, documentKey, handleFrameEvent, tab.location, tab.virtualLocation?.url]);

  // Register the parent listener in one synchronous commit, then mount the
  // static trusted shell in the next so its first bootstrap cannot race us.
  useLayoutEffect(() => {
    if (!compiledResult?.ok || !documentKey) {
      connectionRef.current?.connection.disconnect();
      connectionRef.current = null;
      setArmedKey((current) => current === undefined ? current : undefined);
      return;
    }
    ensureFrameConnection();
    setArmedKey((current) => current === documentKey ? current : documentKey);
  }, [compiledResult?.ok, documentKey, ensureFrameConnection]);

  if (isGenerating) {
    return <GenerationSkeleton phase={job?.phase ?? "queued"} />;
  }

  if (generationFailed && !hasRecoverableArtifact) {
    const cancelled = job?.status === "cancelled";
    return (
      <ArtifactError
        title={cancelled ? "Generation stopped" : "This page could not be generated"}
        message={job?.error?.message ?? (cancelled ? "The generation was cancelled." : "The model did not return a usable artifact.")}
        onRetry={job?.error?.retryable === false ? undefined : () => regenerate(tab.id)}
      />
    );
  }

  if (!compiledResult?.ok) {
    return (
      <ArtifactError
        title="This artifact could not be opened"
        message={compiledResult?.message ?? "The artifact is unavailable."}
        onRetry={() => regenerate(tab.id)}
      />
    );
  }

  if (currentBridgeFailure) {
    return (
      <ArtifactError
        title="The safe page bridge did not start"
        message={currentBridgeFailure}
        onRetry={() => reload(tab.id)}
      />
    );
  }

  return (
    <div className="page-surface page-surface--generated">
      {armedKey === documentKey && (
        <iframe
          ref={frameRef}
          key={documentKey}
          className={`page-frame ${frameReady ? "artifact-frame--ready" : "artifact-frame--connecting"}`}
          title={artifact?.title ?? tab.title}
          src={frameUrl}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          onLoad={ensureFrameConnection}
          onError={() => {
            setLoadState(tab.id, "error");
            setBridgeFailure({ key: documentKey ?? compiledResult.document.artifactId, message: "The generated document could not be loaded." });
          }}
        />
      )}
      {!frameReady && <GenerationSkeleton phase="completed" overlay />}
      {displayedWarning && <div className="artifact-runtime-warning" role="status">{displayedWarning}</div>}
      <div className="surface-chip"><span className="surface-chip__spark">✦</span> Generated artifact <span>·</span> {modelLabel}</div>
    </div>
  );
}

function GenerationSkeleton({ phase, overlay = false }: { phase: GenerationPhase; overlay?: boolean }) {
  return (
    <div className={`artifact-loading${overlay ? " artifact-loading--overlay" : ""}`} role="status" aria-live="polite">
      <div className="artifact-loading__content">
        <div className="artifact-loading__eyebrow"><LoaderCircle aria-hidden="true" /> Generating page</div>
        <div className="artifact-loading__title" />
        <div className="artifact-loading__line" />
        <div className="artifact-loading__line artifact-loading__line--short" />
        <div className="artifact-loading__cards" aria-hidden="true">
          <div className="artifact-loading__card" />
          <div className="artifact-loading__card" />
          <div className="artifact-loading__card" />
        </div>
        <div className="artifact-loading__phase"><i />{PHASE_LABELS[phase]}</div>
      </div>
    </div>
  );
}

function ArtifactError({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div className="page-surface page-surface--generated">
      <div className="artifact-error" role="alert">
        <div className="artifact-error__card">
          <TriangleAlert aria-hidden="true" />
          <h2>{title}</h2>
          <p>{message}</p>
          {onRetry && <button className="button button--primary" type="button" onClick={onRetry}>Try again</button>}
        </div>
      </div>
    </div>
  );
}

function appendFormFields(action: string, fields: Record<string, string[]>) {
  const url = new URL(action);
  for (const [name, values] of Object.entries(fields)) {
    for (const value of values) url.searchParams.append(name, value);
  }
  return url.href;
}

function flattenFormFields(fields: Record<string, string[]>) {
  return Object.fromEntries(Object.entries(fields).map(([name, values]) => [name, values.join(", ")]));
}

function safeHostname(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return "the live origin";
  }
}

function artifactFrameUrl(
  document: { artifactId: string; nonce: string },
) {
  const config = new URLSearchParams({
    artifactId: document.artifactId,
    nonce: document.nonce,
  });
  return `/artifact-frame.html#${config.toString()}`;
}
