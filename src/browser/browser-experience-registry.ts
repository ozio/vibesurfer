export const BROWSER_THEME_IDS = [
  "native",
  "sedative",
  "ie-classic",
  "cyberpunk",
  "editorial",
] as const;

export type ThemeId = (typeof BROWSER_THEME_IDS)[number];

export type BrowserPortalIcon = "compass" | "waves" | "search" | "terminal";

export interface BrowserPortalRoute {
  label: string;
  address: string;
  note: string;
}

export interface BrowserSearchProvider {
  name: string;
  baseUrl: string;
  queryParameter: string;
}

export interface BrowserExperienceDefinition {
  chrome: {
    toolbarLabel: string;
    settingsLabel: string;
    caption: string;
    variant: "standard" | "ie-classic";
    smoothTabScrolling: boolean;
    address: {
      network: string;
      placeholder: string;
      queryDetail: string;
      addressDetail: string;
      starterLabel: string;
      starterDetail: string;
      starterAddress: string;
    };
  };
  portal: {
    eyebrow: string;
    title: readonly [string, string];
    lede: string;
    placeholder: string;
    inputLabel: string;
    signal: string;
    status: string;
    footer: string;
    routesLabel: string;
    icon: BrowserPortalIcon;
    routes: readonly BrowserPortalRoute[];
    search: {
      default: BrowserSearchProvider;
      russian?: BrowserSearchProvider;
    };
  };
  generation: {
    profilePreset: {
      name: string;
      avatar: string;
      vibe: string;
      prompt: string;
    };
    mockLuckyRoutes: readonly (readonly [url: string, label: string])[];
    legacyArtifact: {
      palette: {
        bg: string;
        surface: string;
        text: string;
        muted: string;
        accent: string;
      };
      cardRadius: string;
      cardBorder: string;
      cardShadow: string;
      sparkShadow: string;
      footerBorder: string;
      eyebrowSpacing: string;
      eyebrowTransform: "none" | "uppercase";
    };
  };
  nativeWindow: {
    cornerRadius: number;
  };
}

