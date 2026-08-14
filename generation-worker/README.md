# vibesurfer generation worker

This directory is an isolated TypeScript process that turns virtual HTTP(S) locations into validated page artifacts. It communicates exclusively as newline-delimited JSON on stdin/stdout. Provider credentials arrive in an input message, remain in an in-memory registry for the lifetime of the request, and are never accepted as command-line arguments, persisted, or echoed.

## Local development

Requirements: Node.js 22 or newer. All npm dependencies are pinned exactly, including AI SDK 7 (`ai@7.0.59`), the official OpenAI/Anthropic/Google adapters, the OpenAI-compatible adapter, Tailwind 4.3.3, TypeScript 7.0.2, and Vitest 4.1.10.

```sh
npm ci
npm run verify
node dist/index.js
```

The Tauri host discovers `generation-worker/dist/index.js` and launches it with Node in development. If the compiled output is absent and Bun is installed, it can launch `generation-worker/src/index.ts` directly.

## Protocol v1

Every input and output is one complete JSON object followed by `\n`. stdout is reserved for protocol output. The worker never emits raw provider errors because SDK errors can carry request metadata.

### Initialize

The Rust host starts each worker with:

```json
{"type":"initialize","requestId":"init-1","protocolVersion":1,"client":{"name":"vibesurfer","version":"0.1.0"}}
```

The worker responds:

```json
{"type":"initialized","requestId":"init-1","protocolVersion":1,"workerVersion":"0.1.0","capabilities":{"generationStages":["page-director","page-builder"],"providers":["mock","openai","anthropic","google","openai-compatible","codex"]}}
```

`codex` is not treated as an OpenAI API-key provider. The Rust host authenticates and canonicalizes the request, then starts the worker with a host-owned absolute Codex executable path. The worker runs schema-constrained stages through Codex App Server with an empty read-only workspace, project context, tools, network access, and persistence disabled. Accumulated agent-message deltas feed the same partial-output path as streaming SDK providers.

### Generate

The host-facing command is:

```json
{
  "type": "generate",
  "requestId": "request-1",
  "jobId": "job-1",
  "request": {
    "profileId": "personal",
    "siteWorldId": "site-example-v1",
    "url": "https://example.com/news",
    "browserTheme": "native",
    "provider": {
      "id": "openai-personal",
      "kind": "openai",
      "displayName": "OpenAI",
      "modelId": "MODEL_ID_SELECTED_BY_THE_HOST"
    },
    "worldPromptSnapshot": {
      "revision": 3,
      "prompt": "Prefer a restrained editorial world."
    },
    "settings": {
      "style": { "tailwindEnabled": true, "tailwindVersion": "4.3.3" },
      "images": {
        "enabled": true,
        "provider": "local-library",
        "safeContent": true,
        "allowExternalRequests": false
      },
      "maxOutputTokens": 20000,
      "minInternalLinks": 12,
      "maxArtifactBytes": 1000000
    },
    "context": {
      "siteWorld": null,
      "sourcePage": null,
      "relevantHistory": [],
      "parentArtifactId": null,
      "identityStrategy": "reuse",
      "navigationIntent": {
        "trigger": "link",
        "disposition": "current",
        "requestedUrl": "https://example.com/news",
        "linkText": "Latest news",
        "surroundingText": "Explore today's briefing"
      }
    }
  },
  "credential": "IN_MEMORY_ONLY"
}
```

`provider` may be `mock`, `openai`, `anthropic`, `google`, `openai-compatible`, or `codex`. OpenAI-compatible connections require an HTTPS `baseUrl`. The deterministic mock is explicit: a normal API provider without a credential fails with `provider-not-configured` and is never presented as a successful real-provider call.

For compatibility with the frontend domain types, the normalizer also accepts `providerId` / `providerKind` / `modelId` at request level, `settings.tailwindEnabled`, and navigation intent outside `context`.

Every uncached page performs exactly two structured requests. `page-director` receives the full versioned capability catalog and returns a new identity when required plus a hybrid page direction. The catalog exposes ten stylistically distinct Iconify prefixes but no individual icon names; Director selects one `iconSet` or `null`. The worker validates the selected fonts/capabilities and sends `page-builder` an approved brief containing only selected contracts plus the selected pack's compact semantic map, flavor names, palette type, and attribution. Builder cannot see alternative packs or change the approved identity, palette, fonts, or favicon. Deterministic compiler/validation failures end the job; there is no model repair stage.

### Generation events

Job events are top-level objects. Every event has `requestId`, `jobId`, monotonically increasing `sequence`, and ISO-8601 `at`.

```text
generation.started
generation.phase       { phase, progress }
generation.metadata    { title?, favicon?, summary? }
generation.preview     { html }                         sanitized accumulated HTML
generation.validation  { issues }
generation.warning     { code, message }
generation.completed   { artifact, usage }
generation.failed      { error: { code, message, retryable } }
generation.cancelled
```

