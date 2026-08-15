import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowLeft, ArrowRight, Code2, ExternalLink, Info, RefreshCw, TriangleAlert, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { connectArtifactFrame, type ArtifactFrameConnection } from "../../artifacts/iframe-host";
import type { ArtifactFrameEvent } from "../../artifacts/bridge-protocol";
import { createBridgeNonce } from "../../artifacts/document";
import "../../artifacts/artifact-surface.css";
import {
  buildLegacyGeneratedArtifactDocument,
  compileGeneratedArtifactDocument,
} from "../../lib/generated-document";
import { openExternal } from "../../lib/platform";
import { activatePersistedSiteWorld } from "../../generation/host-api";
import { useBrowserStore } from "../../store/browser-store";
import type {
  BrowserTab,
  NavigationIntent,
} from "../../types/browser";
import { NewTabPage } from "./NewTabPage";
import { HistoryPage } from "./HistoryPage";

interface PageContextMenuState {
  left: number;
  top: number;
  href?: string;
  linkText?: string;
  ariaLabel?: string;
  context?: string;
}

interface PendingArchivedNavigation {
  href: string;
  baseUrl: string;
  disposition: "current" | "foreground-tab" | "background-tab";
  intent: Partial<NavigationIntent>;
}

export function PageSurface({ tab, onLinkHover }: { tab: BrowserTab; onLinkHover?: (href?: string) => void }) {
  if (tab.kind === "new-tab") return <NewTabPage />;
  if (tab.kind === "history") return <HistoryPage />;
  if (tab.kind === "generated") return <GeneratedPageSurface tab={tab} onLinkHover={onLinkHover} />;

  return (
    <div className="page-surface page-surface--remote">
      <div className="surface-error">
        <Info aria-hidden="true" />
        <h2>Live web stays outside vibesurfer</h2>
        <p>This legacy tab will not contact <strong>{safeHostname(tab.location)}</strong>. Generate an imagined version from the address bar, or explicitly open the live site in your system browser.</p>
        <button className="button button--primary" type="button" onClick={() => void openExternal(tab.location)}><ExternalLink aria-hidden="true" /> Open live site externally</button>
      </div>
    </div>
  );
}

