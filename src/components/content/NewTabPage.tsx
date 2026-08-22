import { FormEvent, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CircleDot,
  Compass,
  Radio,
  Search,
  Sparkles,
  Terminal,
  Waves,
} from "lucide-react";
import { motion } from "motion/react";
import {
  BROWSER_EXPERIENCE_REGISTRY,
  browserSearchProvider,
} from "../../browser/browser-experience-registry";
import { looksLikeUrl } from "../../lib/navigation";
import { useBrowserStore } from "../../store/browser-store";
import type { ThemeId } from "../../types/browser";

const PORTAL_ICONS = {
  compass: Compass,
  waves: Waves,
  search: Search,
  terminal: Terminal,
} as const;

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
  const PortalIcon = PORTAL_ICONS[portal.icon];
  const isRussian = useMemo(() => typeof navigator !== "undefined" && /^ru(?:-|$)/i.test(navigator.language), []);
  const search = searchPortal(theme, isRussian);
  const luckyBusy = luckyJob?.status === "queued" || luckyJob?.status === "running";
  const luckyFailed = luckyJob?.status === "failed";
  const luckyEmpty = luckyJob?.status === "completed";

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const input = address.trim();
    if (!input) return;
    navigate(activeTabId, looksLikeUrl(input) ? input : search.url(input));
  };

  return (
    <motion.section
      className="new-tab-page"
      initial={animations ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: animations ? 0.28 : 0 }}
    >
      <div className="new-tab-page__aura" aria-hidden="true" />
      <div className="new-tab-page__field" aria-hidden="true"><i /><i /><i /></div>
      <div className="new-tab-page__content">
        <header className="new-tab-page__masthead">
          <motion.div className="new-tab-page__mark" initial={animations ? { opacity: 0, y: -8 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: animations ? 0.28 : 0 }}>
            <img src="/brand/vibesurfer-logo.png" alt="vibesurfer" />
          </motion.div>
          {portal.signal && <span className="new-tab-page__signal"><Radio aria-hidden="true" />{portal.signal}</span>}
        </header>

        <div className="new-tab-page__hero">
          {portal.eyebrow && <p className="new-tab-page__eyebrow">{portal.eyebrow}</p>}
          <h1>{portal.title[0]}<span>{portal.title[1]}</span></h1>
          {portal.lede && <p className="new-tab-page__lede">{portal.lede}</p>}
        </div>

        <form className="generation-composer" onSubmit={submit}>
          <PortalIcon aria-hidden="true" />
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder={`${portal.placeholder} · ${search.name}`}
            aria-label={portal.inputLabel}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            className="generation-composer__lucky"
            type="button"
            onClick={() => discoverLucky(activeTabId)}
            disabled={luckyBusy}
          >
            <Sparkles aria-hidden="true" />
            <span>{luckyBusy
              ? (isRussian ? "Ищем путь…" : "Finding a route…")
              : luckyFailed || luckyEmpty
                ? (isRussian ? "Попробовать снова" : "Try again")
                : (isRussian ? "Мне повезёт" : "I’m Feeling Lucky")}</span>
          </button>
          <button className="generation-composer__submit" type="submit" aria-label="Open address" disabled={!address.trim()}>
            <ArrowRight aria-hidden="true" />
          </button>
        </form>

        {(luckyFailed || luckyEmpty) && luckyJob && (
          <div className="lucky-outcome" role="status">
            <span>{luckyFailed
              ? luckyJob.error?.message ?? (isRussian ? "Не удалось найти путь." : "A route could not be found.")
              : (isRussian ? "В этот раз подходящих адресов не нашлось." : "No safe destinations were returned this time.")}</span>
            <button type="button" onClick={() => openActivity(luckyJob.id)}>
              {isRussian ? "Открыть журнал" : "Open activity"}
            </button>
          </div>
        )}

        <section className="hallunet-routes" aria-label={portal.routesLabel}>
          <div className="hallunet-routes__heading">
            <span>{portal.routesLabel}</span>
            <i />
          </div>
          <div className="hallunet-routes__grid">
            {portal.routes.map((route, index) => (
              <button key={route.address} type="button" onClick={() => navigate(activeTabId, route.address)}>
                <span className="hallunet-route__index">0{index + 1}</span>
                <span className="hallunet-route__copy">
                  <strong>{route.label}</strong>
                  <code>{route.address}</code>
                  <small>{route.note}</small>
                </span>
                <ArrowUpRight aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      </div>

      {(portal.status || portal.footer) && (
        <footer className="new-tab-page__principles">
          {portal.status && <span><CircleDot aria-hidden="true" />{portal.status}</span>}
          {portal.footer && <span>{portal.footer}</span>}
        </footer>
      )}
    </motion.section>
  );
}

export function searchPortal(theme: ThemeId, russian: boolean): { name: string; url: (query: string) => string } {
  const provider = browserSearchProvider(theme, russian);
  return {
    name: provider.name,
    url: (query) => `${provider.baseUrl}?${provider.queryParameter}=${encodeURIComponent(query)}`,
  };
}
