import type {
  JsonValue,
  SiteRegionSnapshot,
  SiteSessionCartItem,
  SiteSessionState,
} from "../types/browser";

export const MAX_SITE_SESSION_BYTES = 256 * 1024;
const MAX_QUANTITY = 1_000_000;
const VALUE_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const CURRENCY = /^[A-Z]{3}$/;

export function createSiteSession(profileId: string, siteWorldId: string): SiteSessionState {
  return {
    profileId,
    siteWorldId,
    revision: 0,
    cart: { items: {} },
    wishlist: [],
    values: {},
    regionSnapshots: {},
    updatedAt: new Date(0).toISOString(),
  };
}

export function applyStateAction(
  current: SiteSessionState,
  action: string,
  fields: Record<string, string[]>,
): SiteSessionState {
  const next = structuredClone(current);
  const value = (name: string) => fields[name]?.[0]?.trim();
  const productId = value("productId")?.slice(0, 160);

  switch (action.toLowerCase()) {
    case "state:cart.add": {
      if (!productId) return current;
      const quantity = positiveInteger(value("quantity"), 1);
      const existing = next.cart.items[productId];
      const unitPriceMinor = nonNegativeInteger(value("unitPriceMinor"));
      const currency = normalizeCurrency(value("currency"));
      next.cart.items[productId] = {
        productId,
        quantity: Math.min(MAX_QUANTITY, (existing?.quantity ?? 0) + quantity),
        ...(unitPriceMinor !== undefined && currency ? { unitPriceMinor, currency } : existingPrice(existing)),
      };
      break;
    }
    case "state:cart.remove":
      if (!productId || !next.cart.items[productId]) return current;
      delete next.cart.items[productId];
      break;
    case "state:cart.setquantity": {
      if (!productId) return current;
      const quantity = nonNegativeInteger(value("quantity"));
      if (quantity === undefined) return current;
      if (quantity === 0) delete next.cart.items[productId];
      else {
        const existing = next.cart.items[productId];
        const unitPriceMinor = nonNegativeInteger(value("unitPriceMinor"));
        const currency = normalizeCurrency(value("currency"));
        next.cart.items[productId] = {
          productId,
          quantity: Math.min(MAX_QUANTITY, quantity),
          ...(unitPriceMinor !== undefined && currency ? { unitPriceMinor, currency } : existingPrice(existing)),
        };
      }
      break;
    }
    case "state:wishlist.toggle":
      if (!productId) return current;
      next.wishlist = next.wishlist.includes(productId)
        ? next.wishlist.filter((id) => id !== productId)
        : [...next.wishlist, productId].slice(-2_000);
      break;
    case "state:value.set": {
      const key = value("key");
      if (!key || !VALUE_KEY.test(key)) return current;
      next.values[key] = parseGenericValue(value("value") ?? "");
      break;
    }
    default:
      return current;
  }

  return fitSiteSession(bumpSession(next));
}

export function updateRegionSnapshots(
  current: SiteSessionState,
  canonicalPageUrl: string,
  patches: Array<{ regionId: string; html: string; revision: number }>,
  modelState?: JsonValue,
): SiteSessionState {
  const next = structuredClone(current);
  const page = { ...(next.regionSnapshots[canonicalPageUrl] ?? {}) };
  const updatedAt = new Date().toISOString();
  for (const patch of patches) {
    const existing = page[patch.regionId];
    if (existing && existing.revision >= patch.revision) continue;
    page[patch.regionId] = { html: patch.html, revision: patch.revision, updatedAt };
  }
  next.regionSnapshots[canonicalPageUrl] = page;
  if (modelState !== undefined) next.modelState = modelState;
  return fitSiteSession(bumpSession(next));
}

export function bindingsForSession(session: SiteSessionState, requested: string[]): Record<string, string> {
  const bindings: Record<string, string> = {};
  for (const binding of requested) {
    if (binding === "cart.count") bindings[binding] = String(cartCount(session));
    else if (binding === "cart.total") bindings[binding] = cartTotal(session);
    else if (binding === "wishlist.count") bindings[binding] = String(session.wishlist.length);
    else if (binding.startsWith("value.")) bindings[binding] = displayValue(session.values[binding.slice(6)]);
  }
  return bindings;
}

export function cartCount(session: SiteSessionState): number {
  return Object.values(session.cart.items).reduce((total, item) => total + item.quantity, 0);
}

export function cartTotal(session: SiteSessionState): string {
  const items = Object.values(session.cart.items);
  if (items.length === 0) return "0";
  const currencies = new Set(items.map((item) => item.currency).filter(Boolean));
  if (currencies.size !== 1 || items.some((item) => !Number.isSafeInteger(item.unitPriceMinor))) return "—";
  const currency = [...currencies][0]!;
  const totalMinor = items.reduce((total, item) => total + item.quantity * item.unitPriceMinor!, 0);
  if (!Number.isSafeInteger(totalMinor)) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(totalMinor / 100);
  } catch {
    return `${currency} ${(totalMinor / 100).toFixed(2)}`;
  }
}

