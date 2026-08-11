import { compile } from "tailwindcss";

import type { ArtifactWarning } from "../domain.js";

export const MAX_TAILWIND_CANDIDATES = 1_024;
export const MAX_TAILWIND_CANDIDATE_LENGTH = 128;
const MAX_SCANNED_TAILWIND_CANDIDATES = 4_096;
const SAFE_TAILWIND_CANDIDATE = /^[a-zA-Z0-9_!:/.-]+$/;
const UNSAFE_CSS_OUTPUT = /@import\b|(?:url|expression|(?:-webkit-)?image-set)\s*\(|(?<![\w-])(?:-moz-binding|behavior)\s*:|<\/style/i;

const SAFE_FALLBACK_CSS = `
:root{color-scheme:light;--vs-ink:#0f172a;--vs-muted:#475569;--vs-paper:#f8fafc;--vs-line:#dbe3ef;--vs-accent:#2563eb}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;min-height:100vh;background:var(--vs-paper);color:var(--vs-ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.5}
img{display:block;max-width:100%;height:auto}a{color:inherit;text-underline-offset:.18em}button,input,select,textarea{font:inherit}button{cursor:pointer}
:focus-visible{outline:3px solid var(--vs-accent);outline-offset:3px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
header,main,footer,section,nav{min-width:0}main>section,header>nav,footer{width:min(1120px,calc(100% - 2rem));margin-inline:auto}.grid{display:grid}.flex{display:flex}.hidden{display:none}.block{display:block}.inline-flex{display:inline-flex}.flex-wrap{flex-wrap:wrap}.items-center{align-items:center}.items-end{align-items:flex-end}.justify-between{justify-content:space-between}
.gap-2{gap:.5rem}.gap-3{gap:.75rem}.gap-4{gap:1rem}.gap-5{gap:1.25rem}.gap-6{gap:1.5rem}.gap-8{gap:2rem}.p-4{padding:1rem}.p-5{padding:1.25rem}.p-6{padding:1.5rem}.px-4{padding-inline:1rem}.py-5{padding-block:1.25rem}.py-8{padding-block:2rem}.py-10{padding-block:2.5rem}.py-16{padding-block:4rem}.mt-2{margin-top:.5rem}.mt-4{margin-top:1rem}.mt-6{margin-top:1.5rem}
.w-full{width:100%}.max-w-2xl{max-width:42rem}.max-w-4xl{max-width:56rem}.max-w-6xl{max-width:72rem}.mx-auto{margin-inline:auto}.aspect-video{aspect-ratio:16/9}.object-cover{object-fit:cover}.overflow-hidden{overflow:hidden}
.rounded{border-radius:.25rem}.rounded-lg{border-radius:.5rem}.rounded-xl{border-radius:.75rem}.rounded-2xl{border-radius:1rem}.border{border:1px solid var(--vs-line)}.border-b{border-bottom:1px solid var(--vs-line)}.border-t{border-top:1px solid var(--vs-line)}.bg-white{background:#fff}.bg-slate-50{background:#f8fafc}.text-slate-950{color:#020617}.text-slate-900{color:#0f172a}.text-slate-600{color:#475569}.text-slate-500{color:#64748b}.text-blue-700{color:#1d4ed8}.text-blue-600{color:#2563eb}
.text-xs{font-size:.75rem}.text-sm{font-size:.875rem}.text-lg{font-size:1.125rem}.text-xl{font-size:1.25rem}.text-2xl{font-size:1.5rem}.text-3xl{font-size:1.875rem}.text-5xl{font-size:3rem}.font-medium{font-weight:500}.font-semibold{font-weight:600}.font-bold{font-weight:700}.font-black{font-weight:900}.uppercase{text-transform:uppercase}.tracking-wide{letter-spacing:.025em}.tracking-tight{letter-spacing:-.025em}.leading-6{line-height:1.5}.leading-8{line-height:2rem}.shadow-sm{box-shadow:0 1px 2px rgb(15 23 42/.08)}.antialiased{-webkit-font-smoothing:antialiased}
@media(min-width:640px){.sm\\:grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.sm\\:px-6{padding-inline:1.5rem}.sm\\:text-7xl{font-size:4.5rem}}@media(min-width:1024px){.lg\\:grid-cols-3{grid-template-columns:repeat(3,minmax(0,1fr))}.lg\\:items-end{align-items:flex-end}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
`.trim();

const EMBEDDED_TAILWIND_SOURCE = `
@theme {
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  --color-white: #ffffff;
  --color-slate-50: #f8fafc;
  --color-slate-100: #f1f5f9;
  --color-slate-200: #e2e8f0;
  --color-slate-300: #cbd5e1;
  --color-slate-500: #64748b;
  --color-slate-600: #475569;
  --color-slate-700: #334155;
  --color-slate-800: #1e293b;
  --color-slate-900: #0f172a;
  --color-slate-950: #020617;
  --color-blue-50: #eff6ff;
  --color-blue-100: #dbeafe;
  --color-blue-500: #3b82f6;
  --color-blue-600: #2563eb;
  --color-blue-700: #1d4ed8;
  --color-emerald-500: #10b981;
  --color-amber-500: #f59e0b;
  --color-red-500: #ef4444;
  --spacing: 0.25rem;
  --container-sm: 24rem;
  --container-md: 28rem;
  --container-lg: 32rem;
  --container-xl: 36rem;
  --container-2xl: 42rem;
  --container-4xl: 56rem;
  --container-6xl: 72rem;
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.125rem;
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;
  --text-3xl: 1.875rem;
  --text-4xl: 2.25rem;
  --text-5xl: 3rem;
  --text-6xl: 3.75rem;
  --text-7xl: 4.5rem;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;
  --font-weight-black: 900;
  --tracking-tight: -0.025em;
  --tracking-wide: 0.025em;
  --radius-lg: 0.5rem;
  --radius-xl: 0.75rem;
  --radius-2xl: 1rem;
  --radius-full: 9999px;
  --shadow-sm: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
  --aspect-video: 16 / 9;
  --breakpoint-sm: 40rem;
  --breakpoint-md: 48rem;
  --breakpoint-lg: 64rem;
  --breakpoint-xl: 80rem;
}
@tailwind utilities;
`.trim();

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

function safeCandidate(candidate: string): boolean {
  if (
    candidate.length === 0
    || candidate.length > MAX_TAILWIND_CANDIDATE_LENGTH
    || !SAFE_TAILWIND_CANDIDATE.test(candidate)
    || candidate.includes("[")
    || candidate.includes("]")
  ) {
    return false;
  }
  const lowered = candidate.toLowerCase();
  return !lowered.includes("url")
    && !lowered.includes("@import")
    && !lowered.includes("expression")
    && !lowered.includes("javascript");
}

/**
 * Tailwind class names originate in model output. Keep the accepted language
 * intentionally smaller than Tailwind's full grammar: arbitrary-value and
 * arbitrary-variant brackets are disabled by the product settings and could
 * otherwise synthesize network-bearing CSS.
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
 * Final defense after the trusted compiler. Generated artifact CSS has no
 * reason to fetch resources, import stylesheets, or contain a closing style
 * tag, even if a future Tailwind release changes candidate handling.
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
    const compiler = await compile(EMBEDDED_TAILWIND_SOURCE);
    const generated = compiler.build(filtered.candidates);
    const css = sanitizeCompiledCss(`${SAFE_FALLBACK_CSS}\n${generated}`);
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
      css: sanitizeCompiledCss(SAFE_FALLBACK_CSS),
      usedFallback: true,
      warning: {
        code: "style-compilation-failed",
        message: "Tailwind compilation was unavailable; the safe deterministic stylesheet was used.",
      },
    };
  }
}

export function safeFallbackCss(): string {
  return sanitizeCompiledCss(SAFE_FALLBACK_CSS);
}
