#!/usr/bin/env node

/**
 * Build a compact, strict Iconify whitelist for an HTML-generating agent.
 *
 * Usage:
 *   node build-iconify-catalog.mjs
 *   node build-iconify-catalog.mjs ./iconify-packs.generated.json
 *
 * Requirements: Node.js 18+ and network access.
 * No npm dependencies.
 */

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const API_BASE = 'https://api.iconify.design';
const OUTPUT_FILE = resolve(process.argv[2] ?? './src/iconify/iconify-packs.generated.json');
const REQUEST_TIMEOUT_MS = 15_000;
const RETRIES = 3;

const PACKS = [
  {
    prefix: 'lucide',
    label: 'Lucide',
    description: 'Clean neutral outline for modern products, SaaS, services, editorial and serious general-purpose sites.',
    palette: 'monochrome',
    expectedLicense: 'ISC',
    attributionHTML: null,
    flavorQueries: ['sparkles', 'layout-dashboard', 'chart-column', 'badge-check', 'wand-sparkles', 'panels-top-left'],
    slotOverrides: {
      home: ['house', 'home'],
      menu: ['menu'],
      user: ['user-round', 'user'],
      users: ['users-round', 'users'],
      settings: ['settings'],
      notification: ['bell'],
      mail: ['mail'],
      location: ['map-pin'],
      image: ['image'],
      cart: ['shopping-cart'],
      card: ['credit-card'],
      close: ['x'],
      trash: ['trash-2', 'trash'],
      edit: ['pencil', 'square-pen'],
      info: ['info'],
      warning: ['triangle-alert'],
    },
  },
  {
    prefix: 'carbon',
    label: 'Carbon',
    description: 'Strict technical enterprise icons for data, infrastructure, industry, government and dense dashboards.',
    palette: 'monochrome',
    expectedLicense: 'Apache-2.0',
    attributionHTML: null,
    flavorQueries: ['data-base', 'dashboard', 'chart-line', 'cloud', 'security', 'machine-learning'],
    slotOverrides: {
      menu: ['menu'],
      users: ['group'],
      heart: ['favorite'],
      notification: ['notification'],
      mail: ['email'],
      clock: ['time'],
      globe: ['earth'],
      file: ['document'],
      cart: ['shopping-cart'],
      card: ['payment-methods'],
      plus: ['add'],
      check: ['checkmark'],
      trash: ['trash-can'],
      info: ['information'],
      lock: ['locked'],
      eye: ['view'],
    },
  },
  {
    prefix: 'ph',
    label: 'Phosphor Duotone',
    description: 'Rounded expressive duotone icons for consumer apps, lifestyle, communities and friendly modern products.',
    palette: 'monochrome',
    expectedLicense: 'MIT',
    variantSuffix: 'duotone',
    attributionHTML: null,
    flavorQueries: ['sparkle', 'palette', 'confetti', 'chat-circle', 'lightning', 'magic-wand'],
    slotOverrides: {
      home: ['house'],
      menu: ['list'],
      search: ['magnifying-glass'],
      settings: ['gear'],
      mail: ['envelope'],
      location: ['map-pin'],
      image: ['image'],
      cart: ['shopping-cart'],
      close: ['x'],
      edit: ['pencil-simple', 'pencil'],
      chevronDown: ['caret-down'],
      info: ['info'],
      warning: ['warning'],
    },
  },
  {
    prefix: 'pepicons-pop',
    label: 'Pepicons Pop!',
    description: 'Bouncy playful pop icons for humorous, youthful, creative and deliberately unserious sites.',
    palette: 'monochrome',
    expectedLicense: 'CC-BY-4.0',
    attributionHTML:
      'Icons by <a href="https://github.com/CyCraft/pepicons" rel="license">CyCraft / Pepicons</a>, licensed under <a href="https://creativecommons.org/licenses/by/4.0/" rel="license">CC BY 4.0</a>.',
    flavorQueries: ['face-smiling', 'stars', 'comet', 'flower', 'gift', 'crown'],
    slotDisabled: ['search', 'warning'],
    slotOverrides: {
      chevronDown: ['angle-down'],
      arrowLeft: ['arrow-left'],
      arrowRight: ['arrow-right'],
      notification: ['bell'],
      clock: ['alarm'],
    },
  },
  {
    prefix: 'streamline-cyber',
    label: 'Streamline Cyber',
    description: 'Angular sci-fi and cyberpunk icons for neon, terminals, security, Web3 and fictional technology.',
    palette: 'monochrome',
    expectedLicense: 'CC-BY-4.0',
    attributionHTML:
      'Icons by <a href="https://www.streamlinehq.com/" rel="license">Streamline</a>, licensed under <a href="https://creativecommons.org/licenses/by/4.0/" rel="license">CC BY 4.0</a>.',
    flavorQueries: ['chip', 'circuit', 'robot', 'scan', 'network', 'hexagon', 'database', 'satellite'],
    slotDisabled: ['menu', 'calendar', 'link', 'close', 'info'],
    slotOverrides: {
      search: ['synchronize-find-search'],
      user: ['account', 'account-circle', 'account-hexagon'],
      users: ['account-group-1', 'account-group'],
      settings: ['settings', 'cog'],
      heart: ['heart-beat'],
      star: ['badge-star-2'],
      location: ['location-pin-1'],
      globe: ['globe-1'],
      file: ['new-document-layer'],
      cart: ['shopping-cart-3'],
      upload: ['laptop-upload'],
      plus: ['add-hexagon-1'],
      edit: ['book-pencil'],
      arrowRight: ['navigation-next-hexagon-1'],
    },
  },
  {
    prefix: 'pixelarticons',
    label: 'Pixelarticons',
    description: 'Crisp pixel UI icons for retro computers, games, Y2K pages and 8/16-bit aesthetics.',
    palette: 'monochrome',
    expectedLicense: 'MIT',
    attributionHTML: null,
    flavorQueries: ['gamepad', 'joystick', 'alien', 'coin', 'trophy', 'pixel', 'zap', 'radio-signal'],
    slotOverrides: {
      settings: ['sliders', 'settings'],
      cart: ['cart'],
      close: ['close'],
      trash: ['trash'],
      edit: ['edit'],
      info: ['info-box', 'info'],
      warning: ['warning-box', 'warning'],
    },
  },
  {
    prefix: 'fa',
    label: 'Font Awesome 4',
    description: 'Classic Bootstrap-era and Web 2.0 icons for old dashboards and intentionally dated utilitarian sites.',
    palette: 'monochrome',
    expectedLicense: 'OFL-1.1',
    attributionHTML: null,
    flavorQueries: ['rss', 'floppy-o', 'desktop', 'sitemap', 'comments', 'internet-explorer'],
    slotOverrides: {
      menu: ['bars'],
      settings: ['cog'],
      notification: ['bell-o', 'bell'],
      mail: ['envelope-o', 'envelope'],
      clock: ['clock-o'],
      location: ['map-marker'],
      image: ['image', 'picture-o'],
      file: ['file-o', 'file'],
      close: ['times'],
      trash: ['trash-o', 'trash'],
      edit: ['pencil', 'edit'],
      info: ['info-circle'],
      warning: ['warning', 'exclamation-triangle'],
    },
  },
  {
    prefix: 'streamline-freehand',
    label: 'Streamline Freehand',
    description: 'Loose hand-drawn sketch icons for DIY, zines, indie brands, workshops and children’s sites.',
    palette: 'monochrome',
    expectedLicense: 'CC-BY-4.0',
    attributionHTML:
      'Icons by <a href="https://www.streamlinehq.com/" rel="license">Streamline</a>, licensed under <a href="https://creativecommons.org/licenses/by/4.0/" rel="license">CC BY 4.0</a>.',
    flavorQueries: ['brush', 'pencil', 'lightbulb', 'coffee', 'flower', 'music', 'paint', 'scissors'],
    slotDisabled: ['arrowLeft', 'chevronDown', 'info'],
    slotOverrides: {
      menu: ['menu-navigation-2'],
      heart: ['smiley-kiss-heart'],
      star: ['loading-star-1'],
      mail: ['envelope-letter-front'],
      image: ['drawer-image'],
      file: ['office-file-text'],
      cart: ['shop-cart'],
      plus: ['add-sign-bold'],
      check: ['form-validation-check-square-1'],
      close: ['focus-cross'],
      trash: ['delete-bin-2'],
      arrowRight: ['navigation-page-right'],
      warning: ['alerts-warning-triangle'],
      lock: ['lock-key-1'],
      eye: ['view-eye-1'],
    },
  },
  {
    prefix: 'flat-color-icons',
    label: 'Flat Color Icons',
    description: 'Multicolor illustrative pictograms for stickers, education, friendly explainers and nostalgic flat UI.',
    palette: 'multicolor',
    expectedLicense: 'MIT',
    attributionHTML: null,
    flavorQueries: ['idea', 'landscape', 'camera', 'puzzle', 'graduation', 'business', 'collaboration', 'engineering'],
    slotDisabled: ['mail', 'location', 'card', 'tag', 'play'],
    slotOverrides: {
      user: ['manager', 'businessman', 'businesswoman'],
      users: ['conference-call'],
      heart: ['like'],
      star: ['rating'],
      notification: ['alarm-clock'],
      mail: ['message'],
      location: ['marker'],
      image: ['image-file'],
      cart: ['shop'],
      card: ['bank-card'],
      tag: ['price-tag'],
      check: ['checkmark'],
      close: ['cancel'],
      trash: ['empty-trash', 'full-trash'],
      edit: ['edit-image'],
      info: ['about'],
      warning: ['high-priority'],
      eye: ['view-details'],
    },
  },
  {
    prefix: 'game-icons',
    label: 'Game Icons',
    description: 'Bold silhouettes for fantasy, RPG, occult, medieval, strategy, tabletop and heavy-metal aesthetics.',
    palette: 'monochrome',
    expectedLicense: 'CC-BY-3.0',
    attributionHTML:
      'Icons from <a href="https://game-icons.net/" rel="license">Game-icons.net</a>, licensed under <a href="https://creativecommons.org/licenses/by/3.0/" rel="license">CC BY 3.0</a>.',
    flavorQueries: ['sword', 'shield', 'dragon', 'skull', 'potion', 'castle', 'crown', 'magic', 'dice', 'treasure'],
    slotDisabled: ['users', 'plus', 'arrowLeft', 'arrowRight', 'chevronDown'],
    slotOverrides: {
      menu: ['hamburger-menu'],
      search: ['magnifying-glass'],
      settings: ['cog'],
      heart: ['hearts'],
      star: ['flat-star'],
      notification: ['bell-shield', 'bell'],
      clock: ['alarm-clock'],
      location: ['position-marker'],
      check: ['check-mark'],
    },
  },
];

