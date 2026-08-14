import { compile } from "tailwindcss";

import type { ArtifactWarning } from "../domain.js";
import { TAILWIND_DEFAULT_THEME } from "./tailwind-default-theme.js";

export const MAX_TAILWIND_CANDIDATES = 1_024;
export const MAX_TAILWIND_CANDIDATE_LENGTH = 256;
const MAX_SCANNED_TAILWIND_CANDIDATES = 4_096;
const SAFE_TAILWIND_CANDIDATE = /^[a-zA-Z0-9_!:/.,%#()[\]+*='~\-]+$/;
const UNSAFE_CSS_OUTPUT = /@import\b|(?:url|expression|(?:-webkit-)?image-set)\s*\(|(?<![\w-])(?:-moz-binding|behavior)\s*:|<\/style/i;

// This is only an emergency reset when the bundled Tailwind compiler fails.
// It deliberately contains no palette, font, container width, radii, shadows,
// or component styling that could make unrelated destinations look alike.
const NEUTRAL_FALLBACK_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}body{margin:0}
img,svg,video,canvas{display:block;max-width:100%;height:auto}
button,input,select,textarea{font:inherit}button{cursor:pointer}
[hidden]{display:none!important}
`.trim();

// Tailwind is bundled as a compiler plus its complete stock theme. `inline`
// resolves stock tokens into each used utility, so artifacts get only the CSS
// for their own literal class list and no application-owned visual theme.
const EMBEDDED_TAILWIND_SOURCE = `${TAILWIND_DEFAULT_THEME}\n@tailwind utilities;`;

export interface CompiledStyles {
  css: string;
  usedFallback: boolean;
  warning?: ArtifactWarning;
}

export interface FilteredTailwindCandidates {
  candidates: string[];
  rejected: boolean;
  truncated: boolean;
}

let compilerPromise: ReturnType<typeof compile> | undefined;

function tailwindCompiler(): ReturnType<typeof compile> {
  compilerPromise ??= compile(EMBEDDED_TAILWIND_SOURCE);
  return compilerPromise;
}

function bracketsAreBalanced(candidate: string): boolean {
  let depth = 0;
  for (const character of candidate) {
    if (character === "[") depth += 1;
    if (character === "]") depth -= 1;
    if (depth < 0 || depth > 2) return false;
  }
  return depth === 0;
}

function safeCandidate(candidate: string): boolean {
  if (
    candidate.length === 0
    || candidate.length > MAX_TAILWIND_CANDIDATE_LENGTH
    || !SAFE_TAILWIND_CANDIDATE.test(candidate)
    || !bracketsAreBalanced(candidate)
  ) {
    return false;
  }
  const lowered = candidate.toLowerCase();
  return !lowered.includes("url")
    && !lowered.includes("@import")
    && !lowered.includes("expression")
    && !lowered.includes("javascript")
    && !lowered.includes("data:")
    && !lowered.includes("http:")
    && !lowered.includes("https:");
}

/**
 * Tailwind class names originate in model output. Stock utilities and safe
 * arbitrary values are accepted; CSS syntax that could break out of one
 * declaration or fetch a resource is rejected before compilation.
 */
export function filterTailwindCandidates(candidates: readonly string[]): FilteredTailwindCandidates {
  const accepted = new Set<string>();
  let rejected = false;
  let truncated = candidates.length > MAX_SCANNED_TAILWIND_CANDIDATES;
  const scanCount = Math.min(candidates.length, MAX_SCANNED_TAILWIND_CANDIDATES);

  for (let index = 0; index < scanCount; index += 1) {
    const candidate = candidates[index] ?? "";
    if (!safeCandidate(candidate)) {
      rejected = true;
      continue;
    }
    if (!accepted.has(candidate) && accepted.size >= MAX_TAILWIND_CANDIDATES) {
      truncated = true;
      continue;
    }
    accepted.add(candidate);
  }

  return {
    candidates: [...accepted].sort(),
    rejected,
    truncated,
  };
}

/**
 * Final defense after the trusted compiler. Artifact CSS never needs resource
 * fetching, stylesheet imports, or a closing style tag.
 */
export function sanitizeCompiledCss(css: string): string {
  return css
    .replace(/@import\b[^;{}]*(?:;|$)/gi, "")
    .replace(/(?:url|expression|(?:-webkit-)?image-set)\s*\([^)]*\)/gi, "none")
    .replace(/(?<![\w-])(?:-moz-binding|behavior)\s*:[^;{}]*(?:;|$)/gi, "")
    .replaceAll("<", "\\3c ");
}

export async function compileTailwind(candidates: string[]): Promise<CompiledStyles> {
  try {
    const filtered = filterTailwindCandidates(candidates);
    const compiler = await tailwindCompiler();
    const css = sanitizeCompiledCss(compiler.build(filtered.candidates));
    if (!css.trim() || UNSAFE_CSS_OUTPUT.test(css)) {
      throw new Error("Tailwind emitted unsafe or empty CSS");
    }
    return {
      css,
      usedFallback: false,
      ...((filtered.rejected || filtered.truncated)
        ? {
            warning: {
              code: "style-candidates-filtered",
              message: "Unsafe or excessive Tailwind class candidates were ignored.",
            },
          }
        : {}),
    };
  } catch {
    return {
      css: sanitizeCompiledCss(NEUTRAL_FALLBACK_CSS),
      usedFallback: true,
      warning: {
        code: "style-compilation-failed",
        message: "Tailwind compilation was unavailable; a neutral reset was used.",
      },
    };
  }
}

export function safeFallbackCss(): string {
  return sanitizeCompiledCss(NEUTRAL_FALLBACK_CSS);
}
