import { CircleAlert, LoaderCircle, Pause, Play, Radio, RefreshCw } from "lucide-react";
import { DropdownMenu } from "radix-ui";

import {
  refreshDynamicPage,
  setDynamicPagePaused,
  useDynamicRuntimeStore,
} from "../../dynamic/runtime";
import { activatePersistedSiteWorld } from "../../generation/host-api";
import { useBrowserStore } from "../../store/browser-store";
import type { BrowserTab, PageArtifact } from "../../types/browser";

export function DynamicBadge({ tab, artifact }: { tab: BrowserTab; artifact?: PageArtifact }) {
  const runtimeStatus = useDynamicRuntimeStore((state) => state.tabStatus[tab.id]);
  const explicitlyPaused = useDynamicRuntimeStore((state) => state.pagePaused[tab.id] === true);
  const mode = useBrowserStore((state) => state.generationSettings.dynamicMode);
  const activeProfileId = useBrowserStore((state) => state.activeProfileId);
  const siteWorld = useBrowserStore((state) => artifact ? state.siteWorlds[artifact.siteWorldId] : undefined);
  const restoreSiteWorld = useBrowserStore((state) => state.restoreSiteWorld);
  if (!artifact?.dynamicManifest || (artifact.dynamicManifest.regions.length === 0 && artifact.dynamicManifest.actions.length === 0)) return null;
  const status = runtimeStatus?.status ?? (mode === "off" ? "paused" : "live");
  const label = status === "live" ? "Live" : status === "paused" ? "Paused" : status === "updating" ? "Updating" : "Error";
  const Icon = status === "updating" ? LoaderCircle : status === "error" ? CircleAlert : status === "paused" ? Pause : Radio;
  const dateLabel = (value: string | undefined) => value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
  const refresh = () => {
    if (siteWorld?.state === "archived") {
      if (!window.confirm("This page belongs to an archived SiteWorld. Restore its identity before refreshing live regions?")) return;
      if (!restoreSiteWorld(siteWorld.id, tab.id)) return;
      void activatePersistedSiteWorld(activeProfileId, siteWorld.id).catch((error) => console.warn("Could not persist SiteWorld restore", error));
    }
    refreshDynamicPage(tab.id);
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className={`dynamic-badge dynamic-badge--${status}`} type="button" aria-label={`Live regions: ${label}`}>
          <Icon className={status === "updating" ? "is-spinning" : undefined} aria-hidden="true" />
          <span>{label}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu dynamic-menu" align="end" sideOffset={8} collisionPadding={10}>
          <DropdownMenu.Label className="menu__label">Live regions</DropdownMenu.Label>
          <div className="dynamic-menu__times">
            <span>Last update <strong>{dateLabel(runtimeStatus?.lastUpdatedAt)}</strong></span>
            <span>Next update <strong>{status === "paused" ? "Paused" : dateLabel(runtimeStatus?.nextUpdateAt)}</strong></span>
          </div>
          {runtimeStatus?.error && <div className="dynamic-menu__error" role="alert">{runtimeStatus.error.message}</div>}
          <DropdownMenu.Separator className="menu__separator" />
          <DropdownMenu.Item className="menu__item" disabled={mode === "off"} onSelect={() => setDynamicPagePaused(tab.id, !explicitlyPaused)}>
            {explicitlyPaused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
            <span>{explicitlyPaused ? "Resume this page" : "Pause this page"}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item className="menu__item" disabled={mode === "off" || status === "updating"} onSelect={refresh}>
            <RefreshCw aria-hidden="true" /><span>Refresh now</span>
          </DropdownMenu.Item>
          {status === "error" && (
            <DropdownMenu.Item className="menu__item" onSelect={() => window.dispatchEvent(new Event("vibesurfer:open-model-picker"))}>
              <Radio aria-hidden="true" /><span>Choose model</span>
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Arrow className="menu__arrow" />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
