import { ArrowLeft, ArrowRight, Home, LoaderCircle, RotateCw, X } from "lucide-react";
import { useBrowserCommand } from "../../browser/browser-command-registry";
import { useBrowserStore } from "../../store/browser-store";
import type { BrowserTab } from "../../types/browser";
import { IconButton } from "../ui/IconButton";
import { AddressBar } from "./AddressBar";
import { AppMenu } from "./AppMenu";
import { ModelControl } from "./ModelControl";
import { ProfileMenu } from "./ProfileMenu";
import { DynamicBadge } from "./DynamicBadge";
import { GenerationModeControl } from "./GenerationModeControl";

export function NavigationBar({ tab }: { tab: BrowserTab }) {
  const back = useBrowserCommand("back", { tabId: tab.id });
  const forward = useBrowserCommand("forward", { tabId: tab.id });
  const reload = useBrowserCommand("reload", { tabId: tab.id });
  const stop = useBrowserCommand("stop", { tabId: tab.id });
  const home = useBrowserCommand("home", { tabId: tab.id });
  const artifact = useBrowserStore((state) => {
    const id = tab.artifactId ?? tab.fallbackArtifactId;
    return id ? state.artifacts[id] : undefined;
  });
  return (
    <nav className="navigation-bar" aria-label="Browser navigation">
      <div className="navigation-bar__cluster">
        <IconButton label={back.label} disabled={!back.enabled} onClick={back.execute}><ArrowLeft aria-hidden="true" /></IconButton>
        <IconButton label={forward.label} disabled={!forward.enabled} onClick={forward.execute}><ArrowRight aria-hidden="true" /></IconButton>
        {tab.loadState === "loading" ? (
          <IconButton label={stop.label} disabled={!stop.enabled} onClick={stop.execute}><X aria-hidden="true" /></IconButton>
        ) : (
          <IconButton label={reload.label} disabled={!reload.enabled} onClick={reload.execute}>
            <RotateCw aria-hidden="true" />
          </IconButton>
        )}
        <IconButton label={home.label} disabled={!home.enabled} onClick={home.execute}><Home aria-hidden="true" /></IconButton>
      </div>
      <AddressBar tab={tab} />
      <DynamicBadge tab={tab} artifact={artifact} />
      <GenerationModeControl />
      <ModelControl />
      <ProfileMenu />
      <AppMenu />
      {tab.loadState === "loading" && <LoaderCircle className="navigation-bar__activity" aria-hidden="true" />}
    </nav>
  );
}
