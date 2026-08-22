import { CircleAlert, LoaderCircle, Pause, Play, Radio, RefreshCw } from "lucide-react";
import { useBrowserCommand } from "../../browser/browser-command-registry";
import {
  refreshDynamicPage,
  setDynamicPagePaused,
  useDynamicRuntimeStore,
} from "../../dynamic/runtime";
import { activatePersistedSiteWorld } from "../../generation/host-api";
import { useBrowserStore } from "../../store/browser-store";
import type {
  BrowserTab,
  DynamicBadgeStatus,
  DynamicMode,
  PageArtifact,
} from "../../types/browser";
import { ConfirmDialog } from "../ui/Dialog";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "../ui/Menu";
import { useControllableState } from "../ui/useControllableState";

export interface DynamicStatusControlProps {
  status: DynamicBadgeStatus;
  globalMode: DynamicMode;
  explicitlyPaused: boolean;
  lastUpdatedLabel: string;
  nextUpdateLabel: string;
  error?: string;
  requiresRestoreConfirmation?: boolean;
  onPausedChange: (paused: boolean) => void;
  onRefresh: () => void;
  onChooseModel?: () => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  confirmationOpen?: boolean;
  defaultConfirmationOpen?: boolean;
  onConfirmationOpenChange?: (open: boolean) => void;
}

export function DynamicStatusControl({
  status,
  globalMode,
  explicitlyPaused,
  lastUpdatedLabel,
  nextUpdateLabel,
  error,
  requiresRestoreConfirmation = false,
  onPausedChange,
  onRefresh,
  onChooseModel,
  open,
  defaultOpen,
  onOpenChange,
  confirmationOpen,
  defaultConfirmationOpen = false,
  onConfirmationOpenChange,
}: DynamicStatusControlProps) {
  const [restoreConfirmationOpen, setRestoreConfirmationOpen] = useControllableState({
    value: confirmationOpen,
    defaultValue: defaultConfirmationOpen,
    onChange: onConfirmationOpenChange,
  });
  const label = status === "live"
    ? "Live"
    : status === "paused"
      ? "Paused"
      : status === "updating"
        ? "Updating"
        : "Error";
  const Icon = status === "updating"
    ? LoaderCircle
    : status === "error"
      ? CircleAlert
      : status === "paused"
        ? Pause
        : Radio;
  const updatesDisabled = globalMode === "off";

  const requestRefresh = () => {
    if (requiresRestoreConfirmation) setRestoreConfirmationOpen(true);
    else onRefresh();
  };

  return (
    <>
      <Menu
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
        ariaLabel="Live regions"
        sideOffset={8}
        className="dynamic-menu"
        trigger={(
          <button
            className={`dynamic-status-control dynamic-status-control--${status}`}
            type="button"
            aria-label={`Live regions: ${label}`}
            data-dynamic-status={status}
          >
            <Icon className={status === "updating" ? "is-spinning" : undefined} aria-hidden="true" />
            <span>{label}</span>
          </button>
        )}
      >
        <MenuLabel>Live regions</MenuLabel>
        <div className="dynamic-menu__times">
          <span>Last update <strong>{lastUpdatedLabel}</strong></span>
          <span>Next update <strong>{status === "paused" ? "Paused" : nextUpdateLabel}</strong></span>
        </div>
        {error && <div className="dynamic-menu__error" role="alert">{error}</div>}
        <MenuSeparator />
        <MenuItem
          disabled={updatesDisabled}
          onSelect={() => onPausedChange(!explicitlyPaused)}
        >
          {explicitlyPaused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
          <span>{explicitlyPaused ? "Resume this page" : "Pause this page"}</span>
        </MenuItem>
        <MenuItem
          disabled={updatesDisabled || status === "updating"}
          onSelect={requestRefresh}
        >
          <RefreshCw aria-hidden="true" /><span>Refresh now</span>
        </MenuItem>
        {status === "error" && onChooseModel && (
          <MenuItem onSelect={onChooseModel}>
            <Radio aria-hidden="true" /><span>Choose model</span>
          </MenuItem>
        )}
      </Menu>
      <ConfirmDialog
        open={restoreConfirmationOpen}
        onOpenChange={setRestoreConfirmationOpen}
        title="Restore this SiteWorld?"
        description="This page belongs to an archived SiteWorld. Restoring it will reactivate the page identity before live regions refresh."
        confirmLabel="Restore and refresh"
        onConfirm={onRefresh}
      />
    </>
  );
}

export interface ConnectedDynamicStatusControlProps {
  tab: BrowserTab;
  artifact?: PageArtifact;
}

export function ConnectedDynamicStatusControl({ tab, artifact }: ConnectedDynamicStatusControlProps) {
  const runtimeStatus = useDynamicRuntimeStore((state) => state.tabStatus[tab.id]);
  const explicitlyPaused = useDynamicRuntimeStore((state) => state.pagePaused[tab.id] === true);
  const mode = useBrowserStore((state) => state.generationSettings.dynamicMode);
  const activeProfileId = useBrowserStore((state) => state.activeProfileId);
  const siteWorld = useBrowserStore((state) => artifact ? state.siteWorlds[artifact.siteWorldId] : undefined);
  const restoreSiteWorld = useBrowserStore((state) => state.restoreSiteWorld);
  const chooseModel = useBrowserCommand("open-model-picker");

  if (!artifact?.dynamicManifest
      || (artifact.dynamicManifest.regions.length === 0 && artifact.dynamicManifest.actions.length === 0)) {
    return null;
  }

  const status = runtimeStatus?.status ?? (mode === "off" ? "paused" : "live");
  const refresh = () => {
    if (siteWorld?.state === "archived") {
      if (!restoreSiteWorld(siteWorld.id, tab.id)) return;
      void activatePersistedSiteWorld(activeProfileId, siteWorld.id).catch((error) => {
        console.warn("Could not persist SiteWorld restore", error);
      });
    }
    refreshDynamicPage(tab.id);
  };

  return (
    <DynamicStatusControl
      status={status}
      globalMode={mode}
      explicitlyPaused={explicitlyPaused}
      lastUpdatedLabel={dateLabel(runtimeStatus?.lastUpdatedAt)}
      nextUpdateLabel={dateLabel(runtimeStatus?.nextUpdateAt)}
      error={runtimeStatus?.error?.message}
      requiresRestoreConfirmation={siteWorld?.state === "archived"}
      onPausedChange={(paused) => setDynamicPagePaused(tab.id, paused)}
      onRefresh={refresh}
      onChooseModel={chooseModel.execute}
    />
  );
}

function dateLabel(value: string | undefined): string {
  return value
    ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—";
}