const SLOTS = [
  ['home', ['home', 'house', 'homepage']],
  ['menu', ['menu', 'hamburger-menu', 'navigation-menu', 'bars', 'list']],
  ['search', ['search', 'magnifying-glass', 'magnifier', 'zoom']],
  ['user', ['user', 'person', 'account', 'profile', 'avatar']],
  ['users', ['users', 'people', 'group', 'user-group', 'account-group', 'team']],
  ['settings', ['settings', 'setting', 'cog', 'gear', 'preferences', 'sliders']],
  ['heart', ['heart', 'hearts', 'favorite', 'favourite', 'like']],
  ['star', ['star', 'rating-star', 'favorite-star', 'rating']],
  ['notification', ['bell', 'notification', 'notifications', 'alarm']],
  ['mail', ['mail', 'email', 'envelope', 'letter', 'message']],
  ['calendar', ['calendar', 'date', 'planner']],
  ['clock', ['clock', 'time', 'watch', 'alarm-clock', 'alarm']],
  ['location', ['map-pin', 'location', 'marker', 'pin', 'position-marker']],
  ['globe', ['globe', 'world', 'earth', 'network']],
  ['image', ['image', 'picture', 'photo', 'gallery', 'image-file']],
  ['camera', ['camera', 'photo-camera']],
  ['folder', ['folder', 'directory']],
  ['file', ['file', 'document', 'page']],
  ['link', ['link', 'chain', 'hyperlink', 'chain-links']],
  ['cart', ['shopping-cart', 'cart', 'basket', 'shopping-bag', 'shop']],
  ['card', ['credit-card', 'bank-card', 'card', 'payment']],
  ['tag', ['tag', 'price-tag', 'label']],
  ['download', ['download', 'arrow-down-to-line', 'cloud-download']],
  ['upload', ['upload', 'arrow-up-to-line', 'cloud-upload']],
  ['plus', ['plus', 'add']],
  ['check', ['check', 'checkmark', 'tick', 'approve']],
  ['close', ['x', 'close', 'cross', 'cancel', 'times', 'remove']],
  ['trash', ['trash', 'trash-2', 'delete', 'bin', 'trash-can', 'empty-trash']],
  ['edit', ['edit', 'pencil', 'pen', 'compose', 'edit-pencil']],
  ['arrowLeft', ['arrow-left', 'left-arrow', 'left']],
  ['arrowRight', ['arrow-right', 'right-arrow', 'right']],
  ['chevronDown', ['chevron-down', 'angle-down', 'caret-down', 'arrow-down']],
  ['play', ['play', 'play-button', 'player-play']],
  ['info', ['info', 'information', 'about', 'info-circle', 'info-box']],
  ['warning', ['triangle-alert', 'alert-triangle', 'warning', 'hazard-sign', 'high-priority']],
  ['lock', ['lock', 'padlock', 'locked']],
  ['eye', ['eye', 'view', 'visible', 'view-details']],
];

