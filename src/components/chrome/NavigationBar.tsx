import { ArrowLeft, ArrowRight, Home, LoaderCircle, RotateCw, X } from "lucide-react";
import { useBrowserStore } from "../../store/browser-store";
import type { BrowserTab } from "../../types/browser";
import { IconButton } from "../ui/IconButton";
import { AddressBar } from "./AddressBar";
import { AppMenu } from "./AppMenu";
import { ModelControl } from "./ModelControl";
import { ProfileMenu } from "./ProfileMenu";

export function NavigationBar({ tab }: { tab: BrowserTab }) {
  const go = useBrowserStore((state) => state.go);
  const navigate = useBrowserStore((state) => state.navigate);
  const reload = useBrowserStore((state) => state.reload);
  const setLoadState = useBrowserStore((state) => state.setLoadState);
  const canGoBack = tab.historyIndex > 0;
  const canGoForward = tab.historyIndex < tab.history.length - 1;

  return (
    <nav className="navigation-bar" aria-label="Browser navigation">
      <div className="navigation-bar__cluster">
        <IconButton label="Back" disabled={!canGoBack} onClick={() => go(tab.id, -1)}><ArrowLeft aria-hidden="true" /></IconButton>
        <IconButton label="Forward" disabled={!canGoForward} onClick={() => go(tab.id, 1)}><ArrowRight aria-hidden="true" /></IconButton>
        {tab.loadState === "loading" ? (
          <IconButton label="Stop" onClick={() => setLoadState(tab.id, "idle")}><X aria-hidden="true" /></IconButton>
        ) : (
          <IconButton label={tab.kind === "generated" ? "Reload artifact" : "Reload"} onClick={() => reload(tab.id)}>
            <RotateCw aria-hidden="true" />
          </IconButton>
        )}
        <IconButton label="Home" onClick={() => navigate(tab.id, "vibe://new-tab")}><Home aria-hidden="true" /></IconButton>
      </div>
      <AddressBar tab={tab} />
      <ModelControl />
      <ProfileMenu />
      <AppMenu />
      {tab.loadState === "loading" && <LoaderCircle className="navigation-bar__activity" aria-hidden="true" />}
    </nav>
  );
}