function GeneratedPageSurface({ tab, onLinkHover }: { tab: BrowserTab; onLinkHover?: (href?: string) => void }) {
  const theme = useBrowserStore((state) => state.preferences.theme);
  const artifact = useBrowserStore((state) => {
    const artifactId = tab.artifactId ?? tab.fallbackArtifactId;
    return artifactId ? state.artifacts[artifactId] : undefined;
  });
  const job = useBrowserStore((state) => tab.generationJobId ? state.generationJobs[tab.generationJobId] : undefined);
  const navigate = useBrowserStore((state) => state.navigate);
  const addTab = useBrowserStore((state) => state.addTab);
  const go = useBrowserStore((state) => state.go);
  const setLoadState = useBrowserStore((state) => state.setLoadState);
  const setTabMetadata = useBrowserStore((state) => state.setTabMetadata);
  const regenerate = useBrowserStore((state) => state.regenerate);
  const reload = useBrowserStore((state) => state.reload);
  const openSettings = useBrowserStore((state) => state.openSettings);
  const markFrameReady = useBrowserStore((state) => state.markFrameReady);
  const restoreSiteWorld = useBrowserStore((state) => state.restoreSiteWorld);
  const activeProfileId = useBrowserStore((state) => state.activeProfileId);
  const archivedSiteWorld = useBrowserStore((state) => {
    const id = tab.archivedSiteWorldId ?? tab.siteWorldId;
    const world = id ? state.siteWorlds[id] : undefined;
    return world?.state === "archived" ? world : undefined;
  });
  const frameRef = useRef<HTMLIFrameElement>(null);
  const connectionRef = useRef<{
    key: string;
    connection: ArtifactFrameConnection;
  } | null>(null);
  const readyKeyRef = useRef<string | undefined>(undefined);
  const [readyKey, setReadyKey] = useState<string>();
  const [armedKey, setArmedKey] = useState<string>();
  const [bridgeFailure, setBridgeFailure] = useState<{ key: string; message: string }>();
  const [contextMenu, setContextMenu] = useState<PageContextMenuState>();
  const [sourceOpen, setSourceOpen] = useState(false);
  const [pendingArchivedNavigation, setPendingArchivedNavigation] = useState<PendingArchivedNavigation>();

  const isGenerating = job?.status === "queued" || job?.status === "running";
  const generationFailed = job?.status === "failed" || job?.status === "cancelled";
  const hasRecoverableArtifact = Boolean(artifact);
  const hasPreview = Boolean(job?.previewHtml);
  const legacyPrompt = artifact ? undefined : tab.prompt ?? tab.title;
  const legacyArtifactId = artifact ? undefined : tab.artifactId ?? `legacy-${tab.id}`;
  const legacyUrl = artifact
    ? undefined
    : tab.virtualLocation?.url ?? (tab.location.startsWith("http") ? tab.location : undefined);
  // Do not replace the current document while the next request is waiting for
  // its first streamed HTML fragment. After previewHtml appears, the job id is
  // the stable identity for the rest of that stream and its final artifact.
  const frameSessionKey = hasPreview
    ? job?.id ?? artifact?.id ?? legacyArtifactId ?? `generated-${tab.id}`
    : artifact?.id ?? legacyArtifactId ?? `generated-${tab.id}`;
  const frameIdentityRef = useRef<{ key: string; nonce: string } | undefined>(undefined);
  if (!frameIdentityRef.current || frameIdentityRef.current.key !== frameSessionKey) {
    frameIdentityRef.current = { key: frameSessionKey, nonce: createBridgeNonce() };
  }
  const frameIdentity = frameIdentityRef.current;
  const compiledResult = useMemo(() => {
    if ((isGenerating && !hasPreview && !hasRecoverableArtifact) || (generationFailed && !hasRecoverableArtifact && !hasPreview)) {
      return undefined;
    }
    try {
      const shouldShowPreview = hasPreview && (isGenerating || generationFailed || !artifact);
      if (shouldShowPreview && job?.previewHtml) {
        const url = job.normalizedUrl ?? job.requestedUrl ?? tab.virtualLocation?.url ?? tab.location;
        const title = job.provisionalTitle ?? artifact?.title ?? tab.title ?? "Generating page";
        return {
          ok: true as const,
          document: compileGeneratedArtifactDocument({
            artifactId: frameIdentity.key,
            nonce: frameIdentity.nonce,
            url,
            title,
            html: job.previewHtml,
            browserTheme: theme,
          }),
          sourceArtifactId: artifact?.id ?? job.sourceArtifactId ?? frameIdentity.key,
          sourceUrl: url,
          isPreview: true,
        };
      }
      if (artifact) {
        return {
          ok: true as const,
          document: compileGeneratedArtifactDocument({
            artifactId: frameIdentity.key,
            nonce: frameIdentity.nonce,
            url: artifact.url,
            title: artifact.title,
            html: artifact.html,
            allowGeneratedScripts: artifact.allowGeneratedScripts === true,
            browserTheme: theme,
          }),
          sourceArtifactId: artifact.id,
          sourceUrl: artifact.url,
          isPreview: false,
        };
      }
      const document = buildLegacyGeneratedArtifactDocument(legacyPrompt ?? "Generated page", theme, {
        artifactId: legacyArtifactId,
        url: legacyUrl,
      });
      return {
        ok: true as const,
        document,
        sourceArtifactId: document.artifactId,
        sourceUrl: document.payload.pageUrl,
        isPreview: false,
      };
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : "The generated document could not be prepared.",
      };
    }
  }, [artifact, frameIdentity.key, frameIdentity.nonce, generationFailed, hasPreview, hasRecoverableArtifact, isGenerating, job, legacyArtifactId, legacyPrompt, legacyUrl, tab.location, tab.title, tab.virtualLocation?.url, theme]);

  const documentKey = compiledResult?.ok
    ? `${compiledResult.document.artifactId}:${compiledResult.document.nonce}:${tab.reloadKey}`
    : undefined;
  const frameReady = documentKey !== undefined && readyKey === documentKey;
  const frameUrl = compiledResult?.ok
    ? artifactFrameUrl(compiledResult.document)
    : undefined;
  const currentBridgeFailure = documentKey && bridgeFailure?.key === documentKey ? bridgeFailure.message : undefined;
  const frameContextRef = useRef({
    sourceUrl: tab.location,
    sourceArtifactId: frameSessionKey,
  });
  if (compiledResult?.ok) {
    frameContextRef.current = {
      sourceUrl: compiledResult.sourceUrl,
      sourceArtifactId: compiledResult.sourceArtifactId,
    };
  }
  const isGeneratingRef = useRef(isGenerating);
  isGeneratingRef.current = isGenerating;

  useEffect(() => {
    const effectKey = documentKey;
    setContextMenu(undefined);
    setSourceOpen(false);
    return () => {
      onLinkHover?.();
      const current = connectionRef.current;
      if (current && current.key === effectKey) {
        current.connection.disconnect();
        connectionRef.current = null;
      }
    };
  }, [documentKey, onLinkHover]);

  const handleFrameEvent = useCallback((event: ArtifactFrameEvent, key: string) => {
    if (event.type === "ready-for-render") return;
    if (event.type === "ready") {
      readyKeyRef.current = key;
      setReadyKey(key);
      if (!isGeneratingRef.current) setLoadState(tab.id, "idle");
      markFrameReady(tab.id);
      if (event.title) setTabMetadata(tab.id, { title: event.title }, tab.generationJobId);
      return;
    }

    if (event.type === "runtime-error") {
      console.warn("Page runtime warning", event.message);
      return;
    }

    if (event.type === "link-hover") {
      onLinkHover?.(event.href);
      return;
    }

    if (event.type === "title-change") {
      setTabMetadata(tab.id, { title: event.title }, tab.generationJobId);
      return;
    }

    if (event.type === "context-menu") {
      const frameBounds = frameRef.current?.getBoundingClientRect();
      if (!frameBounds) return;
      const menuWidth = 242;
      const menuHeight = event.href ? 185 : 148;
      setContextMenu({
        left: Math.max(8, Math.min(frameBounds.left + event.x, window.innerWidth - menuWidth - 8)),
        top: Math.max(8, Math.min(frameBounds.top + event.y, window.innerHeight - menuHeight - 8)),
        href: event.href,
        linkText: event.linkText,
        ariaLabel: event.ariaLabel,
        context: event.context,
      });
      return;
    }

    if (event.type === "browser-command") {
      openSettings("general");
      return;
    }

    if (event.type === "form-submit") {
      const { sourceUrl, sourceArtifactId } = frameContextRef.current;
      const destination = appendFormFields(event.action, event.fields);
      const formFields = flattenFormFields(event.fields);
      const intent: Partial<NavigationIntent> = {
          trigger: "form",
          disposition: "current",
          requestedUrl: destination,
          sourceTabId: tab.id,
          sourceArtifactId,
          formFields,
      };
      if (archivedSiteWorld) {
        setPendingArchivedNavigation({ href: destination, baseUrl: sourceUrl, disposition: "current", intent });
      } else {
        navigate(tab.id, destination, { baseUrl: sourceUrl, intent });
      }
      return;
    }

    if (event.type === "hash-change") {
      const { sourceUrl, sourceArtifactId } = frameContextRef.current;
      navigate(tab.id, event.href, {
        baseUrl: sourceUrl,
        intent: {
          trigger: "link",
          disposition: "current",
          requestedUrl: event.href,
          sourceTabId: tab.id,
          sourceArtifactId,
        },
      });
      return;
    }

    if (event.type !== "navigate") return;
    const { sourceUrl, sourceArtifactId } = frameContextRef.current;
    const intent: Partial<NavigationIntent> = {
      trigger: "link",
      disposition: event.disposition,
      requestedUrl: event.href,
      sourceTabId: tab.id,
      sourceArtifactId,
      linkText: event.linkText,
      ariaLabel: event.ariaLabel,
      surroundingText: event.context,
    };
    if (archivedSiteWorld) {
      setPendingArchivedNavigation({ href: event.href, baseUrl: sourceUrl, disposition: event.disposition, intent });
    } else if (event.disposition === "current") {
      navigate(tab.id, event.href, { baseUrl: sourceUrl, intent });
    } else {
      addTab(event.href, {
        disposition: event.disposition,
        opener: { tabId: tab.id, artifactId: sourceArtifactId },
        baseUrl: sourceUrl,
        intent,
      });
    }
  }, [addTab, archivedSiteWorld, markFrameReady, navigate, onLinkHover, openSettings, setLoadState, setTabMetadata, tab.generationJobId, tab.id]);

  const continueArchivedNavigation = useCallback((restore: boolean) => {
    const pending = pendingArchivedNavigation;
    if (!pending) return;
    if (restore && archivedSiteWorld) {
      if (!restoreSiteWorld(archivedSiteWorld.id, tab.id)) return;
      void activatePersistedSiteWorld(activeProfileId, archivedSiteWorld.id).catch((error) => console.warn("Could not persist SiteWorld restore", error));
    }
    setPendingArchivedNavigation(undefined);
    if (pending.disposition === "current") {
      navigate(tab.id, pending.href, { baseUrl: pending.baseUrl, intent: pending.intent });
    } else {
      addTab(pending.href, {
        disposition: pending.disposition,
        opener: { tabId: tab.id, artifactId: frameContextRef.current.sourceArtifactId },
        baseUrl: pending.baseUrl,
        intent: pending.intent,
      });
    }
  }, [activeProfileId, addTab, archivedSiteWorld, navigate, pendingArchivedNavigation, restoreSiteWorld, tab.id]);

  const ensureFrameConnection = useCallback(() => {
    const current = connectionRef.current;
    if (current && current.key === documentKey && compiledResult?.ok) {
      current.connection.updateRender(compiledResult.document.payload);
      return;
    }
    connectionRef.current?.connection.disconnect();
    connectionRef.current = null;
    if (!compiledResult?.ok || !documentKey) return;
    readyKeyRef.current = undefined;
    const { document } = compiledResult;
    const connection = connectArtifactFrame({
      getIframe: () => frameRef.current,
      artifactId: document.artifactId,
      nonce: document.nonce,
      render: document.payload,
      onEvent: (event) => handleFrameEvent(event, documentKey),
      onRuntimeRestart: () => {
        readyKeyRef.current = undefined;
        setReadyKey((current) => current === documentKey ? undefined : current);
      },
      onProtocolError: (message) => {
        if (readyKeyRef.current === documentKey) console.warn("Page bridge warning", message);
        else setBridgeFailure({ key: documentKey, message });
      },
    });
    connectionRef.current = { key: documentKey, connection };
  }, [compiledResult, documentKey, handleFrameEvent]);

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

  if (isGenerating && !hasPreview && !hasRecoverableArtifact) {
    return <NewTabPage />;
  }

  if (generationFailed && !hasRecoverableArtifact && !hasPreview) {
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
          title={compiledResult.document.payload.title}
          src={frameUrl}
          scrolling="auto"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          onLoad={ensureFrameConnection}
          onError={() => {
            setLoadState(tab.id, "error");
            setBridgeFailure({ key: documentKey ?? compiledResult.document.artifactId, message: "The generated document could not be loaded." });
          }}
        />
      )}
      {generationFailed && (hasRecoverableArtifact || hasPreview) && (
        <GenerationFailureNotice
          cancelled={job?.status === "cancelled"}
          partial={hasPreview}
          message={job?.error?.message ?? "The model did not return a usable artifact."}
          onRetry={job?.error?.retryable === false ? undefined : () => regenerate(tab.id)}
        />
      )}
      {contextMenu && (
        <PageContextMenu
          menu={contextMenu}
          canGoBack={tab.historyIndex > 0}
          canGoForward={tab.historyIndex < tab.history.length - 1}
          onDismiss={() => setContextMenu(undefined)}
          onBack={() => go(tab.id, -1)}
          onForward={() => go(tab.id, 1)}
          onReload={() => reload(tab.id)}
          onViewSource={() => setSourceOpen(true)}
          onOpenLink={contextMenu.href ? () => {
            const { sourceUrl, sourceArtifactId } = frameContextRef.current;
            const intent: Partial<NavigationIntent> = {
                trigger: "link",
                disposition: "background-tab",
                requestedUrl: contextMenu.href!,
                sourceTabId: tab.id,
                sourceArtifactId,
                linkText: contextMenu.linkText,
                ariaLabel: contextMenu.ariaLabel,
                surroundingText: contextMenu.context,
            };
            if (archivedSiteWorld) {
              setPendingArchivedNavigation({ href: contextMenu.href!, baseUrl: sourceUrl, disposition: "background-tab", intent });
            } else {
              addTab(contextMenu.href!, {
                disposition: "background-tab",
                opener: { tabId: tab.id, artifactId: sourceArtifactId },
                baseUrl: sourceUrl,
                intent,
              });
            }
          } : undefined}
        />
      )}
      <Dialog.Root open={Boolean(pendingArchivedNavigation)} onOpenChange={(open) => { if (!open) setPendingArchivedNavigation(undefined); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog" aria-describedby="archived-navigation-description">
            <Dialog.Title>Continue from an archived site?</Dialog.Title>
            <Dialog.Description id="archived-navigation-description">This snapshot belongs to an archived SiteWorld. Choose which identity should own the next generated page.</Dialog.Description>
            <div className="dialog__actions">
              <button className="button button--primary" type="button" onClick={() => continueArchivedNavigation(false)}>Use current identity</button>
              <button className="button" type="button" onClick={() => continueArchivedNavigation(true)}>Restore this identity</button>
              <button className="button" type="button" onClick={() => setPendingArchivedNavigation(undefined)}>Cancel</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <SourceDialog
        open={sourceOpen}
        onOpenChange={setSourceOpen}
        title={compiledResult.document.payload.title}
        source={compiledResult.isPreview && job?.previewHtml
          ? job.previewHtml
          : artifact?.html ?? compiledResult.document.payload.html}
      />
    </div>
  );
}