The terminal artifact always includes `id`, `siteId`, `url`, `title`, `html`, `createdAt`, two `modelExchanges`, and `payload`. `payload` preserves the Director-approved identity/direction, favicon, summary, compatible site additions, provider/model, prompt/settings versions, usage, warnings, world-prompt snapshot, and parent artifact linkage when the Rust storage layer projects the record into its smaller database type.

### Cancel

```json
{"type":"cancel","requestId":"cancel-1","jobId":"job-1"}
```

Input continues to be read while model work is in flight. Cancellation aborts the AI SDK request or mock delay and ends with `generation.cancelled`.

### Provider verification

```json
{"type":"provider.verify","requestId":"verify-1","provider":{"id":"anthropic-personal","kind":"anthropic","modelId":"MODEL_ID"},"credential":"IN_MEMORY_ONLY"}
```

The terminal response is `provider.verified` or `provider.failed`. API-key providers receive one tiny schema-constrained request with a 25-second timeout, and mock verification is local. Codex account/catalog compatibility is verified by the Rust host rather than this credentialed command.

The worker also supports versioned `provider.upsert`, `provider.remove`, `provider.list`, `ping`, and `shutdown` messages for a future shared-process host. Their credentials use the same memory-only rules.

## Page compiler

Model output is never sent directly to the iframe. The compiler removes scripts, frames, embeds, base/meta redirects, external stylesheets, inline event handlers, dangerous URL schemes, and CSS imports/URLs. It normalizes navigation URLs, forces forms to GET, injects title/viewport metadata, resolves image intents to the fixed image-provider allowlist, and then validates size, link density, accessibility basics, resource isolation, and compiled styles.

Iconify uses a reproducible local snapshot rather than runtime network access. Refresh it from the official Iconify API with `npm run iconify:catalog`; `scripts/build-iconify-catalog.mjs` reads `/collection`, excludes hidden names, considers aliases and categories, checks expected licenses, selects semantic/flavor names, then fetches only those icons' SVG bodies. Builder authors `<iconify-icon icon="prefix:name">` against that whitelist. During preview and final compilation the worker replaces each approved element's contents with trusted inline SVG, scopes SVG IDs, removes invalid/mixed-set names and the CDN marker, caps icon count, and injects required CC BY attribution. The iframe CSP remains `connect-src 'none'` and executes no Iconify CDN code.

Tailwind mode uses the pinned compiler with Tailwind's complete embedded stock theme, so it needs no CDN or native runtime module. The compiler emits only utilities referenced by the current page and adds no application-owned palette, font, container, radius, shadow, or component theme. Model-supplied class candidates have fixed length/count limits; stock classes and safe arbitrary values are accepted while network-bearing and breakout syntax is rejected. Compiled CSS is sanitized again. If compilation ever fails, a theme-free neutral reset is injected and a warning is emitted.

The default `tag-placeholder` mode maps semantic image intents to direct LoremFlickr URLs, matching galyunet. The page receives no general network ability: both sanitizers and both CSP layers allow only LoremFlickr and its Flickr CDN redirect hosts for image elements. Photos therefore load independently after streamed HTML without base64 artifact bloat. `off` and legacy local modes omit unresolved images rather than replacing them with generated gradients or other invented visuals. At most 24 intents are kept.

The OpenAI-compatible contract test uses the real AI SDK adapter against an ephemeral loopback HTTP provider. It enters directly at the in-memory registry boundary only because the production protocol correctly requires HTTPS provider base URLs; the test asserts that this production schema still rejects its HTTP loopback URL.

## Packaged Tauri sidecar

Use Bun 1.3.14 in the release job for each target and compile a self-contained executable:

```sh
npm ci
npm run sidecar:build
```

The script maps the current OS/architecture to a Rust target triple and writes:

```text
generation-worker/sidecars/vibesurfer-generation-worker-<target-triple>[.exe]
```

For cross-compilation, pass both target names explicitly, for example:

```sh
npm run sidecar:build -- --rust-target x86_64-unknown-linux-gnu --bun-target bun-linux-x64
```

The output extension is derived from the Rust target triple, not the build host or Bun target. Release tooling can inspect the selected path without invoking Bun via `node scripts/build-sidecar.mjs --rust-target <triple> --bun-target <target> --dry-run`.

Point Tauri `bundle.externalBin` at `../generation-worker/sidecars/vibesurfer-generation-worker` (without the target suffix). Tauri selects the suffixed source binary and packages it under the unsuffixed runtime name that `WorkerManager::discover` expects. Build each release target on a matching CI runner and smoke-test `initialize` plus a mock Quick generation before packaging.