const STYLE_TOKENS = new Set([
  'bold',
  'duotone',
  'fill',
  'filled',
  'light',
  'outline',
  'regular',
  'sharp',
  'solid',
  'thin',
]);

const BAD_UNLESS_REQUESTED = new Set([
  'add',
  'disabled',
  'minus',
  'off',
  'remove',
  'slash',
]);

const GENERIC_NOISE = new Set([
  'alt',
  'circle',
  'horizontal',
  'large',
  'round',
  'rounded',
  'simple',
  'small',
  'square',
  'vertical',
]);

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function fetchJSON(url) {
  let lastError;

  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          'user-agent': 'vibesurfer-icon-catalog-builder/1.0',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < RETRIES) {
        await sleep(350 * attempt);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

async function fetchCollection(prefix) {
  const url = `${API_BASE}/collection?prefix=${encodeURIComponent(prefix)}&info=1`;
  try {
    return await fetchJSON(url);
  } catch (error) {
    throw new Error(`${prefix}: failed to read Iconify collection: ${error.message}`, {
      cause: error,
    });
  }
}

function collectNames(collection) {
  const hidden = new Set(collection.hidden ?? []);
  const visible = new Set();
  const aliases = new Set();

  for (const name of collection.uncategorized ?? []) {
    if (!hidden.has(name)) visible.add(name);
  }

  for (const names of Object.values(collection.categories ?? {})) {
    for (const name of names) {
      if (!hidden.has(name)) visible.add(name);
    }
  }

  for (const alias of Object.keys(collection.aliases ?? {})) {
    if (!hidden.has(alias)) aliases.add(alias);
  }

  return {
    names: [...new Set([...visible, ...aliases])].sort(),
    visible,
    aliases,
  };
}

function tokenize(value) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function stripStyle(value) {
  return tokenize(value).filter((token) => !STYLE_TOKENS.has(token));
}

function candidateVariants(candidate, suffix) {
  if (!suffix || candidate.endsWith(`-${suffix}`)) return [candidate];
  return [`${candidate}-${suffix}`, candidate];
}

function scoreName(name, query, variantSuffix, aliases) {
  if (variantSuffix && !name.endsWith(`-${variantSuffix}`)) return -Infinity;

  const nameTokens = stripStyle(name);
  const queryTokens = stripStyle(query);
  const nameString = nameTokens.join('-');
  const queryString = queryTokens.join('-');
  const querySet = new Set(queryTokens);
  const overlap = nameTokens.filter((token) => querySet.has(token)).length;

  if (overlap === 0 && !nameString.includes(queryString)) return -Infinity;

  let score = 0;
  if (name === query) score += 2_000;
  if (nameString === queryString) score += 1_400;
  if (
    nameString.startsWith(`${queryString}-`) ||
    nameString.endsWith(`-${queryString}`)
  ) {
    score += 500;
  }
  if (nameString.includes(queryString)) score += 300;
  if (queryTokens.every((token) => nameTokens.includes(token))) score += 250;
  score += overlap * 100;

  for (const token of nameTokens) {
    if (BAD_UNLESS_REQUESTED.has(token) && !querySet.has(token)) score -= 450;
    if (GENERIC_NOISE.has(token) && !querySet.has(token)) score -= 7;
  }

  if (aliases.has(name)) score -= 5;
  score -= Math.max(0, nameTokens.length - queryTokens.length) * 9;
  score -= name.length * 0.03;

  return score;
}

function pickBest({ names, aliases }, candidates, variantSuffix, used) {
  const available = names.filter((name) => !used.has(name));

  for (const candidate of candidates) {
    for (const exact of candidateVariants(candidate, variantSuffix)) {
      if (available.includes(exact)) return exact;
    }
  }

  let bestName = null;
  let bestScore = -Infinity;

  for (const name of available) {
    for (const candidate of candidates) {
      const score = scoreName(name, candidate, variantSuffix, aliases);
      if (score > bestScore) {
        bestName = name;
        bestScore = score;
      }
    }
  }

  return bestScore >= 125 ? bestName : null;
}

function actualLicense(collection, fallback) {
  const license = collection.info?.license;
  if (!license) return { spdx: fallback, title: fallback, url: null };

  return {
    spdx: license.spdx ?? fallback,
    title: license.title ?? license.spdx ?? fallback,
    url: license.url ?? null,
  };
}

function mergedIconData(iconSet, name, seen = new Set()) {
  if (seen.has(name)) return null;
  seen.add(name);

  const direct = iconSet.icons?.[name];
  if (direct) {
    return {
      body: direct.body,
      left: direct.left ?? iconSet.left ?? 0,
      top: direct.top ?? iconSet.top ?? 0,
      width: direct.width ?? iconSet.width ?? 16,
      height: direct.height ?? iconSet.height ?? 16,
      rotate: direct.rotate ?? 0,
      hFlip: direct.hFlip ?? false,
      vFlip: direct.vFlip ?? false,
    };
  }

  const alias = iconSet.aliases?.[name];
  if (!alias) return null;
  const parentName = typeof alias === 'string' ? alias : alias.parent;
  const parent = mergedIconData(iconSet, parentName, seen);
  if (!parent) return null;
  return {
    ...parent,
    ...(typeof alias === 'object' ? alias : {}),
    body: parent.body,
    left: typeof alias === 'object' && alias.left !== undefined ? alias.left : parent.left,
    top: typeof alias === 'object' && alias.top !== undefined ? alias.top : parent.top,
    width: typeof alias === 'object' && alias.width !== undefined ? alias.width : parent.width,
    height: typeof alias === 'object' && alias.height !== undefined ? alias.height : parent.height,
    rotate: (parent.rotate + (typeof alias === 'object' ? alias.rotate ?? 0 : 0)) % 4,
    hFlip: Boolean(parent.hFlip) !== Boolean(typeof alias === 'object' && alias.hFlip),
    vFlip: Boolean(parent.vFlip) !== Boolean(typeof alias === 'object' && alias.vFlip),
  };
}

function assertSafeIconBody(prefix, name, body) {
  if (typeof body !== 'string' || !body.trim()) {
    throw new Error(`${prefix}:${name}: Iconify returned an empty SVG body`);
  }
  if (/<\/?(?:script|foreignObject|iframe|object|embed|image|audio|video|style)\b/i.test(body)) {
    throw new Error(`${prefix}:${name}: Iconify returned an active SVG element`);
  }
  if (/(?:href|xlink:href)\s*=\s*["']\s*(?:https?:|data:|javascript:|\/\/)/i.test(body)) {
    throw new Error(`${prefix}:${name}: Iconify returned an external SVG reference`);
  }
}

async function fetchSelectedIconData(prefix, names) {
  const url = `${API_BASE}/${encodeURIComponent(prefix)}.json?icons=${encodeURIComponent(names.join(','))}`;
  const iconSet = await fetchJSON(url);
  const iconData = {};
  for (const name of names) {
    const icon = mergedIconData(iconSet, name);
    if (!icon) throw new Error(`${prefix}:${name}: selected icon data is missing from the Iconify API response`);
    assertSafeIconBody(prefix, name, icon.body);
    iconData[name] = icon;
  }
  return iconData;
}

async function buildPack(pack) {
  const collection = await fetchCollection(pack.prefix);
  const nameIndex = collectNames(collection);
  const used = new Set();
  const semanticMap = {};

  for (const [slot, genericCandidates] of SLOTS) {
    if (pack.slotDisabled?.includes(slot)) continue;
    const candidates = [
      ...(pack.slotOverrides?.[slot] ?? []),
      ...genericCandidates,
    ];
    const iconName = pickBest(
      nameIndex,
      candidates,
      pack.variantSuffix,
      used,
    );

    if (iconName) {
      semanticMap[slot] = iconName;
      used.add(iconName);
    }
  }

  const flavor = [];
  for (const query of pack.flavorQueries ?? []) {
    const iconName = pickBest(
      nameIndex,
      [query],
      pack.variantSuffix,
      used,
    );
    if (iconName) {
      flavor.push(iconName);
      used.add(iconName);
    }
  }

  const names = [...Object.values(semanticMap), ...flavor];
  const license = actualLicense(collection, pack.expectedLicense);
  const iconData = await fetchSelectedIconData(pack.prefix, names);

  if (license.spdx !== pack.expectedLicense) {
    console.warn(
      `${pack.prefix}: license changed from expected ${pack.expectedLicense} to ${license.spdx}`,
    );
  }

  if (names.length < 20) {
    console.warn(
      `${pack.prefix}: selected only ${names.length} icons; consider adding pack-specific candidates`,
    );
  }

  return {
    prefix: pack.prefix,
    label: pack.label,
    description: pack.description,
    palette: pack.palette,
    totalInCollection: collection.total,
    license,
    attributionRequired: Boolean(pack.attributionHTML),
    attributionHTML: pack.attributionHTML,
    semanticMap,
    flavor,
    names,
    iconData,
    promptMap: Object.entries(semanticMap)
      .map(([meaning, name]) => `${meaning}=${name}`)
      .join(', '),
    promptFlavor: flavor.join(', '),
    promptNames: names.join(', '),
    fullNames: names.map((name) => `${pack.prefix}:${name}`),
  };
}

async function main() {
  const output = {
    generatedAt: new Date().toISOString(),
    source: `${API_BASE}/collection`,
    webComponentScript:
      'https://code.iconify.design/iconify-icon/3.0.0/iconify-icon.min.js',
    allowedPrefixes: PACKS.map((pack) => pack.prefix),
    packs: {},
  };

  for (const pack of PACKS) {
    process.stdout.write(`Reading ${pack.prefix}... `);
    const built = await buildPack(pack);
    output.packs[pack.prefix] = built;
    console.log(`${built.names.length} selected`);
  }

  await writeFile(OUTPUT_FILE, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${OUTPUT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