function GenerationFailureNotice({
  cancelled,
  partial,
  message,
  onRetry,
}: {
  cancelled: boolean;
  partial: boolean;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="generation-failure-notice" role="alert">
      <TriangleAlert aria-hidden="true" />
      <span>
        <strong>{cancelled ? "Generation stopped" : "Generation failed"}</strong>
        <small>{message} {partial ? "The partial result is still shown." : "The last complete version is still shown."}</small>
      </span>
      {onRetry && <button className="button" type="button" onClick={onRetry}>Try again</button>}
    </div>
  );
}

function PageContextMenu({
  menu,
  canGoBack,
  canGoForward,
  onDismiss,
  onBack,
  onForward,
  onReload,
  onViewSource,
  onOpenLink,
}: {
  menu: PageContextMenuState;
  canGoBack: boolean;
  canGoForward: boolean;
  onDismiss: () => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onViewSource: () => void;
  onOpenLink?: () => void;
}) {
  const run = (action: () => void) => {
    onDismiss();
    action();
  };
  const focusFirst = !onOpenLink && !canGoBack && !canGoForward;

  const moveFocus = (event: ReactKeyboardEvent<HTMLDivElement>, delta: -1 | 1) => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.menu__item:not(:disabled)'));
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(current + delta + items.length) % items.length]?.focus();
  };

  return (
    <>
      <div
        className="page-context-menu__backdrop"
        aria-hidden="true"
        onPointerDown={onDismiss}
        onContextMenu={(event) => {
          event.preventDefault();
          onDismiss();
        }}
      />
      <div
        className="menu page-context-menu"
        role="menu"
        aria-label={menu.href ? "Link actions" : "Page actions"}
        style={{ left: menu.left, top: menu.top }}
        onPointerDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            moveFocus(event, 1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            moveFocus(event, -1);
          } else if (event.key === "Home") {
            event.preventDefault();
            event.currentTarget.querySelector<HTMLButtonElement>('.menu__item:not(:disabled)')?.focus();
          } else if (event.key === "End") {
            event.preventDefault();
            const items = event.currentTarget.querySelectorAll<HTMLButtonElement>('.menu__item:not(:disabled)');
            items[items.length - 1]?.focus();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onDismiss();
          }
        }}
      >
        {onOpenLink && (
          <>
            <button className="menu__item" type="button" role="menuitem" autoFocus onClick={() => run(onOpenLink)}>
              <ExternalLink aria-hidden="true" /><span>Open link in new tab</span>
            </button>
            <div className="menu__separator" role="separator" />
          </>
        )}
        <button className="menu__item" type="button" role="menuitem" disabled={!canGoBack} autoFocus={!onOpenLink && canGoBack} onClick={() => run(onBack)}>
          <ArrowLeft aria-hidden="true" /><span>Back</span>
        </button>
        <button className="menu__item" type="button" role="menuitem" disabled={!canGoForward} autoFocus={!onOpenLink && !canGoBack && canGoForward} onClick={() => run(onForward)}>
          <ArrowRight aria-hidden="true" /><span>Forward</span>
        </button>
        <button className="menu__item" type="button" role="menuitem" autoFocus={focusFirst} onClick={() => run(onReload)}>
          <RefreshCw aria-hidden="true" /><span>Reload</span>
        </button>
        <div className="menu__separator" role="separator" />
        <button className="menu__item" type="button" role="menuitem" onClick={() => run(onViewSource)}>
          <Code2 aria-hidden="true" /><span>View source</span>
        </button>
      </div>
    </>
  );
}

function SourceDialog({
  open,
  onOpenChange,
  title,
  source,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  source: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog source-dialog" aria-describedby="artifact-source-description">
          <header className="source-dialog__header">
            <span><Code2 aria-hidden="true" /></span>
            <div>
              <Dialog.Title>Source: {title}</Dialog.Title>
              <Dialog.Description id="artifact-source-description">Page HTML displayed as inert text.</Dialog.Description>
            </div>
            <Dialog.Close className="dialog__close" aria-label="Close source"><X aria-hidden="true" /></Dialog.Close>
          </header>
          <pre tabIndex={0}><code>{source}</code></pre>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
