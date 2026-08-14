# ADR: generative browser runtime

Status: accepted for implementation.

## Product semantics

vibesurfer treats an HTTP(S) address as a request to imagine the page at that
address. It does not contact that origin. Opening the real website is a
separate, explicit action.

- `vibe://` routes are trusted internal application surfaces.
- HTTP(S), bare domains and relative links are virtual locations.
- Fragment-only links stay inside the current artifact.
- `mailto:` and `tel:` require an explicit external action.
- `javascript:`, `data:`, `file:` and unknown schemes are rejected as navigation targets.
- Back and forward restore an existing artifact without calling a model.
- Reload/regenerate preserves the active SiteWorld identity and its world-prompt snapshot.
- Reimagine creates a candidate incarnation and switches identity only after its first artifact commits.

## Trust boundaries

```text
trusted React chrome
    | typed Tauri commands and ordered channels
Rust host
    | supervised JSONL over stdin/stdout
TypeScript generation worker
    | provider SDK requests or hardened system Codex App Server
model providers

trusted React chrome
    | one private MessageChannel per artifact
sandboxed generated iframe
```

The Rust host owns secrets, persistent artifacts, process supervision and
profile boundaries. The worker receives a credential only in memory for the
request that needs it. Neither the React persistence layer nor generated page
content receives credentials.

For the system Codex route, Rust discovers an authenticated compatible binary,
validates its App Server model catalog, canonicalizes model/effort/service-tier,
and passes only the absolute executable path to that job's worker process. The
worker starts its App Server over stdio with an ephemeral read-only empty
workspace, project context/network/apps/shell tools disabled, schema-constrained
turns, and a sanitized environment. App Server agent-message deltas are
accumulated for progressive preview; ChatGPT credentials remain owned and read
by Codex itself.

Generated documents run with `sandbox="allow-scripts"`, without same-origin,
popup, download, top-navigation or form privileges. The trusted runtime is
always present. Generated JavaScript is disabled by default and may execute
only when the user explicitly opts in for newly generated artifacts.

## Worker protocol

The transport is newline-delimited JSON. Every client request has a unique
`requestId`. Generation requests also have a unique `jobId`.

### Host to worker

```json
{"type":"initialize","requestId":"...","protocolVersion":1,"client":{"name":"vibesurfer","version":"0.1.0"}}
{"type":"generate","requestId":"...","jobId":"...","request":{}}
{"type":"cancel","requestId":"...","jobId":"..."}
{"type":"provider.verify","requestId":"...","provider":{},"credential":"..."}
{"type":"shutdown","requestId":"..."}
```

Credentials must never appear in command-line arguments, event payloads,
diagnostic logs or persisted request bodies.

### Worker to host

```json
{"type":"initialized","requestId":"...","protocolVersion":1,"capabilities":{}}
{"type":"generation.started","jobId":"...","at":"..."}
{"type":"generation.phase","jobId":"...","phase":"generating","message":"..."}
{"type":"generation.metadata","jobId":"...","metadata":{}}
{"type":"generation.preview","jobId":"...","sequence":1,"html":"<!doctype html>..."}
{"type":"generation.completed","jobId":"...","artifact":{},"usage":{}}
{"type":"generation.failed","jobId":"...","error":{}}
{"type":"generation.cancelled","jobId":"..."}
{"type":"provider.verified","requestId":"...","result":{}}
```

Events for an inactive or superseded `jobId` are ignored. Sequence-bearing
events are monotonic. The host treats malformed lines as a worker protocol
failure, never as page content.

## Directed generation

Every uncached page performs exactly two model exchanges using one selected
model/reasoning/service-tier tuple:

1. `page-director` receives the URL, navigation context, profile world-prompt
   snapshot, SiteWorld/history, and the complete versioned capability catalog.
   A new origin yields a canonical `SiteIdentity` and page-specific
   `PageDirection`; an existing origin supplies its frozen identity and accepts
   only compatible facts/routes additions.
2. The host validates all selected fonts and capabilities and constructs an
   `ApprovedPageBrief`. `page-builder` receives that brief and only the selected
   capability contracts, never the catalog of alternatives. It returns page
   metadata, summary, and HTML without authority to change identity, palette,
   fonts, or favicon.

Sanitization, compilation, image resolution, and validation are deterministic.
There is no model-assisted repair. A failed candidate leaves the prior committed
artifact and SiteWorld unchanged. Cache hits, static history restores, and
same-document fragment navigation perform zero model exchanges.

