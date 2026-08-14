# ADR: browser content surfaces

Status: superseded by `generative-runtime.md`. This file records a possible
future native real-web surface; it is not implemented in the current release.

## Decision

vibesurfer separates trusted browser chrome from page content.

```text
Tauri window
├── trusted chrome WebView
│   └── React tabs, omnibox, settings, model/account controls
└── untrusted page surface
    ├── generated artifact in a sandboxed iframe
    └── future only: arbitrary URL in a native child WebView
```

The `PageSurface` boundary remains. HTTP(S) input belongs to the generated
artifact surface. Current legacy remote tabs are network-inert and the only
live-web action opens the URL explicitly in the system browser. A remote child
WebView would be required only if a future in-app "open actual website" mode is
approved; it is not on the current generative-browser critical path.

## Why remote pages need a child WebView

- Many sites deny framing with `X-Frame-Options` or CSP `frame-ancestors`.
- Cross-origin iframes do not expose usable URL, history, title, favicon or navigation state to the React chrome.
- Granting Tauri capabilities to remote content would collapse the app's main security boundary.
- Generated HTML is also untrusted, but a sandboxed iframe is appropriate because vibesurfer owns the artifact and its communication protocol.

Tauri references: [WebView API](https://v2.tauri.app/reference/javascript/api/namespacewebview/), [capabilities](https://v2.tauri.app/security/capabilities/), [multiwebview migration note](https://v2.tauri.app/start/migrate/from-tauri-1/#multiwebview-support).

## Future native spike acceptance criteria

Implement one remote child WebView before creating a WebView per tab:

1. create and destroy it asynchronously;
2. position it below the React chrome and resize it with the window/sidebar;
3. navigate, reload, stop, back and forward;
4. forward load start/finish, URL and document-title changes into the tab store;
5. handle `window.open`, downloads and external-protocol URLs;
6. hide it for internal/settings/generated surfaces;
7. prove that omnibox suggestions, Radix menus and dialogs are not occluded;
8. deny all Tauri capabilities to the page WebView;
9. verify macOS, Windows WebView2, Linux X11 and Linux Wayland.

Tauri's Rust `WebviewBuilder`/child-WebView path currently requires the `unstable` feature. On Windows, create it from an async command or dedicated task instead of a synchronous command/event handler. Pin the Tauri minor version when the platform-specific `with_webview` escape hatch becomes necessary.

## Overlay geometry

CSS `z-index` does not order two native WebView surfaces. Before showing an omnibox dropdown or model popover over page content, the implementation must do one of the following:

- reserve an overlay area in the trusted chrome WebView and temporarily shrink/shift the page WebView;
- hide the page WebView while a full-screen internal surface is active;
- use a dedicated native overlay window/WebView;
- use native menus for system context-menu cases.

The current single-WebView prototype exercises the desired overlays, but passing this native geometry test is a release gate.

## Tabs and resources

Do not create an unlimited live WebView for every tab. Keep browser-tab state independent from the rendering object and use a bounded live-view pool. Suspended tabs retain location/history metadata and recreate their view on activation.

## Profiles

A browser profile is a complete workspace projected into the current window:
tabs, active tab, immutable chrome skin, world-prompt revision, model controls,
generation preferences, history, artifacts, provider connections, and
SiteWorld incarnations switch together. Background jobs retain their original
profile/tab binding when another profile becomes active.

Profile definitions and lightweight workspace state remain in frontend
persistence. Heavy artifacts and SiteWorlds are host-side and profile-scoped;
provider tokens stay in the operating-system credential store and never enter
Zustand, local storage, or a page surface.
