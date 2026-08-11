# VibeSurfer generation worker

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
{"type":"initialized","requestId":"init-1","protocolVersion":1,"workerVersion":"0.1.0","capabilities":{"modes":["quick","deep"],"providers":["mock","openai","anthropic","google","openai-compatible","codex"]}}
```

`codex` is advertised only as a routing boundary. It is not treated as an OpenAI API provider. A Codex generation receives `provider-route-required`; the Rust host must route it through its separate Codex App Server adapter.

### Generate

The host-facing command is:

```json
{
  "type": "generate",
  "requestId": "request-1",
  "jobId": "job-1",
  "request": {
    "url": "https://example.com/news",
    "mode": "quick",
    "provider": {
      "id": "openai-personal",
      "kind": "openai",
      "displayName": "OpenAI",
      "modelId": "MODEL_ID_SELECTED_BY_THE_HOST"
    },
    "editableInstruction": "Prefer a restrained editorial design.",
    "settings": {
      "style": { "tailwindEnabled": true, "tailwindVersion": "4.3.3" },
      "images": {
        "enabled": true,
        "provider": "local-library",
        "safeContent": true,
        "allowExternalRequests": false
      },
      "autoRepair": true,
      "maxRequests": 4,
      "maxOutputTokens": 20000,
      "minInternalLinks": 12,
      "maxArtifactBytes": 1000000
    },
    "context": {
      "siteWorld": null,
      "sourcePage": null,
      "relevantHistory": [],
      "parentArtifactId": null,
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

Quick mode performs exactly one structured model request. Deep mode performs site architecture, page planning, and page building as three requests, followed by no more than one repair request when deterministic validation reports an error and `maxRequests` permits it.

### Generation events

Job events are top-level objects. Every event has `requestId`, `jobId`, monotonically increasing `sequence`, and ISO-8601 `at`.

```text
generation.started
generation.phase       { phase, progress }
generation.metadata    { title?, favicon?, summary? }
generation.preview     { html }                         reserved for progressive rendering
generation.validation  { issues, repairWillRun }
generation.warning     { code, message }
generation.completed   { artifact, usage }
generation.failed      { error: { code, message, retryable } }
generation.cancelled
```

The terminal artifact always includes `id`, `siteId`, `url`, `title`, `html`, `createdAt`, and `payload`. `payload` preserves favicon, summary, site patch, provider/model/mode, prompt/settings versions, usage, warnings, and parent artifact linkage when the Rust storage layer projects the record into its smaller database type.

### Cancel

```json
{"type":"cancel","requestId":"cancel-1","jobId":"job-1"}
```

Input continues to be read while model work is in flight. Cancellation aborts the AI SDK request or mock delay and ends with `generation.cancelled`.

### Provider verification

```json
{"type":"provider.verify","requestId":"verify-1","provider":{"id":"anthropic-personal","kind":"anthropic","modelId":"MODEL_ID"},"credential":"IN_MEMORY_ONLY"}
```

The terminal response is `provider.verified` or `provider.failed`. Real providers receive one tiny schema-constrained request with a 25-second timeout. Mock verification is local. Codex returns `provider-route-required` so it can be verified by the host-owned App Server path.

The worker also supports versioned `provider.upsert`, `provider.remove`, `provider.list`, `ping`, and `shutdown` messages for a future shared-process host. Their credentials use the same memory-only rules.

## Page compiler

Model output is never sent directly to the iframe. The compiler removes scripts, frames, embeds, base/meta redirects, external stylesheets, inline event handlers, dangerous URL schemes, CSS imports/URLs, and direct image sources. It normalizes navigation URLs, forces forms to GET, injects title/viewport metadata, resolves image intents, and then validates size, link density, accessibility basics, resource isolation, and compiled styles.

Tailwind mode uses the pinned Tailwind compiler with an embedded deterministic theme, so it needs no CDN or native runtime module. Model-supplied class candidates have fixed length/count limits, and arbitrary square-bracket utilities are rejected before compilation. Compiled CSS is sanitized again to remove imports and network-bearing functions. If compilation ever fails, a safe deterministic stylesheet is injected and a warning is emitted.

Image modes are `off`, `local`, and `tag-placeholder`; the latter downloads through the worker only when external access is explicitly enabled and otherwise falls back locally. External resolution keeps the imagined page origin/host on an exclusion list and checks the initial provider URL, every redirect, and the final response URL against both that list and the fixed provider allowlist. A page cannot cause its own imagined origin to be contacted by choosing an image-provider hostname. At most 24 image intents are kept, at most four resolve concurrently, and each response body is streamed under a 5,000,000-byte cap with early reader cancellation and request abort.

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
