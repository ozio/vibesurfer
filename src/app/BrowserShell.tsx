import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { BROWSER_EXPERIENCE_REGISTRY } from "../browser/browser-experience-registry";
import { handleBrowserCommandKeydown } from "../browser/browser-command-registry";
import {
  BrowserServicesProvider,
  useBrowserServices,
  withBrowserServicePlatform,
} from "../browser/browser-services";
import { BrowserThemeRoot } from "../browser/BrowserThemeRoot";
import { BrowserStatusBar } from "../components/chrome/BrowserStatusBar";
import { ClassicMenuBar, ClassicTabBar } from "../components/chrome/ClassicChrome";
import { NavigationBar } from "../components/chrome/NavigationBar";
import { TabStrip } from "../components/chrome/TabStrip";
import { TitleBar } from "../components/chrome/TitleBar";
import { PageSurface } from "../components/content/PageSurface";
import { VerticalSidebar } from "../components/content/VerticalSidebar";
import { modelCatalog } from "../data/catalog";
import { useBrowserStore } from "../store/browser-store";
import type { Platform } from "../types/browser";

const SettingsPage = lazy(() =>
  import("../components/settings/SettingsPage").then((module) => ({ default: module.SettingsPage })),
);

export interface BrowserShellProps {
  platform?: Platform;
}

export function BrowserShell({ platform: platformOverride }: BrowserShellProps) {
  const inheritedServices = useBrowserServices();
  const tabs = useBrowserStore((state) => state.tabs);
  const activeTabId = useBrowserStore((state) => state.activeTabId);
  const preferences = useBrowserStore((state) => state.preferences);
  const activeModelId = useBrowserStore((state) => state.activeModelId);
  const activeProfileId = useBrowserStore((state) => state.activeProfileId);
  const profiles = useBrowserStore((state) => state.profiles);
  const providerConnections = useBrowserStore((state) => state.providerConnections);
  const artifacts = useBrowserStore((state) => state.artifacts);
  const generationJobs = useBrowserStore((state) => state.generationJobs);
  const navigate = useNavigate();
  const location = useLocation();
  const services = useMemo(
    () => withBrowserServicePlatform(inheritedServices, platformOverride ?? inheritedServices.platform),
    [inheritedServices, platformOverride],
  );
  const platform = services.platform;
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const models = useMemo(() => modelCatalog(providerConnections, activeProfileId), [activeProfileId, providerConnections]);
  const model = models.find((item) => item.id === activeModelId) ?? models[0];
  const profile = profiles.find((item) => item.id === activeProfileId) ?? profiles[0]!;
  const isClassicInternetExplorer = BROWSER_EXPERIENCE_REGISTRY[preferences.theme].chrome.variant === "ie-classic";
  const [hoveredLink, setHoveredLink] = useState<string>();
  const activeArtifactId = activeTab?.artifactId ?? activeTab?.fallbackArtifactId;
  const activeArtifact = activeArtifactId ? artifacts[activeArtifactId] : undefined;
  const activeJob = activeTab?.generationJobId ? generationJobs[activeTab.generationJobId] : undefined;

  useEffect(() => setHoveredLink(undefined), [activeTabId]);

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
    if (services.runtime === "tauri") return;
    const handler = (event: KeyboardEvent) => {
      handleBrowserCommandKeydown(event, services);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [services]);

  if (!activeTab) return null;

  return (
    <BrowserServicesProvider services={services}>
      <BrowserThemeRoot
        theme={preferences.theme}
        colorScheme={preferences.colorScheme}
        density={preferences.density}
        tabLayout={preferences.tabLayout}
        motion={preferences.animations ? "full" : "reduced"}
      >
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
      </BrowserThemeRoot>
    </BrowserServicesProvider>
  );
}

function SettingsSurface() {
  return (
    <Suspense fallback={<div className="settings-loading"><span /></div>}>
      <SettingsPage />
    </Suspense>
  );
}
