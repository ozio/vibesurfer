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
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { looksLikeUrl } from "../../lib/navigation";
import { useBrowserStore } from "../../store/browser-store";
import type { ThemeId } from "../../types/browser";

interface PortalRoute {
  label: string;
  address: string;
  note: string;
}

interface PortalCopy {
  eyebrow: string;
  title: [string, string];
  lede: string;
  placeholder: string;
  inputLabel: string;
  signal: string;
  status: string;
  footer: string;
  routesLabel: string;
  icon: LucideIcon;
  routes: PortalRoute[];
}

const portals: Record<ThemeId, PortalCopy> = {
  native: {
    eyebrow: "HALLUNET / OPEN ACCESS",
    title: ["There is another", "internet in here."],
    lede: "Type an address that should not exist. Somewhere beyond consensus, it already does.",
    placeholder: "Enter an impossible address or search…",
    inputLabel: "Enter a Hallunet address or search",
    signal: "Reality index drifting",
    status: "Unmapped network",
    footer: "No map. No canon. Follow the links.",
    routesLabel: "Unstable coordinates",
    icon: Compass,
    routes: [
      {
        label: "Unknown search",
        address: "google.com/search?q=three-byte+metacode",
        note: "Ask the familiar web an impossible question",
      },
      {
        label: "Door zero",
        address: "library.atlas/rooms/door-zero",
        note: "A catalogue entry with no known author",
      },
      {
        label: "Off-world weather",
        address: "weather.mars/olympus-mons",
        note: "Local conditions from somewhere else",
      },
    ],
  },
  sedative: {
    eyebrow: "THE QUIET NETWORK",
    title: ["Somewhere quieter", "is already online."],
    lede: "A parallel present, built for attention that belongs to you. Choose an address and drift.",
    placeholder: "Where would you like to wander?",
    inputLabel: "Enter an address on the Quiet Web",
    signal: "Low-noise connection",
    status: "The network is resting",
    footer: "Nothing here will ask you to hurry.",
    routesLabel: "Places nearby",
    icon: Waves,
    routes: [
      {
        label: "Stillroom Radio",
        address: "stillroom.fm/live",
        note: "A live room, somewhere after midnight",
      },
      {
        label: "Morning field notes",
        address: "fieldnotes.today/morning",
        note: "Small observations from a slower city",
      },
      {
        label: "Night train",
        address: "nighttrain.travel/window-seat",
        note: "A route with no arrival time",
      },
    ],
  },
  "ie-classic": {
    eyebrow: "VIBESURFER INTERNET DIRECTORY",
    title: ["Explore the World", "Wide Elseweb"],
    lede: "Type a Web address, search for something nobody has found, or select a channel below.",
    placeholder: "Search the Elseweb",
    inputLabel: "Search the Elseweb or enter an address",
    signal: "Internet zone",
    status: "Directory last updated 08/14/2001",
    footer: "Best experienced at 800 × 600 with imagination enabled.",
    routesLabel: "Featured channels",
    icon: Search,
    routes: [
      {
        label: "The Unknown Web Ring",
        address: "www.web-ring.net/unknown",
        note: "1,284 member pages and counting!",
      },
      {
        label: "Mars Weather Service",
        address: "www.spaceweather.gov/mars",
        note: "Forecasts · Dust alerts · Colony cams",
      },
      {
        label: "Area 51 Archive",
        address: "geocities.com/Area51/Archive/3058",
        note: "Warp sightings, files and guestbook",
      },
    ],
  },
  cyberpunk: {
    eyebrow: "HALLUNET // UNLICENSED ROUTE",
    title: ["BREACH THE", "CONSENSUS NET"],
    lede: "Enter a corporate host, a ghost query, or a forbidden node. Reality clearance is not required.",
    placeholder: "ENTER HOST / QUERY / ACCESS CODE",
    inputLabel: "Enter a Consensus Net host or query",
    signal: "Ghost route available",
    status: "TRACE MASK: ACTIVE",
    footer: "Every click leaves this reality further behind.",
    routesLabel: "Intercepted nodes",
    icon: Terminal,
    routes: [
      {
        label: "Municipal grid",
        address: "nexus.city/grid/status",
        note: "Sector load · curfew · live incidents",
      },
      {
        label: "Memory clinic",
        address: "blackclinic.net/memory/intake",
        note: "Unlicensed recall reconstruction",
      },
      {
        label: "Citizen ledger",
        address: "kuroda.corp/citizen/lookup",
        note: "Clearance required // mirror detected",
      },
    ],
  },
};

export function NewTabPage() {
  const activeTabId = useBrowserStore((state) => state.activeTabId);
  const theme = useBrowserStore((state) => state.preferences.theme);
  const animations = useBrowserStore((state) => state.preferences.animations);
  const navigate = useBrowserStore((state) => state.navigate);
  const discoverLucky = useBrowserStore((state) => state.discoverLucky);
  const luckyJob = useBrowserStore((state) => {
    const tab = state.tabs.find((item) => item.id === state.activeTabId);
    return tab?.luckyJobId ? state.generationJobs[tab.luckyJobId] : undefined;
  });
  const [address, setAddress] = useState("");
  const portal = portals[theme];
  const PortalIcon = portal.icon;
  const isRussian = useMemo(() => typeof navigator !== "undefined" && /^ru(?:-|$)/i.test(navigator.language), []);
  const search = searchPortal(theme, isRussian);
  const luckyBusy = luckyJob?.status === "queued" || luckyJob?.status === "running";

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
          <span className="new-tab-page__signal"><Radio aria-hidden="true" />{portal.signal}</span>
        </header>

        <div className="new-tab-page__hero">
          <p className="new-tab-page__eyebrow">{portal.eyebrow}</p>
          <h1>{portal.title[0]}<span>{portal.title[1]}</span></h1>
          <p className="new-tab-page__lede">{portal.lede}</p>
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
            <span>{luckyBusy ? (isRussian ? "Ищем путь…" : "Finding a route…") : (isRussian ? "Мне повезёт" : "I’m Feeling Lucky")}</span>
          </button>
          <button className="generation-composer__submit" type="submit" aria-label="Open address" disabled={!address.trim()}>
            <ArrowRight aria-hidden="true" />
          </button>
        </form>

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

      <footer className="new-tab-page__principles">
        <span><CircleDot aria-hidden="true" />{portal.status}</span>
        <span>{portal.footer}</span>
      </footer>
    </motion.section>
  );
}

export function searchPortal(theme: ThemeId, russian: boolean): { name: string; url: (query: string) => string } {
  const encoded = (query: string) => encodeURIComponent(query);
  if (theme === "ie-classic") {
    return russian
      ? { name: "Rambler", url: (query) => `https://www.rambler.ru/search?query=${encoded(query)}` }
      : { name: "MSN Search", url: (query) => `https://www.msn.com/search?q=${encoded(query)}` };
  }
  if (theme === "cyberpunk") {
    return { name: "NEXUS FIND", url: (query) => `https://search.nexus.city/query?q=${encoded(query)}` };
  }
  if (theme === "sedative") {
    return { name: russian ? "Яндекс Тихий поиск" : "Quiet Search", url: (query) => `https://${russian ? "yandex.ru/search/" : "search.quiet"}?${russian ? "text" : "q"}=${encoded(query)}` };
  }
  return russian
    ? { name: "Яндекс", url: (query) => `https://yandex.ru/search/?text=${encoded(query)}` }
    : { name: "Google", url: (query) => `https://www.google.com/search?q=${encoded(query)}` };
}