export function trustedStateForModel(session: SiteSessionState): JsonValue {
  return { cart: session.cart as unknown as JsonValue, wishlist: session.wishlist, values: session.values };
}

export function canonicalPageUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return value;
  }
}

export function fitSiteSession(input: SiteSessionState): SiteSessionState {
  const next = structuredClone(input);
  const size = () => new TextEncoder().encode(JSON.stringify(next)).byteLength;
  if (size() <= MAX_SITE_SESSION_BYTES) return next;
  const snapshots = Object.entries(next.regionSnapshots).flatMap(([url, regions]) =>
    Object.entries(regions).map(([regionId, snapshot]) => ({ url, regionId, snapshot })),
  ).sort((left, right) => left.snapshot.updatedAt.localeCompare(right.snapshot.updatedAt));
  for (const { url, regionId } of snapshots) {
    delete next.regionSnapshots[url]?.[regionId];
    if (Object.keys(next.regionSnapshots[url] ?? {}).length === 0) delete next.regionSnapshots[url];
    if (size() <= MAX_SITE_SESSION_BYTES) return next;
  }
  delete next.modelState;
  if (size() <= MAX_SITE_SESSION_BYTES) return next;
  while (next.wishlist.length > 0 && size() > MAX_SITE_SESSION_BYTES) next.wishlist.shift();
  for (const productId of Object.keys(next.cart.items)) {
    if (size() <= MAX_SITE_SESSION_BYTES) return next;
    delete next.cart.items[productId];
  }
  for (const key of Object.keys(next.values)) {
    if (size() <= MAX_SITE_SESSION_BYTES) return next;
    delete next.values[key];
  }
  if (size() <= MAX_SITE_SESSION_BYTES) return next;
  throw new Error("Site session exceeds the 256 KiB limit.");
}

export function normalizeSiteSession(value: unknown, profileId: string, siteWorldId: string): SiteSessionState {
  const fallback = createSiteSession(profileId, siteWorldId);
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const source = value as Partial<SiteSessionState>;
  if (source.profileId !== profileId || source.siteWorldId !== siteWorldId) return fallback;
  const cartItems: Record<string, SiteSessionCartItem> = {};
  for (const [id, candidate] of Object.entries(source.cart?.items ?? {}).slice(0, 2_000)) {
    if (!candidate || candidate.productId !== id || !Number.isInteger(candidate.quantity) || candidate.quantity < 1 || candidate.quantity > MAX_QUANTITY) continue;
    cartItems[id] = {
      productId: id,
      quantity: candidate.quantity,
      ...(Number.isSafeInteger(candidate.unitPriceMinor) && candidate.unitPriceMinor! >= 0 && normalizeCurrency(candidate.currency)
        ? { unitPriceMinor: candidate.unitPriceMinor, currency: normalizeCurrency(candidate.currency) }
        : {}),
    };
  }
  const snapshots: Record<string, Record<string, SiteRegionSnapshot>> = {};
  for (const [url, regions] of Object.entries(source.regionSnapshots ?? {}).slice(0, 128)) {
    if (!regions || typeof regions !== "object") continue;
    snapshots[url] = Object.fromEntries(Object.entries(regions).filter(([, snapshot]) =>
      snapshot && typeof snapshot.html === "string" && snapshot.html.length <= 64 * 1024
      && Number.isInteger(snapshot.revision) && snapshot.revision >= 0 && typeof snapshot.updatedAt === "string",
    ).slice(0, 16));
  }
  return fitSiteSession({
    ...fallback,
    revision: Number.isInteger(source.revision) && source.revision! >= 0 ? source.revision! : 0,
    cart: { items: cartItems },
    wishlist: Array.isArray(source.wishlist) ? source.wishlist.filter((id): id is string => typeof id === "string").slice(0, 2_000) : [],
    values: source.values && typeof source.values === "object" ? source.values : {},
    ...(source.modelState !== undefined ? { modelState: source.modelState } : {}),
    regionSnapshots: snapshots,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : fallback.updatedAt,
  });
}

function bumpSession(session: SiteSessionState): SiteSessionState {
  session.revision += 1;
  session.updatedAt = new Date().toISOString();
  return session;
}

function existingPrice(item: SiteSessionCartItem | undefined): Pick<SiteSessionCartItem, "unitPriceMinor" | "currency"> {
  return item?.unitPriceMinor !== undefined && item.currency
    ? { unitPriceMinor: item.unitPriceMinor, currency: item.currency }
    : {};
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = nonNegativeInteger(value);
  return parsed && parsed > 0 ? Math.min(MAX_QUANTITY, parsed) : fallback;
}

function nonNegativeInteger(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function normalizeCurrency(value: string | undefined): string | undefined {
  const normalized = value?.toUpperCase();
  return normalized && CURRENCY.test(normalized) ? normalized : undefined;
}

function parseGenericValue(value: string): JsonValue {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return value.slice(0, 16_384);
}

function displayValue(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
