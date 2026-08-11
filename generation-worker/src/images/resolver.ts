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
  warning?: ArtifactWarning;
}

export interface ImageIntentResolver {
  resolve(intent: ImageIntent, signal: AbortSignal): Promise<ResolvedImage>;
}

const MAX_IMAGE_REDIRECTS = 3;
export const MAX_EXTERNAL_IMAGE_BYTES = 5_000_000;
const ALLOWED_IMAGE_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

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
  const width = 1280;
  const height = Math.max(320, Math.min(1280, Math.round(width / (Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9))));
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
    return localPlaceholder(intent, "off");
  }
}

class LocalResolver implements ImageIntentResolver {
  async resolve(intent: ImageIntent): Promise<ResolvedImage> {
    return localPlaceholder(intent);
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
        ...localPlaceholder(intent),
        warning: {
          code: "external-images-disabled",
          message: "The tag-placeholder provider was selected, but external image fetching is disabled; a local placeholder was used.",
        },
      };
    }

    const { width, height } = dimensions(intent.aspect);
    const tags = intent.query
      .split(/[,\s]+/)
      .map((part) => part.toLowerCase().replace(/[^a-z0-9-]/g, ""))
      .filter(Boolean)
      .slice(0, 5)
      .join(",") || "abstract";
    const lock = hashInt(`${intent.artifactSeed}:${intent.index}`) % 100_000;
    const cacheKey = `${width}:${height}:${tags}:${lock}:${this.options.safeContent}`;
    const cached = this.#cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const url = new URL(`https://loremflickr.com/${width}/${height}/${encodeURIComponent(tags)}`);
    url.searchParams.set("lock", String(lock));
    if (this.options.safeContent) {
      url.searchParams.set("safe_search", "1");
    }

    const fetchImplementation = this.options.fetchImplementation ?? fetch;
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
          ...localPlaceholder(intent),
          warning: {
            code: "image-provider-origin-excluded",
            message: "The external image provider matched the imagined page origin; a deterministic local placeholder was used.",
          },
        };
      }
      return {
        ...localPlaceholder(intent),
        warning: {
          code: "image-resolution-failed",
          message: "The tag-placeholder image could not be fetched; a deterministic local placeholder was used.",
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
