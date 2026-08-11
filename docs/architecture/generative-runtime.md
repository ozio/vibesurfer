# ADR: generative browser runtime

Status: accepted for implementation.

## Product semantics

VibeSurfer treats an HTTP(S) address as a request to imagine the page at that
address. It does not contact that origin. Opening the real website is a
separate, explicit action.

- `vibe://` routes are trusted internal application surfaces.
- HTTP(S), bare domains and relative links are virtual locations.
- Fragment-only links stay inside the current artifact.
- `mailto:` and `tel:` require an explicit external action.
- `javascript:`, `data:`, `file:` and unknown schemes are rejected as navigation targets.
- Back and forward restore an existing artifact without calling a model.
- Reload re-renders the artifact; regenerate creates a new artifact version.

## Trust boundaries

```text
trusted React chrome
    | typed Tauri commands and ordered channels
Rust host
    | supervised JSONL over stdin/stdout
TypeScript generation worker
    | provider SDK requests
model providers

trusted React chrome
    | one private MessageChannel per artifact
sandboxed generated iframe
```

The Rust host owns secrets, persistent artifacts, process supervision and
profile boundaries. The worker receives a credential only in memory for the
request that needs it. Neither the React persistence layer nor generated page
content receives credentials.

Generated documents run with `sandbox="allow-scripts"`, without same-origin,
popup, download, top-navigation or form privileges. The only executable script
is the trusted runtime embedded in the local artifact-frame shell.

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
{"type":"generation.preview","jobId":"...","sequence":1,"fragment":{}}
{"type":"generation.completed","jobId":"...","artifact":{},"usage":{}}
{"type":"generation.failed","jobId":"...","error":{}}
{"type":"generation.cancelled","jobId":"..."}
{"type":"provider.verified","requestId":"...","result":{}}
```

Events for an inactive or superseded `jobId` are ignored. Sequence-bearing
events are monotonic. The host treats malformed lines as a worker protocol
failure, never as page content.

## Generation modes

Quick uses one structured model generation. It emits metadata as soon as it is
available, then validates and commits one HTML artifact.

Deep performs:

1. site architecture;
2. page planning;
3. page construction;
4. deterministic validation;
5. at most one model-assisted repair when required.

The immutable protocol instruction, editable generation instruction,
mode-specific instruction and bounded navigation context are separate prompt
layers. User-editable text cannot remove protocol or security requirements.

## Artifact compilation

Before an artifact is committed, the worker or host compiler must:

1. parse the complete document;
2. remove base tags, meta refresh, frames, objects, embeds, external scripts,
   event-handler attributes and unsafe URL schemes;
3. normalize virtual links and image intents;
4. compile Tailwind classes into static CSS when enabled;
5. resolve image intents into cached local assets or deterministic fallbacks;
6. serialize only passive sanitized markup for the trusted frame shell;
7. enforce document, CSS and message-size limits;
8. persist the validated artifact before making it current.

Tailwind is restricted to artifact compilation. Browser chrome continues to
use semantic CSS tokens.

## Iframe protocol

Each artifact mounts the local, self-contained `artifact-frame.html` shell. Its
only script is a classic host-owned runtime whose exact bytes are SHA-256-pinned
by both the application CSP and the shell's zero-network CSP; generated scripts
are removed before transport. The fragment carries only the bounded artifact ID
and base64url nonce. Each runtime execution creates a cryptographically random
instance ID and announces it through a bounded bootstrap retry. The parent
verifies the current `contentWindow`, instance ID, nonce and artifact ID before
transferring a fresh `MessageChannel`.

The shell first sends `ready-for-render`. The parent then sends exactly one
identity-bound sanitized display payload, capped at 4 MiB, over the private
port. The shell applies a second active-content, URL and CSS sanitizer, replaces
only passive body/styles while preserving its fixed CSP/runtime, and finally
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
- Quick and Deep work with a deterministic mock provider and at least one BYOK
  provider.
- Tailwind/images enabled and disabled combinations are tested.
- The packaged desktop application can start, supervise and recover its worker.
