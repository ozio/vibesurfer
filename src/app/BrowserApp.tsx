import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { modelCatalog } from "../data/catalog";
import { detectPlatform, isTauri, syncNativeWindowTheme } from "../lib/platform";
import { useGenerationRuntime } from "../generation/use-generation-runtime";
import { useDynamicRuntime } from "../dynamic/use-dynamic-runtime";
import { useBrowserStore } from "../store/browser-store";
import { NavigationBar } from "../components/chrome/NavigationBar";
import { BrowserStatusBar } from "../components/chrome/BrowserStatusBar";
import { ClassicMenuBar, ClassicTabBar } from "../components/chrome/ClassicChrome";
import { TabStrip } from "../components/chrome/TabStrip";
import { TitleBar } from "../components/chrome/TitleBar";
import { PageSurface } from "../components/content/PageSurface";
import { VerticalSidebar } from "../components/content/VerticalSidebar";
import { openBlankTabAndFocus } from "./browser-actions";

const SettingsPage = lazy(() =>
  import("../components/settings/SettingsPage").then((module) => ({ default: module.SettingsPage })),
);

export function BrowserApp() {
  useGenerationRuntime();
  useDynamicRuntime();
  const tabs = useBrowserStore((state) => state.tabs);
  const activeTabId = useBrowserStore((state) => state.activeTabId);
  const preferences = useBrowserStore((state) => state.preferences);
  const activeModelId = useBrowserStore((state) => state.activeModelId);
  const activeProfileId = useBrowserStore((state) => state.activeProfileId);
  const profiles = useBrowserStore((state) => state.profiles);
  const providerConnections = useBrowserStore((state) => state.providerConnections);
  const closeTab = useBrowserStore((state) => state.closeTab);
  const activateTab = useBrowserStore((state) => state.activateTab);
  const reload = useBrowserStore((state) => state.reload);
  const openSettings = useBrowserStore((state) => state.openSettings);
  const openHistory = useBrowserStore((state) => state.openHistory);
  const artifacts = useBrowserStore((state) => state.artifacts);
  const generationJobs = useBrowserStore((state) => state.generationJobs);
  const navigate = useNavigate();
  const location = useLocation();
  const platform = useMemo(detectPlatform, []);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const models = useMemo(() => modelCatalog(providerConnections, activeProfileId), [activeProfileId, providerConnections]);
  const model = models.find((item) => item.id === activeModelId) ?? models[0];
  const profile = profiles.find((item) => item.id === activeProfileId) ?? profiles[0]!;
  const isClassicInternetExplorer = preferences.theme === "ie-classic";
  const [hoveredLink, setHoveredLink] = useState<string>();
  const activeArtifactId = activeTab?.artifactId ?? activeTab?.fallbackArtifactId;
  const activeArtifact = activeArtifactId ? artifacts[activeArtifactId] : undefined;
  const activeJob = activeTab?.generationJobId ? generationJobs[activeTab.generationJobId] : undefined;

  useEffect(() => setHoveredLink(undefined), [activeTabId]);

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
    void syncNativeWindowTheme(preferences.theme).catch((error: unknown) => {
      console.warn("Could not apply the native window shape", error);
    });
  }, [preferences.theme]);

  useEffect(() => {
    if (!activeTab) return;
    if (activeTab.kind === "settings") {
      const section = activeTab.location.split("/").pop() || "general";
      const next = `/settings/${section}`;
      if (location.pathname !== next) navigate(next, { replace: true });
    } else if (location.pathname !== "/") {
      navigate("/", { replace: true });
    }
  }, [activeTab, location.pathname, navigate]);

  useEffect(() => {
    const root = document.documentElement;
    const usePointerModality = () => {
      root.dataset.inputModality = "pointer";
    };
    const useKeyboardModality = () => {
      root.dataset.inputModality = "keyboard";
    };
    window.addEventListener("pointerdown", usePointerModality, true);
    window.addEventListener("keydown", useKeyboardModality, true);
    return () => {
      window.removeEventListener("pointerdown", usePointerModality, true);
      window.removeEventListener("keydown", useKeyboardModality, true);
      delete root.dataset.inputModality;
    };
  }, []);

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
        openBlankTabAndFocus();
      } else if (key === "w") {
        event.preventDefault();
        closeTab(activeTabId);
      } else if (key === "r") {
        event.preventDefault();
        reload(activeTabId);
      } else if (key === ",") {
        event.preventDefault();
        openSettings("general");
      } else if (key === "y") {
        event.preventDefault();
        openHistory();
      } else if (key === "tab") {
        event.preventDefault();
        const index = tabs.findIndex((tab) => tab.id === activeTabId);
        const direction = event.shiftKey ? -1 : 1;
        activateTab(tabs[(index + direction + tabs.length) % tabs.length].id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activateTab, activeTabId, closeTab, openHistory, openSettings, platform, reload, tabs]);

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
            <Route path="/" element={activeTab.kind === "settings" ? <SettingsSurface /> : <PageSurface tab={activeTab} onLinkHover={setHoveredLink} />} />
            <Route path="/settings/:section?" element={<SettingsSurface />} />
          </Routes>
        </div>
      </div>
      <BrowserStatusBar
        location={activeTab.kind === "settings" ? "Settings" : activeTab.location}
        hoveredLink={hoveredLink}
        profileName={profile.name}
        modelName={model.name}
        artifact={activeArtifact}
        activeJob={activeJob}
      />
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