The immutable protocol instruction and profile world-prompt snapshot remain
separate prompt layers. User-editable text cannot remove protocol or security
requirements.

## Profile workspaces and SiteWorld incarnations

Profiles own independent tabs, chrome skin, model controls, mutable generation
preferences, history, artifacts, provider connections, and SiteWorlds. A
profile world prompt is revisioned; a new SiteWorld captures a snapshot, while
existing and restored incarnations keep their original snapshot.

At most one SiteWorld incarnation is active for a `(profileId, origin)` pair.
Artifacts and URL cache entries are keyed by `(profileId, siteWorldId, URL)`.
Reimagine and restore perform atomic active/archive swaps so an archived page can
never silently seed generation in another incarnation.

## Artifact compilation

Before an artifact is committed, the worker or host compiler must:

1. parse the complete document;
2. remove base tags, meta refresh, frames, objects, embeds, external/module
   scripts, event-handler attributes and unsafe URL schemes; remove every
   generated script unless the request explicitly opted in to inline classic
   JavaScript;
3. normalize virtual links and image intents;
4. resolve Director-selected, whitelist-checked Iconify elements from the generated local catalog into inline SVG and inject required attribution; remove the declarative CDN marker without executing it or opening an Iconify network channel;
5. compile Tailwind classes into static CSS when enabled;
6. resolve image intents to ordinary URLs on the allowlisted LoremFlickr/Flickr CDN service so media loads independently after the HTML, omitting intents when image access is disabled;
7. serialize sanitized markup plus the artifact's explicit script-execution
   bit for the trusted frame shell;
8. enforce document, CSS and message-size limits;
9. persist the validated artifact before making it current.

Tailwind is restricted to artifact compilation. The worker embeds the complete
stock Tailwind theme, compiles only the page's literal utilities (including
safe arbitrary values), and never injects an application visual theme. Browser
chrome continues to use semantic CSS tokens.

## Iframe protocol

Each artifact mounts the local, self-contained `artifact-frame.html` shell. Its
host-owned runtime is SHA-256-pinned by both the application CSP and the shell's
image-only allowlisted CSP. When an artifact explicitly opts in, sanitized inline
classic scripts are transported with `executeScripts: true` and re-created only
with the shell's dedicated CSP nonce after the final body is installed; preview
renders never execute them. The fragment carries only the bounded artifact ID
and base64url nonce. Each runtime execution creates a cryptographically random
instance ID and announces it through a bounded bootstrap retry. The parent
verifies the current `contentWindow`, instance ID, nonce and artifact ID before
transferring a fresh `MessageChannel`.

The shell first sends `ready-for-render`. The parent then sends exactly one
identity-bound sanitized display payload, capped at 4 MiB, over the private
port. The shell applies a second active-content, URL and CSS sanitizer, replaces
the body/styles while preserving its fixed CSP/runtime, optionally runs the
bounded opted-in scripts, and finally
sends `ready`. A lifetime bootstrap listener can replace a stale private channel
if WebKit restarts the shell; repeated or previously accepted instance IDs do
not churn or resurrect channels. Subsequent events use only the active private
port and runtime schema validation.

Allowed frame events are:

- ready-for-render and ready handshake stages;
- current/background/foreground virtual navigation;
- fragment navigation;
- safe GET form navigation;
- bounded title updates;
- sanitized runtime errors.

Frame messages can never name or invoke Tauri commands, provider operations,
filesystem paths or arbitrary network requests.

## Persistence

SQLite stores artifacts, site worlds, summaries, jobs, navigation edges,
provider metadata, prompt templates, usage and cached-asset metadata. A
platform credential vault stores provider secrets. Zustand persists lightweight
UI and session references only.

Schema and protocol versions are explicit. Migrations preserve prior sessions
when possible and discard unsafe or structurally invalid generated content.

## Release gates

- A typed URL makes no request to the entered origin.
- Link, middle-click, modifier-click and target-blank navigation are covered by
  integration tests.
- Back/forward do not invoke a provider.
- Cancellation terminates provider work and stale events cannot replace a
  newer page.
- No credential is present in Zustand, localStorage, artifact HTML or logs.
- Malicious artifact fixtures cannot access Tauri, navigate the top frame,
  open popups, submit network forms or start network connections.
- Director and Builder work with a deterministic mock provider and at least one
  BYOK provider, and each uncached success records exactly those two exchanges.
- Tailwind, images, and generated-JavaScript enabled/disabled combinations are
  tested. The JavaScript path additionally requires a real-browser CSP smoke.
- The packaged desktop application can start, supervise and recover its worker.
