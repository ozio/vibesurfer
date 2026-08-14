import { createHash } from "node:crypto";

import type { ArtifactWarning, ImageSettings } from "../domain.js";

export interface ImageIntent {
  query: string;
  alt: string;
  aspect: string;
  index: number;
  artifactSeed: string;
}

export interface ResolvedImage {
  src: string;
  width: number;
  height: number;
  source: "off" | "local" | "tag-placeholder";
  omitted?: boolean;
  warning?: ArtifactWarning;
}

export interface ImageIntentResolver {
  resolve(intent: ImageIntent, signal: AbortSignal): Promise<ResolvedImage>;
}

const MAX_IMAGE_REDIRECTS = 3;
export const MAX_EXTERNAL_IMAGE_BYTES = 5_000_000;
const ALLOWED_IMAGE_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_LOREM_FLICKR_TAGS = 2;
const LOREM_FLICKR_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "arranged",
  "as",
  "at",
  "artistic",
  "authentic",
  "background",
  "badge",
  "banner",
  "beautiful",
  "black",
  "blue",
  "bold",
  "bright",
  "brown",
  "by",
  "campaign",
  "clean",
  "close-up",
  "commercial",
  "conceptual",
  "contrast",
  "detailed",
  "discount",
  "dramatic",
  "e-commerce",
  "editorial",
  "featured",
  "featuring",
  "flat-lay",
  "for",
  "from",
  "gold",
  "gray",
  "green",
  "grey",
  "happy",
  "hero",
  "high",
  "in",
  "image",
  "into",
  "is",
  "it",
  "its",
  "layout",
  "modern",
  "near",
  "of",
  "on",
  "orange",
  "photo",
  "photograph",
  "photography",
  "picture",
  "pink",
  "product",
  "products",
  "promotional",
  "purple",
  "realistic",
  "red",
  "sale",
  "seasonal",
  "showing",
  "shot",
  "silver",
  "studio",
  "style",
  "styled",
  "tag",
  "tags",
  "that",
  "the",
  "this",
  "to",
  "white",
  "with",
  "yellow",
  "young",
]);

class ImageOriginExcludedError extends Error {
  constructor() {
    super("The image provider target matches an excluded page origin.");
    this.name = "ImageOriginExcludedError";
  }
}

class ExternalImageTooLargeError extends Error {
  constructor() {
    super("The external image exceeded the byte limit.");
    this.name = "ExternalImageTooLargeError";
  }
}

interface ExcludedNetworkTargets {
  origins: Set<string>;
  hostnames: Set<string>;
}

function excludedNetworkTargets(values: readonly string[] = []): ExcludedNetworkTargets {
  const origins = new Set<string>();
  const hostnames = new Set<string>();
  for (const value of values) {
    try {
      const url = new URL(value);
      origins.add(url.origin);
      hostnames.add(url.hostname.toLowerCase());
    } catch {
      // Production callers pass schema-validated URLs. Ignore malformed test or
      // future optional entries instead of accidentally widening the allowlist.
    }
  }
  return { origins, hostnames };
}

function isExcludedImageTarget(url: URL, excluded: ExcludedNetworkTargets): boolean {
  return excluded.origins.has(url.origin) || excluded.hostnames.has(url.hostname.toLowerCase());
}

function isAllowedImageUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  const allowedHost = hostname === "loremflickr.com"
    || hostname === "www.loremflickr.com"
    || hostname === "staticflickr.com"
    || hostname.endsWith(".staticflickr.com");
  return url.protocol === "https:" && !url.username && !url.password
    && (!url.port || url.port === "443") && allowedHost;
}

function assertAllowedImageTarget(url: URL, excluded: ExcludedNetworkTargets): void {
  if (isExcludedImageTarget(url, excluded)) {
    throw new ImageOriginExcludedError();
  }
  if (!isAllowedImageUrl(url)) {
    throw new Error("image URL is outside the provider allowlist");
  }
}

async function cancelResponseBody(response: Response, reason?: unknown): Promise<void> {
  try {
    await response.body?.cancel(reason);
  } catch {
    // Redirect/error response bodies may already be closed by the fetch layer.
  }
}

