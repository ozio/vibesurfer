import { lazy, Suspense, useEffect, useMemo } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { modelCatalog, PROFILES } from "../data/catalog";
import { detectPlatform, isTauri } from "../lib/platform";
import { useGenerationRuntime } from "../generation/use-generation-runtime";
import { useBrowserStore } from "../store/browser-store";
import { NavigationBar } from "../components/chrome/NavigationBar";
import { ClassicMenuBar, ClassicTabBar } from "../components/chrome/ClassicChrome";
import { TabStrip } from "../components/chrome/TabStrip";
import { TitleBar } from "../components/chrome/TitleBar";
import { PageSurface } from "../components/content/PageSurface";
import { VerticalSidebar } from "../components/content/VerticalSidebar";

const SettingsPage = lazy(() =>
  import("../components/settings/SettingsPage").then((module) => ({ default: module.SettingsPage })),
);

export function BrowserApp() {
  useGenerationRuntime();
  const tabs = useBrowserStore((state) => state.tabs);
  const activeTabId = useBrowserStore((state) => state.activeTabId);
  const preferences = useBrowserStore((state) => state.preferences);
  const activeModelId = useBrowserStore((state) => state.activeModelId);
  const activeProfileId = useBrowserStore((state) => state.activeProfileId);
  const providerConnections = useBrowserStore((state) => state.providerConnections);
  const addTab = useBrowserStore((state) => state.addTab);
  const closeTab = useBrowserStore((state) => state.closeTab);
  const activateTab = useBrowserStore((state) => state.activateTab);
  const reload = useBrowserStore((state) => state.reload);
  const openSettings = useBrowserStore((state) => state.openSettings);
  const navigate = useNavigate();
  const location = useLocation();
  const platform = useMemo(detectPlatform, []);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const models = useMemo(() => modelCatalog(providerConnections, activeProfileId), [activeProfileId, providerConnections]);
  const model = models.find((item) => item.id === activeModelId) ?? models[0];
  const artifactModel = models.find((item) => item.id === activeTab?.generatedWith)?.name;
  const profile = PROFILES.find((item) => item.id === activeProfileId) ?? PROFILES[0];
  const isClassicInternetExplorer = preferences.theme === "ie-classic";

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = preferences.theme;
    root.dataset.platform = platform;
    root.dataset.tabs = preferences.tabLayout;
    root.dataset.density = preferences.density;
    root.dataset.colorScheme = preferences.colorScheme;
    root.dataset.runtime = isTauri() ? "tauri" : "web";
    root.classList.toggle("reduce-motion", !preferences.animations);
  }, [platform, preferences]);

  useEffect(() => {
    if (!activeTab) return;
    if (activeTab.kind === "settings") {
      const section = activeTab.location.split("/").pop() || "appearance";
      const next = `/settings/${section}`;
      if (location.pathname !== next) navigate(next, { replace: true });
    } else if (location.pathname !== "/") {
      navigate("/", { replace: true });
    }
  }, [activeTab, location.pathname, navigate]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const command = platform === "macos" ? event.metaKey : event.ctrlKey;
      if (!command) return;
      const key = event.key.toLowerCase();
      if (key === "l") {
        event.preventDefault();
        window.dispatchEvent(new Event("vibesurfer:focus-address"));
      } else if (key === "t") {
        event.preventDefault();
        addTab();
      } else if (key === "w") {
        event.preventDefault();
        closeTab(activeTabId);
      } else if (key === "r") {
        event.preventDefault();
        reload(activeTabId);
      } else if (key === ",") {
        event.preventDefault();
        openSettings("appearance");
      } else if (key === "tab") {
        event.preventDefault();
        const index = tabs.findIndex((tab) => tab.id === activeTabId);
        const direction = event.shiftKey ? -1 : 1;
        activateTab(tabs[(index + direction + tabs.length) % tabs.length].id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activateTab, activeTabId, addTab, closeTab, openSettings, platform, reload, tabs]);

  if (!activeTab) return null;

  return (
    <div className={`browser-window browser-window--${preferences.tabLayout}`}>
      <TitleBar platform={platform} layout={preferences.tabLayout} title={activeTab.title}>
        {!isClassicInternetExplorer && <TabStrip orientation="horizontal" />}
      </TitleBar>
      {isClassicInternetExplorer && <ClassicMenuBar />}
      <NavigationBar tab={activeTab} />
      {isClassicInternetExplorer && preferences.tabLayout === "horizontal" && (
        <ClassicTabBar><TabStrip orientation="horizontal" /></ClassicTabBar>
      )}
      <div className="browser-workspace">
        {preferences.tabLayout === "vertical" && <VerticalSidebar />}
        <div className="content-viewport">
          <Routes>
            <Route path="/" element={activeTab.kind === "settings" ? <SettingsSurface /> : <PageSurface tab={activeTab} />} />
            <Route path="/settings/:section?" element={<SettingsSurface />} />
          </Routes>
        </div>
      </div>
      <footer className="browser-statusbar">
        <div className="browser-statusbar__modern">
          <span><i className="status-orb" /> {profile.name}</span>
          <span>{activeTab.kind === "remote" ? "Live site opens externally" : activeTab.kind === "generated" ? `Generated with ${artifactModel ?? model.name}` : "Browser UI"}</span>
          <span>{model.name}</span>
        </div>
        <div className="browser-statusbar__classic" aria-hidden="true">
          <span><i className="classic-status-icon">e</i>Done</span>
          <span className="classic-status-zone"><i className="classic-status-globe" />Internet</span>
          <span className="classic-status-zoom">⌕&nbsp; 100%</span>
          <i className="classic-resize-grip" />
        </div>
      </footer>
    </div>
  );
}

function SettingsSurface() {
  return (
    <Suspense fallback={<div className="settings-loading"><span /></div>}>
      <SettingsPage />
    </Suspense>
  );
}