export const BROWSER_EXPERIENCE_REGISTRY = {
  native: {
    chrome: {
      toolbarLabel: "Native",
      settingsLabel: "System Native",
      caption: "Quiet, familiar, platform-aware",
      variant: "standard",
      smoothTabScrolling: true,
      address: {
        network: "the Hallunet",
        placeholder: "Enter an address or search the Hallunet",
        queryDetail: "Follow this query beyond the indexed web",
        addressDetail: "Open this coordinate in the Hallunet",
        starterLabel: "Search for something the indexed web has never seen",
        starterDetail: "The first result may lead anywhere",
        starterAddress: "google.com/search?q=three-byte+metacode",
      },
    },
    portal: {
      eyebrow: "HALLUNET / OPEN ACCESS",
      title: ["There is another", "internet in here."],
      lede: "Type an address that should not exist. Somewhere beyond consensus, it already does.",
      placeholder: "Enter an impossible address or search…",
      inputLabel: "Enter a Hallunet address or search",
      signal: "Reality index drifting",
      status: "Unmapped network",
      footer: "No map. No canon. Follow the links.",
      routesLabel: "Unstable coordinates",
      icon: "compass",
      routes: [
        { label: "Unknown search", address: "google.com/search?q=three-byte+metacode", note: "Ask the familiar web an impossible question" },
        { label: "Door zero", address: "library.atlas/rooms/door-zero", note: "A catalogue entry with no known author" },
        { label: "Off-world weather", address: "weather.mars/olympus-mons", note: "Local conditions from somewhere else" },
      ],
      search: {
        default: { name: "Google", baseUrl: "https://www.google.com/search", queryParameter: "q" },
        russian: { name: "Яндекс", baseUrl: "https://yandex.ru/search/", queryParameter: "text" },
      },
    },
    generation: {
      profilePreset: { name: "Native", avatar: "N", vibe: "", prompt: "" },
      mockLuckyRoutes: [
        ["https://library.atlas/rooms/door-zero", "Door Zero"],
        ["https://weather.mars/olympus-mons", "Olympus Weather"],
        ["https://archive.future/events/never-happened", "Events That Never Happened"],
        ["https://maps.below/cities/under-london", "Cities Below"],
        ["https://radio.elsewhere/frequency/0", "Frequency Zero"],
        ["https://museum.impossible/exhibits/shadows", "Museum of Shadows"],
        ["https://species.wiki/homo-lumen", "Homo Lumen"],
        ["https://transit.dream/nightly", "Dream Transit"],
        ["https://news.tomorrow/archive/yesterday", "Tomorrow's Yesterday"],
        ["https://ocean.space/ports/pelagic", "Pelagic Spaceport"],
      ],
      legacyArtifact: {
        palette: { bg: "#f5f5f7", surface: "#ffffff", text: "#161617", muted: "#707077", accent: "#5e5ce6" },
        cardRadius: "18px",
        cardBorder: "1px solid color-mix(in srgb, #161617 13%, transparent)",
        cardShadow: "0 18px 55px rgba(0,0,0,.08)",
        sparkShadow: "0 0 18px #5e5ce6",
        footerBorder: "1px solid color-mix(in srgb, #161617 12%, transparent)",
        eyebrowSpacing: ".14em",
        eyebrowTransform: "uppercase",
      },
    },
    nativeWindow: { cornerRadius: 12 },
  },
  sedative: {
    chrome: {
      toolbarLabel: "Sedative",
      settingsLabel: "Sedative",
      caption: "Soft pills and zero visual urgency",
      variant: "standard",
      smoothTabScrolling: true,
      address: {
        network: "the Quiet Web",
        placeholder: "Enter an address on the Quiet Web",
        queryDetail: "Let the quieter network answer",
        addressDetail: "Drift into this address",
        starterLabel: "Open a quiet place nearby",
        starterDetail: "A live room, somewhere after midnight",
        starterAddress: "stillroom.fm/live",
      },
    },
    portal: {
      eyebrow: "THE QUIET NETWORK",
      title: ["Somewhere quieter", "is already online."],
      lede: "A parallel present, built for attention that belongs to you. Choose an address and drift.",
      placeholder: "Where would you like to wander?",
      inputLabel: "Enter an address on the Quiet Web",
      signal: "Low-noise connection",
      status: "The network is resting",
      footer: "Nothing here will ask you to hurry.",
      routesLabel: "Places nearby",
      icon: "waves",
      routes: [
        { label: "Stillroom Radio", address: "stillroom.fm/live", note: "A live room, somewhere after midnight" },
        { label: "Morning field notes", address: "fieldnotes.today/morning", note: "Small observations from a slower city" },
        { label: "Night train", address: "nighttrain.travel/window-seat", note: "A route with no arrival time" },
      ],
      search: {
        default: { name: "Quiet Search", baseUrl: "https://search.quiet", queryParameter: "q" },
        russian: { name: "Яндекс Тихий поиск", baseUrl: "https://yandex.ru/search/", queryParameter: "text" },
      },
    },
    generation: {
      profilePreset: {
        name: "Quiet Web",
        avatar: "Q",
        vibe: "A quiet, humane, low-stimulation web built around privacy, repair, craft, and public life.",
        prompt: "This is the Quiet Web: a humane, unhurried parallel internet shaped by privacy, repair, craft, public life, and low-stimulation interfaces. Keep each destination's authentic function while expressing this world through concrete ordinary details.",
      },
      mockLuckyRoutes: [
        ["https://stillroom.fm/rooms/rain-library", "Rain Library"],
        ["https://nighttrain.travel/routes/no-arrival", "No-arrival Train"],
        ["https://fieldnotes.today/borrowed-gardens", "Borrowed Gardens"],
        ["https://repair.city/objects/forgotten", "Forgotten Objects"],
        ["https://slowpost.world/letters/in-transit", "Letters in Transit"],
        ["https://publictable.org/supper/tonight", "Public Supper"],
        ["https://quietweather.net/fog-index", "Fog Index"],
        ["https://afterhours.museum/one-light-on", "One Light On"],
        ["https://tideclock.coop/calendar", "Tide Calendar"],
        ["https://commons.radio/untranslated", "Untranslated Radio"],
      ],
      legacyArtifact: {
        palette: { bg: "#edf0f2", surface: "#ffffff", text: "#283036", muted: "#7a858c", accent: "#6f8390" },
        cardRadius: "32px",
        cardBorder: "none",
        cardShadow: "0 14px 40px rgba(62, 76, 86, .08)",
        sparkShadow: "none",
        footerBorder: "none",
        eyebrowSpacing: ".025em",
        eyebrowTransform: "none",
      },
    },
    nativeWindow: { cornerRadius: 28 },
  },
  "ie-classic": {
    chrome: {
      toolbarLabel: "IE Classic",
      settingsLabel: "Internet Explorer",
      caption: "Beveled chrome and classic blue",
      variant: "ie-classic",
      smoothTabScrolling: false,
      address: {
        network: "Hallunet",
        placeholder: "Search Hallunet or type a Web address",
        queryDetail: "Search all alternate Web pages",
        addressDetail: "Go to this Web address",
        starterLabel: "Visit the Unknown Web Ring",
        starterDetail: "1,284 member pages and counting!",
        starterAddress: "www.web-ring.net/unknown",
      },
    },
    portal: {
      eyebrow: "",
      title: ["Explore", "Hallunet"],
      lede: "",
      placeholder: "Search Hallunet",
      inputLabel: "Search Hallunet or enter an address",
      signal: "",
      status: "",
      footer: "",
      routesLabel: "Featured channels",
      icon: "search",
      routes: [
        { label: "The Unknown Web Ring", address: "www.web-ring.net/unknown", note: "1,284 member pages and counting!" },
        { label: "Mars Weather Service", address: "www.spaceweather.gov/mars", note: "Forecasts · Dust alerts · Colony cams" },
        { label: "Area 51 Archive", address: "geocities.com/Area51/Archive/3058", note: "Warp sightings, files and guestbook" },
      ],
      search: {
        default: { name: "MSN Search", baseUrl: "https://www.msn.com/search", queryParameter: "q" },
      },
    },
    generation: {
      profilePreset: {
        name: "Internet Explorer",
        avatar: "E",
        vibe: "A living Web 1.0 internet from roughly 1997-2003: handmade, optimistic, dense, and delightfully uneven.",
        prompt: "This internet is alive in the Web 1.0 era, roughly 1997-2003. Every site uses the conventions, technology, optimism, clutter, and handmade character of that era, even when its underlying world contains impossible science or alternate history.",
      },
      mockLuckyRoutes: [
        ["http://www.lunarcities.net/~nightshift/observatory.html", "Night Shift Observatory"],
        ["http://directory.msn.com/Hallunet/Impossible_Museums/", "Impossible Museums"],
        ["http://www.radiomars.gov/livecam/", "Mars Radio Livecam"],
        ["http://geocities.com/Area51/Corridor/7714/", "Corridor 7714"],
        ["http://www.angelfire.com/zine/tomorrowweather/", "Tomorrow's Weather"],
        ["http://archive.web-ring.net/dreammachines/", "Dream Machines Web Ring"],
        ["http://www.citylibrary.example/forbidden.htm", "Forbidden Stacks"],
        ["http://www.oceanicrail.com/timetables/moon.htm", "Moon Timetable"],
        ["http://members.tripod.com/~signalghost/", "Signal Ghost"],
        ["http://www.rambler.ru/catalog/parallel/", "Parallel Rambler"],
      ],
      legacyArtifact: {
        palette: { bg: "#008080", surface: "#d4d0c8", text: "#111111", muted: "#4f4f4f", accent: "#000080" },
        cardRadius: "0",
        cardBorder: "1px solid color-mix(in srgb, #111111 13%, transparent)",
        cardShadow: "inset 1px 1px white, inset -1px -1px #555",
        sparkShadow: "0 0 18px #000080",
        footerBorder: "1px solid color-mix(in srgb, #111111 12%, transparent)",
        eyebrowSpacing: ".14em",
        eyebrowTransform: "uppercase",
      },
    },
    nativeWindow: { cornerRadius: 0 },
  },
  cyberpunk: {
    chrome: {
      toolbarLabel: "Cyberpunk",
      settingsLabel: "Cyberdeck",
      caption: "Dense neon instrumentation",
      variant: "standard",
      smoothTabScrolling: true,
      address: {
        network: "the Consensus Net",
        placeholder: "ENTER HOST / QUERY / ACCESS CODE",
        queryDetail: "Route query through an unlicensed index",
        addressDetail: "Establish a ghost route to this node",
        starterLabel: "Intercept an unregistered node",
        starterDetail: "Trace mask active",
        starterAddress: "blackclinic.net/memory/intake",
      },
    },
    portal: {
      eyebrow: "HALLUNET // UNLICENSED ROUTE",
      title: ["BREACH THE", "CONSENSUS NET"],
      lede: "Enter a corporate host, a ghost query, or a forbidden node. Reality clearance is not required.",
      placeholder: "ENTER HOST / QUERY / ACCESS CODE",
      inputLabel: "Enter a Consensus Net host or query",
      signal: "Ghost route available",
      status: "TRACE MASK: ACTIVE",
      footer: "Every click leaves this reality further behind.",
      routesLabel: "Intercepted nodes",
      icon: "terminal",
      routes: [
        { label: "Municipal grid", address: "nexus.city/grid/status", note: "Sector load · curfew · live incidents" },
        { label: "Memory clinic", address: "blackclinic.net/memory/intake", note: "Unlicensed recall reconstruction" },
        { label: "Citizen ledger", address: "kuroda.corp/citizen/lookup", note: "Clearance required // mirror detected" },
      ],
      search: {
        default: { name: "NEXUS FIND", baseUrl: "https://search.nexus.city/query", queryParameter: "q" },
      },
    },
    generation: {
      profilePreset: {
        name: "Cyberpunk",
        avatar: "C",
        vibe: "A dense near-future network of corporate systems, civic AIs, street infrastructure, and pirate relays.",
        prompt: "This is the near-future Consensus Net: megacorporations, municipal AIs, synthetic citizens, orbital infrastructure, surveillance systems, street clinics, and pirate relays are ordinary. Reveal power and lived history through useful interfaces and specific data.",
      },
      mockLuckyRoutes: [
        ["https://ghostmarket.net/auctions/memories", "Memory Auctions"],
        ["https://nexus.city/transit/phantom-line", "Phantom Line"],
        ["https://kuroda.corp/leaks/employee-000", "Employee Zero"],
        ["https://orbital.weather/sector-9", "Orbital Weather"],
        ["https://blackclinic.net/recall/menu", "Recall Menu"],
        ["https://municipal.ai/petitions/synthetic-rights", "Synthetic Rights"],
        ["https://relay.null/voices/last-night", "Null Relay"],
        ["https://streetfood.city/no-license", "Unlicensed Kitchens"],
        ["https://trace.gov/citizen/unknown", "Unknown Citizen"],
        ["https://sleepbank.coop/dream-exchange", "Dream Exchange"],
      ],
      legacyArtifact: {
        palette: { bg: "#060a11", surface: "#0d1521", text: "#e8fbff", muted: "#7896a1", accent: "#4df4ff" },
        cardRadius: "18px",
        cardBorder: "1px solid color-mix(in srgb, #e8fbff 13%, transparent)",
        cardShadow: "0 18px 55px rgba(0,0,0,.08)",
        sparkShadow: "0 0 18px #4df4ff",
        footerBorder: "1px solid color-mix(in srgb, #e8fbff 12%, transparent)",
        eyebrowSpacing: ".14em",
        eyebrowTransform: "uppercase",
      },
    },
    nativeWindow: { cornerRadius: 4 },
  },
  editorial: {
    chrome: {
      toolbarLabel: "Editorial",
      settingsLabel: "Editorial",
      caption: "Ink, paper, and sharp hierarchy",
      variant: "standard",
      smoothTabScrolling: true,
      address: {
        network: "the Public Record",
        placeholder: "Search the Public Record or enter an address",
        queryDetail: "Search the current and archived editions",
        addressDetail: "Open this filing in the Public Record",
        starterLabel: "Open the late edition",
        starterDetail: "Filed tonight by the city desk",
        starterAddress: "ledger.city/late-edition",
      },
    },
    portal: {
      eyebrow: "THE PUBLIC RECORD / LATE EDITION",
      title: ["Every address has", "a paper trail."],
      lede: "Search the edition, follow a citation, or open a filing from a city that history forgot.",
      placeholder: "Search the record or enter an address…",
      inputLabel: "Search the Public Record or enter an address",
      signal: "Late edition in circulation",
      status: "Press network online",
      footer: "Filed, printed, and linked before midnight.",
      routesLabel: "From today's index",
      icon: "search",
      routes: [
        { label: "The City Ledger", address: "ledger.city/late-edition", note: "Night desk · corrections · public notices" },
        { label: "Northern dispatch", address: "dispatch.world/field/aurora-district", note: "A correspondent files from the moving border" },
        { label: "Public archive", address: "archive.public/casefiles/zero", note: "Released documents with one page still missing" },
      ],
      search: {
        default: { name: "Record Index", baseUrl: "https://index.public-record/search", queryParameter: "q" },
      },
    },
    generation: {
      profilePreset: {
        name: "Editorial",
        avatar: "R",
        vibe: "An independent public internet shaped by newspapers, journals, civic archives, correspondence, and accountable institutions.",
        prompt: "This is the Public Record: an independent network of newspapers, journals, civic archives, correspondence, catalogues, and accountable institutions. Preserve each destination's real function while expressing this world through rigorous hierarchy, reported detail, citations, dates, marginalia, corrections, and confident editorial composition.",
      },
      mockLuckyRoutes: [
        ["https://ledger.city/late-edition", "Late Edition"],
        ["https://dispatch.world/field/aurora-district", "Aurora Dispatch"],
        ["https://archive.public/casefiles/zero", "Casefile Zero"],
        ["https://review.quarterly/objects/borrowed-time", "Borrowed Time Review"],
        ["https://gazette.harbor/shipping/midnight", "Midnight Shipping Gazette"],
        ["https://letters.common/undelivered/volume-7", "Undelivered Letters"],
        ["https://index.civic/ordinances/unbuilt-streets", "Unbuilt Streets Index"],
        ["https://observer.weather/pressure/anomaly", "Pressure Anomaly"],
        ["https://catalogue.museum/exhibitions/blank-space", "Blank Space Catalogue"],
        ["https://corrections.news/tomorrows-edition", "Tomorrow's Corrections"],
      ],
      legacyArtifact: {
        palette: { bg: "#e7e0d2", surface: "#fbf7ed", text: "#26211b", muted: "#70675b", accent: "#a44324" },
        cardRadius: "4px",
        cardBorder: "1px solid rgba(67, 53, 38, .2)",
        cardShadow: "0 10px 30px rgba(52, 42, 30, .09)",
        sparkShadow: "0 0 16px rgba(164, 67, 36, .36)",
        footerBorder: "1px solid rgba(67, 53, 38, .22)",
        eyebrowSpacing: ".12em",
        eyebrowTransform: "uppercase",
      },
    },
    nativeWindow: { cornerRadius: 6 },
  },
} as const satisfies Record<ThemeId, BrowserExperienceDefinition>;

export const BROWSER_THEME_TOOLBAR_ITEMS = BROWSER_THEME_IDS.map((value) => ({
  value,
  title: BROWSER_EXPERIENCE_REGISTRY[value].chrome.toolbarLabel,
}));

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (BROWSER_THEME_IDS as readonly string[]).includes(value);
}

export function browserExperience(theme: ThemeId): BrowserExperienceDefinition {
  return BROWSER_EXPERIENCE_REGISTRY[theme];
}

export function browserSearchProvider(theme: ThemeId, russian: boolean): BrowserSearchProvider {
  const search = BROWSER_EXPERIENCE_REGISTRY[theme].portal.search;
  return russian && "russian" in search && search.russian ? search.russian : search.default;
}