async function fetchAllowlistedImage(
  initialUrl: URL,
  fetchImplementation: typeof fetch,
  signal: AbortSignal,
  excluded: ExcludedNetworkTargets,
): Promise<Response> {
  let current = new URL(initialUrl);
  for (let redirectCount = 0; redirectCount <= MAX_IMAGE_REDIRECTS; redirectCount += 1) {
    assertAllowedImageTarget(current, excluded);
    const response = await fetchImplementation(current, {
      signal,
      redirect: "manual",
      headers: { Accept: "image/*" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirectCount === MAX_IMAGE_REDIRECTS) {
        await cancelResponseBody(response);
        throw new Error("too many image redirects");
      }
      const location = response.headers.get("location");
      if (!location) {
        await cancelResponseBody(response);
        throw new Error("image redirect has no location");
      }
      let next: URL;
      try {
        next = new URL(location, current);
        assertAllowedImageTarget(next, excluded);
      } catch (error) {
        await cancelResponseBody(response, error);
        throw error;
      }
      await cancelResponseBody(response);
      current = next;
      continue;
    }
    if (response.url) {
      try {
        assertAllowedImageTarget(new URL(response.url), excluded);
      } catch (error) {
        await cancelResponseBody(response, error);
        throw error;
      }
    }
    return response;
  }
  throw new Error("image redirect limit reached");
}

async function abortResponse(
  response: Response,
  controller: AbortController,
  reason: Error,
): Promise<void> {
  await cancelResponseBody(response, reason);
  controller.abort(reason);
}

async function readBoundedImageBody(
  response: Response,
  controller: AbortController,
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_EXTERNAL_IMAGE_BYTES) {
    const error = new ExternalImageTooLargeError();
    await abortResponse(response, controller, error);
    throw error;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("image response has no readable body");
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (totalBytes + value.byteLength > MAX_EXTERNAL_IMAGE_BYTES) {
        const error = new ExternalImageTooLargeError();
        try {
          await reader.cancel(error);
        } catch {
          // Cancellation is best-effort; abort below still closes the request.
        }
        controller.abort(error);
        throw error;
      }
      chunks.push(value);
      totalBytes += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  if (totalBytes === 0) {
    throw new Error("image response body is empty");
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function dimensions(aspect: string): { width: number; height: number } {
  const match = aspect.match(/^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/);
  const ratio = match ? Number(match[1]) / Number(match[2]) : 16 / 9;
  // The resolved image is embedded as a data URL in a self-contained page.
  // Feed thumbnails rarely render above 320px, so 480px preserves useful
  // density without turning a twelve-card page into a multi-megabyte artifact.
  const width = 480;
  const height = Math.max(180, Math.min(720, Math.round(width / (Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9))));
  return { width, height };
}

function colors(seed: string): [string, string, string] {
  const digest = createHash("sha256").update(seed).digest("hex");
  const hue = Number.parseInt(digest.slice(0, 4), 16) % 360;
  return [`hsl(${hue} 70% 44%)`, `hsl(${(hue + 48) % 360} 78% 64%)`, `hsl(${(hue + 205) % 360} 55% 24%)`];
}

function escapeSvg(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function localPlaceholder(intent: ImageIntent, source: "off" | "local" = "local"): ResolvedImage {
  const { width, height } = dimensions(intent.aspect);
  if (source === "off") {
    return {
      src: svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#e2e8f0"/></svg>`),
      width,
      height,
      source,
    };
  }

  const [start, end, ink] = colors(`${intent.artifactSeed}:${intent.index}:${intent.query}`);
  const label = escapeSvg(intent.query.split(",")[0]?.trim().slice(0, 80) || "Generated image intent");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeSvg(intent.alt)}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${start}"/><stop offset="1" stop-color="${end}"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/><circle cx="${Math.round(width * 0.78)}" cy="${Math.round(height * 0.28)}" r="${Math.round(Math.min(width, height) * 0.18)}" fill="white" opacity=".18"/>
    <path d="M0 ${Math.round(height * 0.76)} C ${Math.round(width * 0.24)} ${Math.round(height * 0.52)}, ${Math.round(width * 0.52)} ${Math.round(height * 0.98)}, ${width} ${Math.round(height * 0.58)} V${height}H0Z" fill="${ink}" opacity=".5"/>
    <text x="${Math.round(width * 0.06)}" y="${Math.round(height * 0.88)}" fill="white" font-family="ui-sans-serif,system-ui" font-size="${Math.round(Math.min(width, height) * 0.07)}" font-weight="700">${label}</text>
  </svg>`;
  return { src: svgDataUri(svg), width, height, source };
}

class OffResolver implements ImageIntentResolver {
  async resolve(intent: ImageIntent): Promise<ResolvedImage> {
    return { ...localPlaceholder(intent, "off"), omitted: true };
  }
}

class LocalResolver implements ImageIntentResolver {
  async resolve(intent: ImageIntent): Promise<ResolvedImage> {
    return {
      ...localPlaceholder(intent),
      omitted: true,
      warning: {
        code: "local-image-provider-unavailable",
        message: "No local image provider is configured, so the image intent was omitted.",
      },
    };
  }
}

export class TagPlaceholderResolver implements ImageIntentResolver {
  readonly #cache = new Map<string, ResolvedImage>();
  readonly #excludedTargets: ExcludedNetworkTargets;

  constructor(
    private readonly options: {
      fetchExternal: boolean;
      safeContent: boolean;
      fetchImplementation?: typeof fetch;
      excludedOrigins?: readonly string[];
    },
  ) {
    this.#excludedTargets = excludedNetworkTargets(options.excludedOrigins);
  }

  async resolve(intent: ImageIntent, signal: AbortSignal): Promise<ResolvedImage> {
    if (!this.options.fetchExternal) {
      return {
        ...localPlaceholder(intent, "off"),
        source: "tag-placeholder",
        omitted: true,
        warning: {
          code: "external-images-disabled",
          message: "LoremFlickr fetching is disabled, so the unresolved image intent was omitted.",
        },
      };
    }

    const { width, height } = dimensions(intent.aspect);
    const tags = intent.query
      .split(/[,\s]+/)
      .map((part) => part.toLowerCase().replace(/[^a-z0-9-]/g, ""))
      .map((part) => part.replace(/^-+|-+$/g, ""))
      .filter((part) => part.length > 1 && !LOREM_FLICKR_STOP_WORDS.has(part))
      .filter((part, index, values) => values.indexOf(part) === index)
      .slice(0, MAX_LOREM_FLICKR_TAGS);
    if (tags.length === 0) {
      tags.push("abstract");
    }
    const tagList = tags.join(",");
    const selection = (hashInt(`${intent.artifactSeed}:${intent.index}:${tagList}`) % 99_999) + 1;
    const cacheKey = `${width}:${height}:${tagList}:${selection}:${this.options.safeContent}`;
    const cached = this.#cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const tagPath = tags.map((tag) => encodeURIComponent(tag)).join(",");
    const url = new URL(`https://loremflickr.com/${width}/${height}/${tagPath}`);
    url.searchParams.set("lock", String(selection));
    // LoremFlickr documents a distinct `random` value as the cache-buster for
    // multiple images on one page. Keep `lock` as well so a persisted artifact
    // continues to show the same selected photo when it is reopened.
    url.searchParams.set("random", String(selection));
    if (this.options.safeContent) {
      url.searchParams.set("safe_search", "1");
    }

    // Production pages reference the same LoremFlickr service directly, just
    // like galyunet. The image then arrives independently after the HTML and
    // behaves like an ordinary slow-network resource instead of bloating the
    // artifact with a base64 copy. Injected fetch implementations are retained
    // for deterministic resolver and redirect-boundary tests.
    if (!this.options.fetchImplementation) {
      const resolved: ResolvedImage = {
        src: url.href,
        width,
        height,
        source: "tag-placeholder",
      };
      this.#cache.set(cacheKey, resolved);
      return resolved;
    }

    const fetchImplementation = this.options.fetchImplementation;
    const requestController = new AbortController();
    try {
      const response = await fetchAllowlistedImage(
        url,
        fetchImplementation,
        AbortSignal.any([signal, AbortSignal.timeout(8_000), requestController.signal]),
        this.#excludedTargets,
      );
      const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
      if (!response.ok || !contentType || !ALLOWED_IMAGE_MEDIA_TYPES.has(contentType)) {
        await abortResponse(response, requestController, new Error("unusable image response"));
        throw new Error("unusable image response");
      }
      const bytes = await readBoundedImageBody(response, requestController);
      const resolved: ResolvedImage = {
        src: `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`,
        width,
        height,
        source: "tag-placeholder",
      };
      this.#cache.set(cacheKey, resolved);
      return resolved;
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      if (error instanceof ImageOriginExcludedError) {
        return {
          ...localPlaceholder(intent, "off"),
          source: "tag-placeholder",
          omitted: true,
          warning: {
            code: "image-provider-origin-excluded",
            message: "The LoremFlickr target matched the imagined page origin, so the image intent was omitted.",
          },
        };
      }
      return {
        ...localPlaceholder(intent, "off"),
        source: "tag-placeholder",
        omitted: true,
        warning: {
          code: "image-resolution-failed",
          message: "The LoremFlickr image could not be fetched, so the image intent was omitted.",
        },
      };
    }
  }
}

function hashInt(value: string): number {
  return Number.parseInt(createHash("sha256").update(value).digest("hex").slice(0, 8), 16);
}

export function createImageResolver(
  settings: ImageSettings,
  options: { excludedOrigins?: readonly string[] } = {},
): ImageIntentResolver {
  switch (settings.mode) {
    case "off":
      return new OffResolver();
    case "local":
      return new LocalResolver();
    case "tag-placeholder":
      return new TagPlaceholderResolver({
        fetchExternal: settings.fetchExternal,
        safeContent: settings.safeContent,
        ...(options.excludedOrigins ? { excludedOrigins: options.excludedOrigins } : {}),
      });
  }
}
