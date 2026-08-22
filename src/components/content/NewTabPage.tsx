import { useMemo, useState } from "react";
import {
  BROWSER_EXPERIENCE_REGISTRY,
  browserSearchProvider,
} from "../../browser/browser-experience-registry";
import { looksLikeUrl } from "../../lib/navigation";
import { useBrowserStore } from "../../store/browser-store";
import type { ThemeId } from "../../types/browser";
import {
  DEFAULT_NEW_TAB_COPY,
  NewTabSurface,
  type NewTabCopy,
  type NewTabLuckyStatus,
} from "./NewTabSurface";

export function NewTabPage() {
  const activeTabId = useBrowserStore((state) => state.activeTabId);
  const theme = useBrowserStore((state) => state.preferences.theme);
  const animations = useBrowserStore((state) => state.preferences.animations);
  const navigate = useBrowserStore((state) => state.navigate);
  const discoverLucky = useBrowserStore((state) => state.discoverLucky);
  const openActivity = useBrowserStore((state) => state.openActivity);
  const luckyJob = useBrowserStore((state) => {
    const tab = state.tabs.find((item) => item.id === state.activeTabId);
    return tab?.luckyJobId ? state.generationJobs[tab.luckyJobId] : undefined;
  });
  const [address, setAddress] = useState("");
  const portal = BROWSER_EXPERIENCE_REGISTRY[theme].portal;
  const isRussian = useMemo(() => typeof navigator !== "undefined" && /^ru(?:-|$)/i.test(navigator.language), []);
  const search = searchPortal(theme, isRussian);
  const luckyStatus: NewTabLuckyStatus = luckyJob?.status === "queued" || luckyJob?.status === "running"
    ? "busy"
    : luckyJob?.status === "failed"
      ? "failed"
      : luckyJob?.status === "completed"
        ? "empty"
        : "idle";
  const copy = isRussian ? RUSSIAN_NEW_TAB_COPY : DEFAULT_NEW_TAB_COPY;

  return (
    <NewTabSurface
      portal={portal}
      searchName={search.name}
      address={address}
      luckyStatus={luckyStatus}
      luckyMessage={luckyStatus === "failed" ? luckyJob?.error?.message : undefined}
      animations={animations}
      copy={copy}
      onAddressChange={setAddress}
      onSubmit={(input) => navigate(activeTabId, looksLikeUrl(input) ? input : search.url(input))}
      onLucky={() => discoverLucky(activeTabId)}
      onOpenActivity={() => { if (luckyJob) openActivity(luckyJob.id); }}
      onOpenRoute={(route) => navigate(activeTabId, route)}
    />
  );
}

const RUSSIAN_NEW_TAB_COPY: NewTabCopy = {
  luckyIdle: "Мне повезёт",
  luckyBusy: "Ищем путь…",
  luckyRetry: "Попробовать снова",
  openActivity: "Открыть журнал",
  failedFallback: "Не удалось найти путь.",
  emptyFallback: "В этот раз подходящих адресов не нашлось.",
};

export function searchPortal(theme: ThemeId, russian: boolean): { name: string; url: (query: string) => string } {
  const provider = browserSearchProvider(theme, russian);
  return {
    name: provider.name,
    url: (query) => `${provider.baseUrl}?${provider.queryParameter}=${encodeURIComponent(query)}`,
  };
}
