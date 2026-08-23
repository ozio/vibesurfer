;(() => {
  "use strict";

  const PROTOCOL = "vibesurfer:artifact-bridge";
  const VERSION = 4;
  const MAX_ARTIFACT_ID_LENGTH = 512;
  const MAX_NONCE_LENGTH = 128;
  const MAX_PAGE_URL_LENGTH = 4_096;
  const MAX_RENDER_MESSAGE_BYTES = 4 * 1024 * 1024;
  const MAX_RENDER_HTML_LENGTH = MAX_RENDER_MESSAGE_BYTES;
  const MAX_GENERATED_SCRIPT_COUNT = 16;
  const MAX_GENERATED_SCRIPT_LENGTH = 256 * 1024;
  const MAX_DYNAMIC_ACTION_BYTES = 32 * 1024;
  const MAX_DYNAMIC_PATCH_BYTES = 256 * 1024;
  const MAX_DYNAMIC_REGION_HTML_LENGTH = 64 * 1024;
  const GENERATED_SCRIPT_NONCE = "dmliaWVzdXJmZXItYXJ0aWZhY3Q";
  const BOOTSTRAP_INTERVAL_MS = 150;
  const MAX_BOOTSTRAP_ATTEMPTS = 32;
  const BLOCKED_ELEMENTS = "base,object,embed,iframe,frame,frameset,applet,portal,template,foreignObject,link,meta[http-equiv]";
  const URL_ATTRIBUTES = new Set(["href", "src", "action", "poster", "cite", "background"]);
  const REMOVED_ATTRIBUTES = new Set([
    "srcdoc", "ping", "download", "formaction", "formtarget", "nonce", "integrity",
    "autofocus", "autoplay", "srcset",
  ]);

  const safeUrl = (raw, base) => {
    try {
      const resolved = new URL(raw, base);
      return (resolved.protocol === "http:" || resolved.protocol === "https:")
        && !resolved.username && !resolved.password
        ? resolved
        : null;
    } catch {
      return null;
    }
  };

  const estimateBytes = (value) => {
    try {
      return new TextEncoder().encode(JSON.stringify(value)).byteLength;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  };

  const sanitizeCss = (value) => String(value || "")
    .replace(/@import\s+(?:url\([^)]*\)|["'][^"']*["'])\s*[^;]*;?/gi, "")
    .replace(/url\(\s*(["']?)(?!data:|blob:|#)[^)]*\1\s*\)/gi, "none")
    .replace(/expression\s*\([^)]*\)/gi, "")
    .replace(/(?:^|;)\s*(?:behavior|-moz-binding)\s*:[^;]*/gi, "");

  const safeEmbeddedAsset = (value) => {
    if (value.startsWith("blob:")) return true;
    if (!value.startsWith("data:") || value.length > 2 * 1024 * 1024) return false;
    return /^data:(?:image\/(?:avif|gif|jpeg|jpg|png|svg\+xml|webp)|audio\/(?:mpeg|ogg|wav)|video\/(?:mp4|webm));/i.test(value);
  };

  const safeImageAsset = (value) => {
    if (safeEmbeddedAsset(value)) return true;
    try {
      const url = new URL(value);
      const hostname = url.hostname.toLowerCase();
      if ((url.protocol === "vibeasset:" && hostname === "localhost"
          || url.protocol === "http:" && hostname === "vibeasset.localhost")
          && /^\/image\/[A-Za-z0-9_-]{1,4096}$/.test(url.pathname)) return true;
      return url.protocol === "https:" && !url.username && !url.password
        && (!url.port || url.port === "443")
        && (hostname === "loremflickr.com" || hostname === "www.loremflickr.com"
          || hostname === "staticflickr.com" || hostname.endsWith(".staticflickr.com"));
    } catch {
      return false;
    }
  };

  const sanitizeIncomingDocument = (incoming, baseUrl, allowGeneratedScripts) => {
    for (const element of incoming.querySelectorAll(BLOCKED_ELEMENTS)) element.remove();
    const scripts = [];
    let scriptLength = 0;
    for (const script of incoming.querySelectorAll("script")) {
      const type = (script.getAttribute("type") || "").trim().toLowerCase();
      const classicScript = !type || type === "text/javascript" || type === "application/javascript";
      const source = script.textContent || "";
      if (allowGeneratedScripts && !script.hasAttribute("src") && classicScript
          && scripts.length < MAX_GENERATED_SCRIPT_COUNT
          && scriptLength + source.length <= MAX_GENERATED_SCRIPT_LENGTH) {
        scripts.push(source);
        scriptLength += source.length;
      }
      script.remove();
    }
    for (const style of incoming.querySelectorAll("style")) {
      style.textContent = sanitizeCss(style.textContent);
    }
    for (const element of incoming.querySelectorAll("*")) {
      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim();
        if (name.startsWith("on") || REMOVED_ATTRIBUTES.has(name)) {
          element.removeAttribute(attribute.name);
          continue;
        }
        if (name === "style") {
          const sanitized = sanitizeCss(attribute.value);
          if (sanitized) element.setAttribute(attribute.name, sanitized);
          else element.removeAttribute(attribute.name);
          continue;
        }
        if (!URL_ATTRIBUTES.has(name) && name !== "xlink:href") continue;
        if ((name === "href" || name === "xlink:href") && element.matches("a, area")) {
          if (value.startsWith("#")) continue;
          const resolved = safeUrl(value, baseUrl);
          if (resolved) element.setAttribute(attribute.name, resolved.href);
          else element.removeAttribute(attribute.name);
          continue;
        }
        if (name === "action" && element instanceof HTMLFormElement) {
          const resolved = safeUrl(value, baseUrl);
          if (resolved) element.setAttribute(attribute.name, resolved.href);
          else element.removeAttribute(attribute.name);
          continue;
        }
        if (element instanceof HTMLImageElement && safeImageAsset(value)) continue;
        if (!safeEmbeddedAsset(value)) element.removeAttribute(attribute.name);
      }
      if (element instanceof HTMLAnchorElement || element instanceof HTMLAreaElement) {
        const rel = new Set(element.rel.toLowerCase().split(/\s+/).filter(Boolean));
        rel.add("noopener");
        rel.add("noreferrer");
        element.rel = [...rel].filter((token) => ["license", "noopener", "noreferrer"].includes(token)).join(" ");
        const target = element.getAttribute("target");
        if (target && target !== "_blank" && target !== "_self") element.removeAttribute("target");
      }
      if (element instanceof HTMLFormElement) element.removeAttribute("target");
    }
    return scripts;
  };

  const config = new URLSearchParams(location.hash.slice(1));
  const artifactId = config.get("artifactId") || "";
  const nonce = config.get("nonce") || "";
  let pageUrl = "https://artifact.invalid/";
  if (!artifactId || artifactId.length > MAX_ARTIFACT_ID_LENGTH) return;
  if (!nonce || nonce.length > MAX_NONCE_LENGTH || !/^[A-Za-z0-9_-]+$/.test(nonce)) return;
  // The opaque frame needs the bridge identity only during trusted bootstrap.
  // Remove it from the visible URL before any generated script can execute.
  try {
    history.replaceState(null, "", `${location.pathname}${location.search}`);
  } catch {
    // Sandboxed WebViews may reject history mutation; the bridge still keeps
    // strict source, identity, and private-port validation as a fallback.
  }
  const instanceBytes = new Uint8Array(18);
  crypto.getRandomValues(instanceBytes);
  let instanceBinary = "";
  for (const byte of instanceBytes) instanceBinary += String.fromCharCode(byte);
  const instanceId = btoa(instanceBinary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

  let port = null;
  let rendered = false;
  let bootstrapTimer;
  let bootstrapAttempts = 0;
  let capabilityCleanups = [];
  let renderedRevision = -1;
  let finalScriptsExecuted = false;
  let audioContext = null;
  const pseudoVideoStates = new WeakMap();
  let dynamicManifest = null;
  let voiceSettings = { musicMode: "built-in" };
  let mediaPermissions = { narrationEnabled: true, externalMediaEnabled: false };
  let sessionRevision = 0;
  const regionRevisions = new Map();
  const dynamicRequests = new Map();
  const compact = (value, limit) => String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, limit);
  const send = (type, payload = {}) => {
    if (!port) return;
    port.postMessage(Object.assign({}, payload, {
      protocol: PROTOCOL,
      version: VERSION,
      type,
      artifactId,
      nonce,
    }));
  };

  const scrollToHash = (hash) => {
    if (!hash || hash === "#") {
      window.scrollTo({ top: 0, behavior: "auto" });
      return;
    }
    let id = hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      // Keep the literal id when an artifact emits malformed escaping.
    }
    const target = document.getElementById(id) || document.getElementsByName(id)[0];
    if (target) target.scrollIntoView({ block: "start" });
  };

  const contextFor = (anchor) => {
    const container = anchor.closest("article, li, nav, header, footer, section, p") || anchor.parentElement;
    return compact(container && container.textContent, 1_024);
  };

  const linkContextFor = (anchor) => compact(anchor.getAttribute("data-vibe-context"), 1_024);

  const dispositionFor = (event, anchor) => {
    if (event.shiftKey) return "foreground-tab";
    if (event.button === 1 || event.metaKey || event.ctrlKey || anchor.target === "_blank") {
      return "background-tab";
    }
    return "current";
  };

  const sameDocumentHash = (rawHref) => {
    const current = safeUrl(pageUrl, pageUrl);
    const resolved = safeUrl(rawHref, pageUrl);
    if (!current || !resolved) return null;
    const hash = rawHref.startsWith("#") ? rawHref : resolved.hash;
    if (!hash || resolved.origin !== current.origin
        || resolved.pathname !== current.pathname || resolved.search !== current.search) return null;
    return { href: resolved.href, hash };
  };

  const reducedMotion = () => {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  };

  const clearCapabilityRuntime = () => {
    for (const cleanup of capabilityCleanups.splice(0)) {
      try { cleanup(); } catch { /* A stale capability must not block the next document. */ }
    }
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch { /* unavailable */ }
    if (audioContext) {
      try { void audioContext.close(); } catch { /* unavailable */ }
      audioContext = null;
    }
  };

  const REGION_ID = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
  const DYNAMIC_ACTION = /^(?:state:(?:cart\.add|cart\.remove|cart\.setQuantity|wishlist\.toggle|value\.set)|model:[a-z][a-z0-9.-]{0,63})$/;
  const normalizeDynamicManifest = (value) => {
    if (!value || typeof value !== "object" || value.version !== 1
        || !Array.isArray(value.regions) || value.regions.length > 16
        || !Array.isArray(value.actions) || value.actions.length > 32
        || !Array.isArray(value.bindings) || value.bindings.length > 64) return null;
    const regions = [];
    const regionIds = new Set();
    for (const region of value.regions) {
      if (!region || typeof region !== "object" || !REGION_ID.test(region.id)
          || regionIds.has(region.id)) return null;
      if (region.refreshSeconds !== undefined
          && (!Number.isInteger(region.refreshSeconds) || region.refreshSeconds < 60 || region.refreshSeconds > 3_600)) return null;
      regions.push({ id: region.id, ...(region.refreshSeconds ? { refreshSeconds: region.refreshSeconds } : {}) });
      regionIds.add(region.id);
    }
    const actions = [];
    for (const action of value.actions) {
      if (!action || typeof action !== "object" || !DYNAMIC_ACTION.test(action.action)
          || (action.execution !== "state" && action.execution !== "model")
          || !Array.isArray(action.targets) || action.targets.length > 16
          || !action.action.startsWith(`${action.execution}:`)
          || new Set(action.targets).size !== action.targets.length
          || action.targets.some((target) => !regionIds.has(target))) return null;
      actions.push({ action: action.action, execution: action.execution, targets: [...new Set(action.targets)] });
    }
    const bindings = value.bindings.filter((binding) => typeof binding === "string"
      && /^(?:cart\.(?:count|total)|wishlist\.count|value\.[A-Za-z][A-Za-z0-9_.-]{0,63})$/.test(binding));
    if (bindings.length !== value.bindings.length) return null;
    return { version: 1, regions, actions, bindings, localTabs: value.localTabs === true };
  };

  const directRegion = (regionId) => Array.from(document.querySelectorAll("[data-vibe-region]"))
    .find((element) => element.getAttribute("data-vibe-region") === regionId) || null;

  const snapshotsFor = (regionIds) => regionIds.flatMap((regionId) => {
    const region = directRegion(regionId);
    if (!region) return [];
    return [{ regionId, html: region.innerHTML.slice(0, MAX_DYNAMIC_REGION_HTML_LENGTH), revision: regionRevisions.get(regionId) || 0 }];
  });

  const fieldsFor = (form, submitter) => {
    const fields = Object.create(null);
    let formData;
    try { formData = submitter ? new FormData(form, submitter) : new FormData(form); }
    catch { formData = new FormData(form); }
    for (const [name, value] of formData.entries()) {
      if (typeof value !== "string" || !name || name.length > 512 || value.length > 2_000) continue;
      const values = fields[name] || (fields[name] = []);
      if (values.length < 32) values.push(value);
    }
    return fields;
  };

  const manifestActionFor = (element) => {
    if (!dynamicManifest) return null;
    const action = (element.getAttribute("data-vibe-action") || "").trim();
    const targets = [...new Set((element.getAttribute("data-vibe-target") || "").trim().split(/\s+/).filter(Boolean))];
    return dynamicManifest.actions.find((candidate) => candidate.action === action
      && candidate.targets.length === targets.length
      && candidate.targets.every((target) => targets.includes(target))) || null;
  };

  const sendDynamicAction = (source, submitter, cached) => {
    const manifestAction = cached ? cached.manifestAction : manifestActionFor(source);
    if (!manifestAction) return false;
    const fields = cached ? cached.fields : source instanceof HTMLFormElement
      ? fieldsFor(source, submitter)
      : Object.create(null);
    const requestId = crypto.randomUUID();
    const payload = {
      requestId,
      action: manifestAction.action,
      targets: manifestAction.targets,
      fields,
      regions: snapshotsFor(manifestAction.targets),
    };
    if (estimateBytes(payload) > MAX_DYNAMIC_ACTION_BYTES) {
      reportError("The dynamic action was too large.");
      return true;
    }
    dynamicRequests.set(requestId, { source, submitter, manifestAction, fields });
    send("dynamic-action", payload);
    return true;
  };

  const setRequestPending = (requestId, regionIds) => {
    const request = dynamicRequests.get(requestId);
    if (request) {
      const controls = request.source instanceof HTMLFormElement
        ? request.source.querySelectorAll("button, input[type=submit]")
        : [request.source];
      request.controls = Array.from(controls).map((control) => ({ control, disabled: control.disabled }));
      request.controls.forEach(({ control }) => { control.disabled = true; });
    }
    for (const regionId of regionIds) {
      const region = directRegion(regionId);
      if (!region) continue;
      region.setAttribute("aria-busy", "true");
      region.querySelectorAll('[data-vibesurfer-dynamic-status="pending"]').forEach((status) => status.remove());
      const status = document.createElement("div");
      status.setAttribute("data-vibesurfer-dynamic-status", "pending");
      status.setAttribute("role", "status");
      status.textContent = "Updating…";
      region.append(status);
    }
  };

  const finishRequest = (requestId) => {
    const request = dynamicRequests.get(requestId);
    if (request && request.controls) request.controls.forEach(({ control, disabled }) => { control.disabled = disabled; });
    for (const regionId of request?.manifestAction.targets || []) {
      const region = directRegion(regionId);
      if (!region) continue;
      region.removeAttribute("aria-busy");
      region.querySelectorAll('[data-vibesurfer-dynamic-status="pending"]').forEach((status) => status.remove());
    }
    dynamicRequests.delete(requestId);
  };

  const sanitizeDynamicFragment = (html) => {
    if (typeof html !== "string" || html.length > MAX_DYNAMIC_REGION_HTML_LENGTH) return null;
    const template = document.createElement("template");
    template.innerHTML = html;
    for (const element of template.content.querySelectorAll("base,body,embed,head,html,iframe,link,meta,object,script,style,template")) element.remove();
    for (const element of template.content.querySelectorAll("*")) {
      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase();
        if (name.startsWith("on") || name === "style" || name === "srcdoc"
            || name.startsWith("data-vibe-") || ["src", "srcset", "poster", "action", "formaction"].includes(name)) {
          element.removeAttribute(attribute.name);
          continue;
        }
        if (name === "href") {
          const resolved = safeUrl(attribute.value, pageUrl);
          const page = safeUrl(pageUrl, pageUrl);
          if (!resolved || !page || resolved.origin !== page.origin) element.removeAttribute(attribute.name);
          else element.setAttribute(attribute.name, resolved.href);
        }
      }
    }
    return template.content;
  };

  const applyRegionPatches = (message) => {
    if (!Number.isInteger(message.sessionRevision) || message.sessionRevision < sessionRevision
        || !Array.isArray(message.patches) || message.patches.length > 16
        || estimateBytes(message) > MAX_DYNAMIC_PATCH_BYTES) return;
    for (const patch of message.patches) {
      if (!patch || typeof patch !== "object" || !REGION_ID.test(patch.regionId)
          || !Number.isInteger(patch.revision) || patch.revision <= (regionRevisions.get(patch.regionId) || 0)
          || !dynamicManifest?.regions.some((region) => region.id === patch.regionId)) continue;
      const region = directRegion(patch.regionId);
      const fragment = sanitizeDynamicFragment(patch.html);
      if (!region || !fragment) continue;
      region.replaceChildren(fragment);
      regionRevisions.set(patch.regionId, patch.revision);
      region.removeAttribute("aria-busy");
    }
    sessionRevision = message.sessionRevision;
    finishRequest(message.requestId);
    if (message.announcement) {
      const announcement = document.createElement("div");
      announcement.setAttribute("role", "status");
      announcement.setAttribute("aria-live", "polite");
      announcement.hidden = true;
      announcement.textContent = compact(message.announcement, 500);
      document.body.append(announcement);
      window.setTimeout(() => announcement.remove(), 1_000);
    }
  };

  const applyDynamicError = (message) => {
    const request = dynamicRequests.get(message.requestId);
    for (const regionId of Array.isArray(message.regionIds) ? message.regionIds : []) {
      const region = directRegion(regionId);
      if (!region) continue;
      region.removeAttribute("aria-busy");
      region.querySelectorAll("[data-vibesurfer-dynamic-status]").forEach((status) => status.remove());
      const error = document.createElement("div");
      error.setAttribute("data-vibesurfer-dynamic-status", "error");
      error.setAttribute("role", "alert");
      error.append(document.createTextNode(compact(message.message, 1_024) || "Update failed."));
      if (message.retryable === true && request) {
        const retry = document.createElement("button");
        retry.type = "button";
        retry.textContent = "Retry";
        retry.addEventListener("click", (event) => {
          if (!event.isTrusted) return;
          error.remove();
          sendDynamicAction(request.source, request.submitter, request);
        }, { once: true });
        error.append(document.createTextNode(" "), retry);
      }
      region.append(error);
    }
    finishRequest(message.requestId);
  };

  const applyStateSync = (message) => {
    if (!Number.isInteger(message.sessionRevision) || message.sessionRevision < sessionRevision
        || !message.bindings || typeof message.bindings !== "object") return;
    sessionRevision = message.sessionRevision;
    for (const binding of dynamicManifest?.bindings || []) {
      if (typeof message.bindings[binding] !== "string") continue;
      for (const element of document.querySelectorAll("[data-vibe-bind]")) {
        if (element.getAttribute("data-vibe-bind") === binding) element.textContent = message.bindings[binding];
      }
    }
    applyRegionPatches({ requestId: "", sessionRevision, patches: Array.isArray(message.snapshots) ? message.snapshots : [] });
    if (typeof message.requestId === "string") finishRequest(message.requestId);
  };

  const activateTab = (tab) => {
    const tabs = tab.closest("[data-vibe-tabs]");
    if (!tabs) return;
    for (const candidate of tabs.querySelectorAll('[role="tab"]')) {
      const selected = candidate === tab;
      candidate.setAttribute("aria-selected", selected ? "true" : "false");
      candidate.tabIndex = selected ? 0 : -1;
      const panelId = candidate.getAttribute("aria-controls");
      const panel = panelId ? document.getElementById(panelId) : null;
      if (panel && panel.getAttribute("role") === "tabpanel") panel.hidden = !selected;
    }
    tab.focus();
  };

  const enhanceTabs = () => {
    for (const tabs of document.querySelectorAll("[data-vibe-tabs]")) {
      const candidates = Array.from(tabs.querySelectorAll('[role="tab"]'));
      const selected = candidates.find((tab) => tab.getAttribute("aria-selected") === "true") || candidates[0];
      if (selected) activateTab(selected);
    }
  };

  const directSlides = (container) => Array.from(container.children).filter((child) =>
    child.hasAttribute("data-vibe-slide") || child.matches("article, figure")
  );

  const showSlide = (container, requestedIndex) => {
    const slides = directSlides(container);
    if (!slides.length) return 0;
    const index = (requestedIndex + slides.length) % slides.length;
    slides.forEach((slide, slideIndex) => {
      slide.toggleAttribute("hidden", slideIndex !== index);
      slide.setAttribute("data-vibe-slide", "");
      slide.setAttribute("aria-hidden", slideIndex === index ? "false" : "true");
    });
    container.dataset.vibeSlideIndex = String(index);
    const status = container.querySelector("[data-vibe-slide-status]");
    if (status) status.textContent = `${index + 1} / ${slides.length}`;
    return index;
  };

  const setSlideshowPlaying = (container, playing) => {
    const previousTimer = Number(container.dataset.vibeTimer || 0);
    if (previousTimer) window.clearInterval(previousTimer);
    delete container.dataset.vibeTimer;
    container.dataset.vibePlaying = playing ? "true" : "false";
    const playButton = container.querySelector("[data-vibe-play]");
    if (playButton) {
      playButton.setAttribute("aria-pressed", playing ? "true" : "false");
      const playLabel = playButton.getAttribute("data-play-label") || "Play";
      const pauseLabel = playButton.getAttribute("data-pause-label") || "Pause";
      playButton.setAttribute("aria-label", playing ? pauseLabel : playLabel);
    }
    if (!playing || reducedMotion()) return;
    const interval = Math.max(1_500, Math.min(30_000, Number(container.getAttribute("data-interval")) || 4_000));
    const timer = window.setInterval(() => {
      const current = Number(container.dataset.vibeSlideIndex || 0);
      showSlide(container, current + 1);
    }, interval);
    container.dataset.vibeTimer = String(timer);
    capabilityCleanups.push(() => window.clearInterval(timer));
  };

  const playTone = (kind) => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!audioContext || audioContext.state === "closed") audioContext = new AudioContext();
    const context = audioContext;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const frequencies = { confirm: 660, alert: 220, chime: 880, tick: 440 };
    oscillator.frequency.setValueAtTime(frequencies[kind] || frequencies.chime, now);
    oscillator.type = kind === "alert" ? "sawtooth" : "sine";
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.26);
  };

  const formatMediaTime = (milliseconds) => {
    const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  };
  const VIDEO_KINDS = new Set(["title", "text", "image", "split", "quote", "stat", "credits"]);
  const VIDEO_TRANSITIONS = new Set(["cut", "crossfade", "dip-black", "slide-left", "slide-up", "push", "wipe", "zoom", "blur"]);
  const VIDEO_MOTIONS = new Set(["still", "ken-burns-in", "ken-burns-out", "pan-left", "pan-right", "drift", "stagger", "credits-roll"]);
  const VIDEO_ASPECT_RATIOS = new Set(["16:9", "9:16", "4:3", "3:2", "1:1", "4:5", "21:9"]);
  const VIDEO_TRACKS = new Set(["ambient-glass", "documentary-pulse", "warm-memory", "investigative-low", "night-drive", "playful-pluck", "minimal-piano", "soft-suspense", "resolution-rise", "retro-digital", "quiet-nature", "credits-drift", "inherit", "silence"]);
  const LEGACY_VIDEO_MUSIC = { "calm-documentary": "documentary-pulse", "warm-memory": "warm-memory", melancholy: "minimal-piano", "investigative-tension": "investigative-low", danger: "soft-suspense", resolution: "resolution-rise", silence: "silence" };
  const UNSAFE_MEDIA_VALUE = /(?:https?:|data:|blob:|file:|javascript:)/i;
  const safeMediaIdentifier = (value, fallback) => /^[A-Za-z0-9_-]{1,160}$/.test(value || "") ? value : fallback;

  const videoContainers = () => Array.from(document.querySelectorAll("vibe-video, [data-vibe-pseudo-video]"));
  const pseudoVideoScenes = (container) => Array.from(container.querySelectorAll("[data-vibe-scene], [data-vibe-video-scene]"))
    .filter((element) => element.closest("vibe-video, [data-vibe-pseudo-video]") === container)
    .slice(0, 12);

  const provisionalSceneDuration = (scene, pacing) => {
    if (!scene) return pacing === "slow" ? 5_000 : pacing === "fast" ? 3_200 : 4_000;
    const kind = scene.getAttribute("data-kind") || "text";
    const base = kind === "title" ? 2_500 : kind === "credits" ? 6_000 : 4_000;
    const multiplier = pacing === "slow" ? 1.25 : pacing === "fast" ? 0.8 : 1;
    const desired = Number(scene.getAttribute("data-duration-ms"));
    return Math.max(1_000, Math.min(120_000, Number.isFinite(desired) && desired > 0 ? desired : base * multiplier));
  };

  const syncVideoAspectRatio = (container) => {
    const aspectRatio = VIDEO_ASPECT_RATIOS.has(container.getAttribute("data-aspect-ratio"))
      ? container.getAttribute("data-aspect-ratio") : "16:9";
    if (container.getAttribute("data-aspect-ratio") !== aspectRatio) container.setAttribute("data-aspect-ratio", aspectRatio);
    const cssAspectRatio = aspectRatio.replace(":", " / ");
    if (container.style.getPropertyValue("--vibe-video-aspect-ratio") !== cssAspectRatio
        || container.style.getPropertyPriority("--vibe-video-aspect-ratio") !== "important") {
      // Trusted inline !important wins over generated page CSS, so scene
      // content can never resize the media viewport.
      container.style.setProperty("--vibe-video-aspect-ratio", cssAspectRatio, "important");
    }
    return aspectRatio;
  };

  const setTextIfChanged = (element, value) => {
    if (element.textContent !== value) element.textContent = value;
  };

  const authoredVideoControlGroups = (container) => Array.from(container.children).filter((element) => {
    if (element.matches("[data-vibe-scene], [data-vibe-video-scene]")) return false;
    return element.hasAttribute("data-vibe-video-controls")
      || Boolean(element.querySelector("[data-vibe-video-action], [data-vibe-video-play], [data-vibe-video-restart], [data-vibe-video-seek], [data-vibe-video-volume], [data-vibe-video-time]"));
  });

  const normalizeAuthoredVideoControls = (container) => {
    for (const obsolete of container.querySelectorAll('[data-vibe-video-action="fullscreen"], [data-vibe-video-fullscreen]')) obsolete.remove();
    const groups = authoredVideoControlGroups(container);
    for (const group of groups) {
      group.setAttribute("data-vibe-video-controls", "");
      for (const legacy of group.querySelectorAll("[data-vibe-video-play]")) {
        if (!legacy.hasAttribute("data-vibe-video-action")) legacy.setAttribute("data-vibe-video-action", "toggle");
      }
      for (const legacy of group.querySelectorAll("[data-vibe-video-restart]")) {
        if (!legacy.hasAttribute("data-vibe-video-action")) legacy.setAttribute("data-vibe-video-action", "stop");
      }

      const play = Array.from(group.querySelectorAll('[data-vibe-video-action="play"]'));
      const hasPauseOrToggle = Boolean(group.querySelector('[data-vibe-video-action="pause"], [data-vibe-video-action="toggle"]'));
      if (play.length === 1 && !hasPauseOrToggle) play[0].setAttribute("data-vibe-video-action", "toggle");

      if (!group.querySelector("[data-vibe-video-time]")) {
        const time = Array.from(group.querySelectorAll("output, time, span, small, em, p, div")).find((element) =>
          element.children.length === 0 && /^\s*\d{1,3}:\d{2}\s*\/\s*(?:\d{1,3}:\d{2}|--:--)\s*$/.test(element.textContent || ""));
        if (time) time.setAttribute("data-vibe-video-time", "combined");
      }

      if (!group.querySelector("[data-vibe-video-seek]")) {
        const visualSeek = Array.from(group.querySelectorAll("div, span")).find((element) => {
          const hint = `${element.getAttribute("class") || ""} ${element.getAttribute("role") || ""}`;
          return /(?:^|[\s_-])(?:progress|timeline|seek|scrub)(?:$|[\s_-])/i.test(hint)
            && !element.hasAttribute("data-vibe-video-time");
        });
        if (visualSeek) {
          visualSeek.setAttribute("data-vibe-video-seek", "");
          visualSeek.setAttribute("role", "slider");
          visualSeek.setAttribute("tabindex", "0");
          visualSeek.removeAttribute("aria-hidden");
          const fill = visualSeek.firstElementChild;
          if (fill) fill.setAttribute("data-vibe-video-progress-fill", "");
        }
      }
    }
  };

  const createVideoPlan = (state) => {
    const pacing = ["slow", "balanced", "fast"].includes(state.container.getAttribute("data-pacing"))
      ? state.container.getAttribute("data-pacing") : "balanced";
    const scenes = pseudoVideoScenes(state.container).map((element, index) => {
      element.setAttribute("data-vibe-scene", "");
      const kindValue = element.getAttribute("data-kind");
      const transitionValue = element.getAttribute("data-transition");
      const motionValue = element.getAttribute("data-motion");
      const trackValue = element.getAttribute("data-music-track");
      const narration = element.querySelector("[data-vibe-narration]");
      const desired = Number(element.getAttribute("data-duration-ms"));
      return {
        id: element.id || `${state.videoId}-scene-${index + 1}`,
        kind: VIDEO_KINDS.has(kindValue) ? kindValue : element.querySelector("img") ? "image" : "text",
        transition: VIDEO_TRANSITIONS.has(transitionValue) ? transitionValue : "crossfade",
        motion: VIDEO_MOTIONS.has(motionValue) ? motionValue : "still",
        musicTrack: voiceSettings.musicMode !== "off" && VIDEO_TRACKS.has(trackValue) ? trackValue : index === 0 ? "silence" : "inherit",
        ...(Number.isFinite(desired) && desired >= 1_000 ? { desiredDurationMs: Math.min(120_000, desired) } : {}),
        ...(mediaPermissions.narrationEnabled && narration && compact(narration.textContent, 800) ? { narration: {
          text: compact(narration.textContent, 800),
          lang: compact(narration.getAttribute("lang") || document.documentElement.lang || "en", 40),
          ...(compact(narration.getAttribute("data-voice"), 120) ? { voice: compact(narration.getAttribute("data-voice"), 120) } : {}),
        } } : {}),
      };
    });
    const requestedIntent = mediaPermissions.externalMediaEnabled && voiceSettings.musicMode === "generate-if-requested"
      ? compact(state.container.getAttribute("data-music-intent"), 160) : "";
    const intent = requestedIntent && !UNSAFE_MEDIA_VALUE.test(requestedIntent) ? requestedIntent : "";
    const aspectRatio = syncVideoAspectRatio(state.container);
    return { videoId: state.videoId, aspectRatio, pacing, loop: state.container.hasAttribute("loop") || state.container.hasAttribute("data-loop"), ...(intent ? { musicIntent: intent } : {}), scenes };
  };

  const sceneIndexAtVideoTime = (state, currentMs) => {
    if (!state.timeline?.scenes?.length) return 0;
    const index = state.timeline.scenes.findIndex((scene) => currentMs < scene.startMs + scene.durationMs);
    return index >= 0 ? index : state.timeline.scenes.length - 1;
  };

  const transitionFrames = (name) => {
    const frames = {
      cut: [{ opacity: 1 }, { opacity: 1 }],
      crossfade: [{ opacity: 0 }, { opacity: 1 }],
      "dip-black": [{ opacity: 0, filter: "brightness(0)" }, { opacity: 1, filter: "brightness(1)" }],
      "slide-left": [{ opacity: 0, transform: "translateX(9%)" }, { opacity: 1, transform: "translateX(0)" }],
      "slide-up": [{ opacity: 0, transform: "translateY(9%)" }, { opacity: 1, transform: "translateY(0)" }],
      push: [{ opacity: 0, transform: "translateX(16%) scale(.98)" }, { opacity: 1, transform: "translateX(0) scale(1)" }],
      wipe: [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }],
      zoom: [{ opacity: 0, transform: "scale(1.12)" }, { opacity: 1, transform: "scale(1)" }],
      blur: [{ opacity: 0, filter: "blur(18px)" }, { opacity: 1, filter: "blur(0)" }],
    };
    return frames[name] || frames.crossfade;
  };

  const motionFrames = (name) => {
    const frames = {
      "ken-burns-in": [{ transform: "scale(1)" }, { transform: "scale(1.09)" }],
      "ken-burns-out": [{ transform: "scale(1.1)" }, { transform: "scale(1)" }],
      "pan-left": [{ transform: "scale(1.07) translateX(2.5%)" }, { transform: "scale(1.07) translateX(-2.5%)" }],
      "pan-right": [{ transform: "scale(1.07) translateX(-2.5%)" }, { transform: "scale(1.07) translateX(2.5%)" }],
      drift: [{ transform: "scale(1.04) translate3d(-1%,1%,0)" }, { transform: "scale(1.08) translate3d(1%,-1%,0)" }],
      "credits-roll": [{ transform: "translateY(16%)" }, { transform: "translateY(-16%)" }],
    };
    return frames[name] || null;
  };

  const cancelVideoAnimations = (state) => {
    for (const animation of state.animations.splice(0)) {
      try { animation.cancel(); } catch { /* unavailable */ }
    }
  };

  const createVideoAnimation = (target, frames, timing) => {
    // Element.animate() starts immediately. Calling pause() on that pending
    // play task and then assigning currentTime on every media tick is racy in
    // both Chromium and WebKit: once the effect finishes, it can become a new
    // pending play at time zero. A manually constructed Animation starts idle;
    // assigning currentTime gives it a stable hold time without ever playing.
    if (typeof window.Animation === "function" && typeof window.KeyframeEffect === "function" && document.timeline) {
      try {
        return new window.Animation(new window.KeyframeEffect(target, frames, timing), document.timeline);
      } catch { /* fall through for partial WAAPI implementations */ }
    }
    const animation = target.animate(frames, timing);
    try {
      animation.playbackRate = 0;
      animation.pause();
    } catch { /* currentTime below still provides the best available fallback */ }
    return animation;
  };

  const seekVideoAnimation = (animation, currentTime) => {
    try {
      // The media timeline is the only clock. Never call play()/pause() here:
      // either operation can enqueue a new WAAPI playback task while scrubbing.
      animation.currentTime = Math.max(0, currentTime);
    } catch { /* a removed layer may invalidate its animation */ }
  };

  const activateVideoScene = (state, index, sceneTime, duration, poster = false) => {
    const scenes = pseudoVideoScenes(state.container);
    const previous = state.sceneIndex;
    state.sceneIndex = Math.max(0, Math.min(scenes.length - 1, index));
    scenes.forEach((scene, candidate) => {
      scene.toggleAttribute("hidden", candidate !== state.sceneIndex);
      scene.setAttribute("aria-hidden", candidate === state.sceneIndex ? "false" : "true");
    });
    const active = scenes[state.sceneIndex];
    if (!active) return;
    if (previous !== state.sceneIndex) {
      state.container.dispatchEvent(new CustomEvent("scenechange", { detail: { activeSceneIndex: state.sceneIndex } }));
    }
    active.style.setProperty("--vibe-video-progress", String(Math.max(0, Math.min(1, sceneTime / Math.max(1, duration)))));
    if (previous === state.sceneIndex && state.animations.length) {
      if (poster && state.animationPoster) return;
      if (!poster) {
        state.animationPoster = false;
        for (const animation of state.animations) seekVideoAnimation(animation, sceneTime);
        return;
      }
    }
    cancelVideoAnimations(state);
    state.animationPoster = poster;
    if (reducedMotion() || typeof active.animate !== "function") return;
    const transition = active.getAttribute("data-transition") || "crossfade";
    const transitionAnimation = createVideoAnimation(active, transitionFrames(transition), { duration: Math.min(800, duration), easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" });
    seekVideoAnimation(transitionAnimation, poster ? Math.min(800, duration) : Math.min(sceneTime, 800));
    state.animations.push(transitionAnimation);
    const motion = active.getAttribute("data-motion") || "still";
    const layers = Array.from(active.querySelectorAll("[data-vibe-layer]"));
    const targets = layers.length ? layers : [active.querySelector("img")].filter(Boolean);
    const frames = motionFrames(motion);
    if (frames) for (const [layerIndex, layer] of targets.entries()) {
      const animation = createVideoAnimation(layer, frames, { duration, delay: motion === "stagger" ? layerIndex * 90 : 0, easing: "ease-in-out", fill: "both" });
      seekVideoAnimation(animation, sceneTime);
      state.animations.push(animation);
    } else if (motion === "stagger") for (const [layerIndex, layer] of layers.entries()) {
      const animation = createVideoAnimation(layer, [{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 480, delay: layerIndex * 90, fill: "both", easing: "cubic-bezier(.2,.8,.2,1)" });
      seekVideoAnimation(animation, poster ? 480 + layerIndex * 90 : Math.min(sceneTime, 480 + layerIndex * 90));
      state.animations.push(animation);
    }
  };

  const setVideoCaption = (state, activeIndex, localMs) => {
    const caption = state.container.querySelector("[data-vibe-video-caption]");
    if (!caption) return;
    const scene = pseudoVideoScenes(state.container)[activeIndex];
    const narration = compact(scene?.querySelector("[data-vibe-narration]")?.textContent, 800);
    const fallback = compact(scene?.getAttribute("data-caption") || scene?.querySelector("figcaption, [data-caption]")?.textContent, 1_000);
    const words = state.timeline?.scenes?.[activeIndex]?.captionWords;
    if (!words?.length || !narration) {
      if (caption.textContent !== (narration || fallback)) caption.textContent = narration || fallback;
      return;
    }
    const activeWord = words.findIndex((word) => localMs >= word.startMs + 350 && localMs < word.endMs + 350);
    if (caption.dataset.vibeCaptionScene === String(activeIndex) && caption.dataset.vibeCaptionWord === String(activeWord)) return;
    caption.replaceChildren(...words.map((word, index) => {
      const span = document.createElement("span");
      span.textContent = `${word.text}${index < words.length - 1 ? " " : ""}`;
      if (index === activeWord) span.setAttribute("data-vibe-caption-active", "");
      return span;
    }));
    caption.dataset.vibeCaptionScene = String(activeIndex);
    caption.dataset.vibeCaptionWord = String(activeWord);
  };

  const renderPseudoVideo = (state) => {
    let currentMs = state.currentMs;
    if (state.status === "playing") currentMs += Math.max(0, performance.now() - state.syncedAt);
    const displayCurrentMs = Math.max(0, Math.min(state.totalMs || currentMs, currentMs));
    state.displayCurrentMs = displayCurrentMs;
    const activeIndex = state.timeline ? sceneIndexAtVideoTime(state, displayCurrentMs) : Math.max(0, state.sceneIndex);
    const timing = state.timeline?.scenes?.[activeIndex];
    const localMs = timing ? displayCurrentMs - timing.startMs : 0;
    const duration = timing?.durationMs || provisionalSceneDuration(pseudoVideoScenes(state.container)[activeIndex], state.container.getAttribute("data-pacing"));
    const poster = displayCurrentMs === 0 && state.status !== "playing";
    activateVideoScene(state, activeIndex, localMs, duration, poster);
    setVideoCaption(state, activeIndex, localMs);
    state.container.dataset.vibeVideoState = state.status;
    state.container.dataset.vibeVideoMuted = state.muted ? "true" : "false";
    state.container.toggleAttribute("aria-busy", state.status === "preparing" || state.status === "waiting");

    const progress = state.totalMs > 0 ? Math.max(0, Math.min(1, displayCurrentMs / state.totalMs)) : 0;
    for (const range of state.container.querySelectorAll("[data-vibe-video-seek]")) {
      const maximum = Math.max(1, state.totalMs);
      range.setAttribute("aria-valuemin", "0");
      range.setAttribute("aria-valuemax", String(maximum));
      range.setAttribute("aria-valuenow", String(Math.round(displayCurrentMs)));
      range.setAttribute("aria-valuetext", state.timeline
        ? `${formatMediaTime(displayCurrentMs)} of ${formatMediaTime(state.totalMs)}`
        : state.status === "error"
          ? `Video unavailable: ${compact(state.message, 240) || "preparation failed"}`
          : "Timeline is preparing");
      if (!range.hasAttribute("aria-label")) range.setAttribute("aria-label", "Video timeline");
      const progressPercentage = Math.round(progress * 100_000) / 1_000;
      range.style.setProperty("--vibe-video-progress", `${progressPercentage}%`);
      const fill = range.querySelector("[data-vibe-video-progress-fill]");
      if (fill) fill.style.setProperty("inline-size", `${progressPercentage}%`, "important");
      if (range instanceof HTMLInputElement) {
        range.min = "0";
        range.step = "100";
        range.max = String(maximum);
        range.value = String(Math.round(displayCurrentMs));
        range.disabled = !state.timeline;
      } else {
        range.setAttribute("role", "slider");
        if (!range.hasAttribute("tabindex")) range.setAttribute("tabindex", "0");
        range.toggleAttribute("data-vibe-disabled", !state.timeline);
      }
    }
    const currentText = formatMediaTime(displayCurrentMs);
    const durationText = state.timeline ? formatMediaTime(state.totalMs) : "--:--";
    for (const elapsed of state.container.querySelectorAll('[data-vibe-video-time="current"], [data-vibe-video-elapsed]')) setTextIfChanged(elapsed, currentText);
    for (const total of state.container.querySelectorAll('[data-vibe-video-time="duration"], [data-vibe-video-total]')) setTextIfChanged(total, durationText);
    for (const combined of state.container.querySelectorAll('[data-vibe-video-time="combined"]')) setTextIfChanged(combined, `${currentText} / ${durationText}`);
    for (const play of state.container.querySelectorAll('[data-vibe-video-action="toggle"], [data-vibe-video-play]')) {
      const playing = state.status === "playing";
      play.setAttribute("aria-pressed", playing ? "true" : "false");
      play.toggleAttribute("data-vibe-active", playing);
      play.setAttribute("aria-label", playing
        ? (play.getAttribute("data-pause-label") || "Pause video")
        : (play.getAttribute("data-play-label") || "Play video"));
    }
    for (const mute of state.container.querySelectorAll('[data-vibe-video-action="mute"]')) {
      mute.setAttribute("aria-pressed", state.muted ? "true" : "false");
      mute.toggleAttribute("data-vibe-active", state.muted);
      mute.setAttribute("aria-label", state.muted
        ? (mute.getAttribute("data-unmute-label") || "Unmute video")
        : (mute.getAttribute("data-mute-label") || "Mute video"));
    }
    const visibleState = (value) => value === state.status
      || value === "playing" && state.status === "playing"
      || value === "not-playing" && state.status !== "playing"
      || value === "muted" && state.muted
      || value === "unmuted" && !state.muted;
    for (const element of state.container.querySelectorAll("[data-vibe-video-visible-when]")) {
      const values = (element.getAttribute("data-vibe-video-visible-when") || "").split(/[\s,|]+/).filter(Boolean);
      element.hidden = !values.some(visibleState);
    }
    for (const skip of state.container.querySelectorAll('[data-vibe-video-action="skip-music"]')) {
      skip.hidden = !(state.status === "waiting" && state.progress?.label === "Preparing music");
    }
    for (const volume of state.container.querySelectorAll("[data-vibe-video-volume]")) {
      volume.setAttribute("min", "0");
      volume.setAttribute("max", "1");
      volume.setAttribute("step", "0.05");
      volume.setAttribute("aria-valuemin", "0");
      volume.setAttribute("aria-valuemax", "1");
      volume.setAttribute("aria-valuenow", String(state.volume));
      if (!volume.hasAttribute("aria-label")) volume.setAttribute("aria-label", "Video volume");
      if (document.activeElement !== volume) volume.value = String(state.volume);
    }
  };

  const ensureVideoAnimationLoop = (state) => {
    if (state.raf) return;
    const schedule = typeof window.requestAnimationFrame === "function"
      ? (callback) => window.requestAnimationFrame(callback)
      : (callback) => window.setTimeout(() => callback(performance.now()), 16);
    const update = () => {
      state.raf = 0;
      if (state.status !== "playing") return;
      renderPseudoVideo(state);
      state.raf = schedule(update);
    };
    state.raf = schedule(update);
  };

  const requestVideoPlay = (state, trustedGesture = false) => {
    if (!state.timeline) {
      if (state.status === "error") {
        state.prepareRequestId = "";
        state.pendingPlay = false;
        state.playPromise = null;
        state.resolvePlay = null;
        state.rejectPlay = null;
        state.message = "";
      }
      if (!trustedGesture && !navigator.userActivation?.isActive) {
        const error = new DOMException("Video preparation requires a user gesture.", "NotAllowedError");
        return Promise.reject(error);
      }
      if (!state.prepareRequestId) {
        state.prepareRequestId = `media-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        state.pendingPlay = true;
        state.status = "preparing";
        state.container.dispatchEvent(new Event("loadstart"));
        send("media-prepare", { requestId: state.prepareRequestId, plan: createVideoPlan(state) });
        renderPseudoVideo(state);
      } else state.pendingPlay = true;
      return state.playPromise || (state.playPromise = new Promise((resolve, reject) => { state.resolvePlay = resolve; state.rejectPlay = reject; }));
    }
    if (state.status === "ended") send("media-command", { videoId: state.videoId, action: "seek", currentTimeMs: 0 });
    send("media-command", { videoId: state.videoId, action: "play" });
    return Promise.resolve();
  };

  const setVideoCurrentTime = (state, milliseconds) => {
    const value = Math.max(0, Math.min(state.totalMs, Number(milliseconds) || 0));
    state.currentMs = value;
    state.syncedAt = performance.now();
    renderPseudoVideo(state);
    if (state.timeline) send("media-command", { videoId: state.videoId, action: "seek", currentTimeMs: value });
  };

  const requestVideoStop = (state) => {
    state.currentMs = 0;
    state.displayCurrentMs = 0;
    state.syncedAt = performance.now();
    state.status = state.timeline ? "ready" : "idle";
    renderPseudoVideo(state);
    send("media-command", { videoId: state.videoId, action: "stop" });
  };

  const requestVideoMuted = (state, muted) => {
    const changed = state.muted !== Boolean(muted);
    state.muted = Boolean(muted);
    renderPseudoVideo(state);
    send("media-command", { videoId: state.videoId, action: "set-muted", muted: state.muted });
    if (changed) state.container.dispatchEvent(new Event("volumechange"));
  };

  const requestVideoVolume = (state, volume) => {
    const next = Math.max(0, Math.min(1, Number(volume) || 0));
    const changed = state.volume !== next;
    state.volume = next;
    renderPseudoVideo(state);
    send("media-command", { videoId: state.videoId, action: "set-volume", volume: state.volume });
    if (changed) state.container.dispatchEvent(new Event("volumechange"));
  };

  const attachVideoApi = (container, state) => {
    if (container.dataset.vibeVideoApi === "true") return;
    container.dataset.vibeVideoApi = "true";
    const define = (name, descriptor) => { try { Object.defineProperty(container, name, Object.assign({ configurable: true }, descriptor)); } catch { /* host element may reserve a property */ } };
    define("play", { value: () => requestVideoPlay(state) });
    define("pause", { value: () => send("media-command", { videoId: state.videoId, action: "pause" }) });
    define("stop", { value: () => requestVideoStop(state) });
    define("fastSeek", { value: (seconds) => setVideoCurrentTime(state, Number(seconds) * 1_000) });
    define("currentTime", { get: () => (state.displayCurrentMs ?? state.currentMs) / 1_000, set: (seconds) => setVideoCurrentTime(state, Number(seconds) * 1_000) });
    define("duration", { get: () => state.totalMs / 1_000 });
    define("volume", { get: () => state.volume, set: (value) => requestVideoVolume(state, value) });
    define("muted", { get: () => state.muted, set: (value) => requestVideoMuted(state, value) });
    define("paused", { get: () => state.status !== "playing" });
    define("readyState", { get: () => state.timeline ? 4 : 0 });
    define("activeSceneIndex", { get: () => state.sceneIndex });
  };

  const ensurePseudoVideo = (container) => {
    if (container.hasAttribute("data-vibe-pseudo-video")) container.setAttribute("data-vibe-legacy", "");
    let state = pseudoVideoStates.get(container);
    const position = Math.max(0, videoContainers().indexOf(container));
    const videoId = state?.videoId ?? safeMediaIdentifier(compact(container.id, 160), `video-${position + 1}`);
    container.id = videoId;
    syncVideoAspectRatio(container);
    const scenes = pseudoVideoScenes(container);
    const sceneIds = new Set();
    if (!container.hasAttribute("tabindex")) container.tabIndex = 0;
    if (!container.hasAttribute("role")) container.setAttribute("role", "region");
    if (!container.hasAttribute("aria-label")) container.setAttribute("aria-label", "Video player");
    scenes.forEach((scene, index) => {
      scene.setAttribute("data-vibe-scene", "");
      const candidateId = safeMediaIdentifier(compact(scene.id, 160), `${videoId}-scene-${index + 1}`);
      let sceneId = sceneIds.has(candidateId) ? `${videoId}-scene-${index + 1}` : candidateId;
      for (let suffix = 2; sceneIds.has(sceneId); suffix += 1) sceneId = `${videoId}-scene-${index + 1}-${suffix}`;
      scene.id = sceneId;
      sceneIds.add(scene.id);
      if (!scene.hasAttribute("data-kind")) scene.setAttribute("data-kind", scene.querySelector("img") ? "image" : "text");
      if (!scene.hasAttribute("data-transition")) scene.setAttribute("data-transition", "crossfade");
      if (!scene.hasAttribute("data-motion")) scene.setAttribute("data-motion", "still");
      const legacyMusic = scene.querySelector("[data-vibe-music]");
      const legacyPreset = legacyMusic?.getAttribute("data-preset") || scene.getAttribute("data-music-preset");
      if (!scene.hasAttribute("data-music-track")) scene.setAttribute("data-music-track", LEGACY_VIDEO_MUSIC[legacyPreset] || (index ? "inherit" : "silence"));
      legacyMusic?.remove();
      scene.removeAttribute("data-music-preset");
      scene.removeAttribute("data-music-intensity");
      const narrationCues = Array.from(scene.querySelectorAll("[data-vibe-narration]"));
      if (narrationCues.length) {
        narrationCues[0].textContent = compact(narrationCues.map((cue) => cue.textContent).join(" "), 800);
        narrationCues[0].removeAttribute("data-at-ms");
        narrationCues[0].removeAttribute("data-pause-after-ms");
        for (const cue of narrationCues.slice(1)) cue.remove();
      }
    });
    // The artifact owns every visible pixel of the player UI. The trusted
    // runtime only binds authored controls and narrowly upgrades old static
    // player chrome; it never appends fallback controls, status, captions or
    // transcript blocks.
    normalizeAuthoredVideoControls(container);
    if (!state) {
      const aspectObserver = new MutationObserver(() => syncVideoAspectRatio(container));
      aspectObserver.observe(container, { attributes: true, attributeFilter: ["data-aspect-ratio"] });
      state = { container, videoId, timeline: null, currentMs: 0, displayCurrentMs: 0, totalMs: 0, status: "idle", syncedAt: performance.now(), sceneIndex: -1, volume: 1, muted: false, pendingPlay: false, prepareRequestId: "", progress: null, message: "", raf: 0, animations: [], animationPoster: false, aspectObserver, playPromise: null, resolvePlay: null, rejectPlay: null };
      pseudoVideoStates.set(container, state);
      attachVideoApi(container, state);
      capabilityCleanups.push(() => {
        if (state.raf) {
          if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(state.raf);
          else window.clearTimeout(state.raf);
        }
        state.aspectObserver.disconnect();
        cancelVideoAnimations(state);
        send("media-command", { videoId: state.videoId, action: "stop" });
      });
    }
    renderPseudoVideo(state);
    return state;
  };

  if (window.customElements && !window.customElements.get("vibe-video")) {
    class VibeVideoElement extends HTMLElement {
      play() { return requestVideoPlay(ensurePseudoVideo(this)); }
      pause() { const state = ensurePseudoVideo(this); send("media-command", { videoId: state.videoId, action: "pause" }); }
      stop() { requestVideoStop(ensurePseudoVideo(this)); }
      fastSeek(seconds) { setVideoCurrentTime(ensurePseudoVideo(this), Number(seconds) * 1_000); }
      get currentTime() { const state = ensurePseudoVideo(this); return (state.displayCurrentMs ?? state.currentMs) / 1_000; }
      set currentTime(seconds) { setVideoCurrentTime(ensurePseudoVideo(this), Number(seconds) * 1_000); }
      get duration() { return ensurePseudoVideo(this).totalMs / 1_000; }
      get volume() { return ensurePseudoVideo(this).volume; }
      set volume(value) { requestVideoVolume(ensurePseudoVideo(this), value); }
      get muted() { return ensurePseudoVideo(this).muted; }
      set muted(value) { requestVideoMuted(ensurePseudoVideo(this), value); }
      get paused() { return ensurePseudoVideo(this).status !== "playing"; }
      get readyState() { return ensurePseudoVideo(this).timeline ? 4 : 0; }
      get activeSceneIndex() { return ensurePseudoVideo(this).sceneIndex; }
    }
    window.customElements.define("vibe-video", VibeVideoElement);
  }

  const updateCountdown = (element) => {
    const target = Date.parse(element.getAttribute("data-target") || "");
    if (!Number.isFinite(target)) return false;
    const seconds = Math.max(0, Math.floor((target - Date.now()) / 1_000));
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    const remainder = seconds % 60;
    element.textContent = `${days ? `${days}d ` : ""}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
    element.setAttribute("aria-label", `${days} days, ${hours} hours, ${minutes} minutes, ${remainder} seconds remaining`);
    return seconds > 0;
  };

  const enhanceCapabilities = () => {
    const motionElements = Array.from(document.querySelectorAll("[data-vibe-motion]"));
    if (!reducedMotion()) motionElements.forEach((element, index) => {
      if (element.dataset.vibeEnhancedMotion === "true") return;
      element.dataset.vibeEnhancedMotion = "true";
      if (typeof element.animate !== "function") return;
      const preset = element.getAttribute("data-vibe-motion");
      if (preset === "pulse") {
        element.animate([{ opacity: 0.72 }, { opacity: 1 }, { opacity: 0.72 }], { duration: 1_800, iterations: 2, easing: "ease-in-out" });
      } else if (preset === "ticker") {
        element.animate([{ transform: "translateX(0)" }, { transform: "translateX(-12%)" }, { transform: "translateX(0)" }], { duration: 8_000, iterations: Infinity, easing: "linear" });
      } else {
        element.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 420, delay: preset === "stagger" ? Math.min(index * 70, 700) : 0, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" });
      }
    });

    for (const slideshow of document.querySelectorAll("[data-vibe-slideshow]")) {
      const alreadyEnhanced = slideshow.dataset.vibeEnhancedSlideshow === "true";
      slideshow.dataset.vibeEnhancedSlideshow = "true";
      showSlide(slideshow, Number(slideshow.dataset.vibeSlideIndex || 0));
      if (!alreadyEnhanced && slideshow.hasAttribute("data-autoplay") && !reducedMotion()) setSlideshowPlaying(slideshow, true);
    }

    for (const video of videoContainers()) ensurePseudoVideo(video);

    for (const progress of document.querySelectorAll('[data-vibe-widget="progress"]')) {
      const value = Math.max(0, Number(progress.getAttribute("data-value")) || 0);
      const maximum = Math.max(1, Number(progress.getAttribute("data-max")) || 100);
      progress.setAttribute("role", "progressbar");
      progress.setAttribute("aria-valuemin", "0");
      progress.setAttribute("aria-valuemax", String(maximum));
      progress.setAttribute("aria-valuenow", String(Math.min(maximum, value)));
      progress.style.setProperty("--vibe-progress", `${Math.min(100, value / maximum * 100)}%`);
    }

    for (const countdown of document.querySelectorAll('[data-vibe-widget="countdown"]')) {
      if (countdown.dataset.vibeEnhancedCountdown === "true") continue;
      countdown.dataset.vibeEnhancedCountdown = "true";
      if (!updateCountdown(countdown)) continue;
      const timer = window.setInterval(() => {
        if (!updateCountdown(countdown)) window.clearInterval(timer);
      }, 1_000);
      capabilityCleanups.push(() => window.clearInterval(timer));
    }
  };

  const handleCapabilityClick = (event) => {
    const target = event.target instanceof Element ? event.target.closest("button, [role=button]") : null;
    if (!target) return false;
    const video = target.closest("vibe-video, [data-vibe-pseudo-video]");
    const videoAction = target.getAttribute("data-vibe-video-action")
      || (target.hasAttribute("data-vibe-video-play") ? "toggle" : target.hasAttribute("data-vibe-video-restart") ? "stop" : "");
    if (video && ["play", "pause", "toggle", "stop", "mute", "skip-music"].includes(videoAction)) {
      event.preventDefault();
      event.stopPropagation();
      // Preventing the generated button's default action also suppresses
      // WebKit's normal focus transfer. Restore it so keyboard and assistive
      // input keep operating the authored control that was actually pressed.
      try { target.focus({ preventScroll: true }); } catch { target.focus(); }
      const state = ensurePseudoVideo(video);
      if (videoAction === "play" || (videoAction === "toggle" && state.status !== "playing")) {
        void requestVideoPlay(state, event.isTrusted).catch((error) => {
          state.message = error instanceof Error ? error.message : "Playback could not start.";
          state.status = "error";
          renderPseudoVideo(state);
        });
      } else if (videoAction === "pause" || videoAction === "toggle") {
        send("media-command", { videoId: state.videoId, action: "pause" });
      } else if (videoAction === "stop") {
        requestVideoStop(state);
      } else if (videoAction === "mute") {
        requestVideoMuted(state, !state.muted);
      } else if (videoAction === "skip-music") {
        send("media-command", { videoId: state.videoId, action: "skip-music" });
      }
      return true;
    }
    const slideshow = target.closest("[data-vibe-slideshow]");
    if (slideshow && (target.hasAttribute("data-vibe-prev") || target.hasAttribute("data-vibe-next") || target.hasAttribute("data-vibe-play"))) {
      event.preventDefault();
      event.stopPropagation();
      if (target.hasAttribute("data-vibe-play")) {
        setSlideshowPlaying(slideshow, slideshow.dataset.vibePlaying !== "true");
      } else {
        const current = Number(slideshow.dataset.vibeSlideIndex || 0);
        showSlide(slideshow, current + (target.hasAttribute("data-vibe-next") ? 1 : -1));
      }
      return true;
    }
    const carousel = target.closest("[data-vibe-carousel]");
    if (carousel && (target.hasAttribute("data-vibe-prev") || target.hasAttribute("data-vibe-next"))) {
      event.preventDefault();
      event.stopPropagation();
      carousel.scrollBy({ left: carousel.clientWidth * (target.hasAttribute("data-vibe-next") ? 0.85 : -0.85), behavior: reducedMotion() ? "auto" : "smooth" });
      return true;
    }
    if (target.hasAttribute("data-vibe-speak")) {
      event.preventDefault();
      event.stopPropagation();
      const selector = target.getAttribute("data-vibe-speak") || "";
      if (!/^#[A-Za-z][\w:.-]{0,127}$/.test(selector) || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return true;
      const source = document.querySelector(selector);
      const text = compact(source && source.textContent, 4_000);
      if (!text) return true;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = document.documentElement.lang || "en";
      window.speechSynthesis.speak(utterance);
      return true;
    }
    if (target.hasAttribute("data-vibe-sound")) {
      event.preventDefault();
      event.stopPropagation();
      playTone(target.getAttribute("data-vibe-sound") || "chime");
      return true;
    }
    const poll = target.closest('[data-vibe-widget="poll"], [data-vibe-widget="rating"]');
    if (poll && (target.hasAttribute("data-vibe-vote") || target.hasAttribute("data-vibe-rating"))) {
      event.preventDefault();
      event.stopPropagation();
      for (const option of poll.querySelectorAll("[data-vibe-vote], [data-vibe-rating]")) option.setAttribute("aria-pressed", option === target ? "true" : "false");
      poll.dataset.vibeSelection = target.getAttribute("data-vibe-vote") || target.getAttribute("data-vibe-rating") || compact(target.textContent, 80);
      return true;
    }
    return false;
  };

  const navigateAnchor = (event, anchor) => {
    const rawHref = anchor.getAttribute("href");
    if (!rawHref) return;
    event.preventDefault();
    event.stopPropagation();
    const resolved = safeUrl(rawHref, pageUrl);
    if (!resolved) return;

    const disposition = dispositionFor(event, anchor);
    const hashNavigation = sameDocumentHash(rawHref);
    if (hashNavigation && disposition === "current") {
      scrollToHash(hashNavigation.hash);
      send("hash-change", hashNavigation);
      return;
    }

    send("navigate", {
      href: resolved.href,
      disposition,
      linkText: compact(anchor.textContent, 512),
      ariaLabel: compact(anchor.getAttribute("aria-label"), 512),
      linkContext: linkContextFor(anchor),
      context: contextFor(anchor),
    });
  };

  let hoveredHref = "";
  const reportLinkHover = (target) => {
    const anchor = target instanceof Element ? target.closest("a[href], area[href]") : null;
    const resolved = anchor instanceof HTMLAnchorElement || anchor instanceof HTMLAreaElement
      ? safeUrl(anchor.getAttribute("href"), pageUrl)
      : null;
    const href = resolved ? resolved.href : "";
    if (href === hoveredHref) return;
    hoveredHref = href;
    send("link-hover", href ? { href } : {});
  };

  document.addEventListener("pointerover", (event) => reportLinkHover(event.target), true);
  document.addEventListener("pointerout", (event) => reportLinkHover(event.relatedTarget), true);
  document.addEventListener("focusin", (event) => reportLinkHover(event.target), true);
  document.addEventListener("focusout", (event) => reportLinkHover(event.relatedTarget), true);

  const submitForm = (event, form, submitter = null) => {
    if (form.hasAttribute("data-vibe-local")) {
      event.preventDefault();
      return;
    }
    if (event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    if (form.method.toUpperCase() !== "GET") {
      send("runtime-error", { message: "Generated pages may only submit safe GET forms." });
      return;
    }
    const action = safeUrl(form.getAttribute("action") || pageUrl, pageUrl);
    if (!action) {
      send("runtime-error", { message: "The form action is not a safe web URL." });
      return;
    }
    const fields = Object.create(null);
    let formData;
    try {
      formData = submitter ? new FormData(form, submitter) : new FormData(form);
    } catch {
      formData = new FormData(form);
    }
    for (const [name, value] of formData.entries()) {
      if (typeof value !== "string" || !name || name.length > 512 || value.length > 1_024) continue;
      const values = fields[name] || (fields[name] = []);
      if (values.length < 32) values.push(value);
    }
    send("form-submit", { action: action.href, method: "GET", fields });
  };

  document.addEventListener("click", (event) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const tab = event.target.closest('[role="tab"]');
    if (tab && tab.closest("[data-vibe-tabs]")) {
      event.preventDefault();
      event.stopPropagation();
      activateTab(tab);
      return;
    }
    const dynamicSource = event.target.closest("[data-vibe-action]");
    const dynamicSubmitter = event.target.closest('button, input[type="submit"], input[type="image"]');
    if (dynamicSource && (!(dynamicSource instanceof HTMLFormElement) || dynamicSubmitter)) {
      event.preventDefault();
      event.stopPropagation();
      if (event.isTrusted) sendDynamicAction(dynamicSource, dynamicSubmitter || dynamicSource, null);
      return;
    }
    const seekSurface = event.target.closest('[data-vibe-video-seek]:not(input)');
    const seekVideo = seekSurface?.closest("vibe-video, [data-vibe-pseudo-video]");
    if (seekSurface && seekVideo) {
      event.preventDefault();
      event.stopPropagation();
      const state = ensurePseudoVideo(seekVideo);
      if (!state.timeline) return;
      const bounds = seekSurface.getBoundingClientRect();
      if (bounds.width <= 0) return;
      const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
      setVideoCurrentTime(state, fraction * state.totalMs);
      return;
    }
    if (handleCapabilityClick(event)) return;
    const anchor = event.target.closest("a[href], area[href]");
    if (anchor instanceof HTMLAnchorElement || anchor instanceof HTMLAreaElement) {
      navigateAnchor(event, anchor);
      return;
    }
  }, true);

  document.addEventListener("input", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-vibe-video-seek], [data-vibe-video-volume]") : null;
    const video = target?.closest("vibe-video, [data-vibe-pseudo-video]");
    if (!target || !video) return;
    const requestedValue = Number(target.value) || 0;
    const state = ensurePseudoVideo(video);
    if (target.hasAttribute("data-vibe-video-volume")) {
      requestVideoVolume(state, requestedValue);
    } else {
      setVideoCurrentTime(state, requestedValue);
    }
  }, true);

  document.addEventListener("auxclick", (event) => {
    if (event.button !== 1 || !(event.target instanceof Element)) return;
    const anchor = event.target.closest("a[href], area[href]");
    if (anchor instanceof HTMLAnchorElement || anchor instanceof HTMLAreaElement) navigateAnchor(event, anchor);
  }, true);

  document.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const payload = { x: event.clientX, y: event.clientY };
    if (event.target instanceof Element) {
      const anchor = event.target.closest("a[href], area[href]");
      if (anchor instanceof HTMLAnchorElement || anchor instanceof HTMLAreaElement) {
        const href = safeUrl(anchor.getAttribute("href"), pageUrl);
        if (href) {
          Object.assign(payload, {
            href: href.href,
            linkText: compact(anchor.textContent, 512),
            ariaLabel: compact(anchor.getAttribute("aria-label"), 512),
            linkContext: linkContextFor(anchor),
            context: contextFor(anchor),
          });
        }
      }
    }
    send("context-menu", payload);
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.target instanceof Element && event.target.matches('[role="tab"]')
        && event.target.closest("[data-vibe-tabs]")
        && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const tabs = Array.from(event.target.closest("[data-vibe-tabs]").querySelectorAll('[role="tab"]'));
      const current = tabs.indexOf(event.target);
      const next = event.key === "Home" ? tabs[0]
        : event.key === "End" ? tabs[tabs.length - 1]
          : tabs[(current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
      if (next) activateTab(next);
      return;
    }
    const video = event.target instanceof Element ? event.target.closest("vibe-video, [data-vibe-pseudo-video]") : null;
    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || event.target?.isContentEditable;
    if (video && !typing && !event.metaKey && !event.ctrlKey && !event.altKey
        && [" ", "k", "K", "ArrowLeft", "ArrowRight", "m", "M"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const state = ensurePseudoVideo(video);
      if (event.key === " " || event.key.toLowerCase() === "k") {
        if (state.status === "playing") send("media-command", { videoId: state.videoId, action: "pause" });
        else void requestVideoPlay(state, event.isTrusted).catch(() => undefined);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        setVideoCurrentTime(state, (state.displayCurrentMs ?? state.currentMs) + (event.key === "ArrowRight" ? 5_000 : -5_000));
      } else if (event.key.toLowerCase() === "m") {
        requestVideoMuted(state, !state.muted);
      }
      return;
    }
    const dynamicForm = event.target instanceof Element ? event.target.closest("form[data-vibe-action]") : null;
    if (dynamicForm && event.key === "Enter" && !(event.target instanceof HTMLTextAreaElement)) {
      event.preventDefault();
      event.stopPropagation();
      if (event.isTrusted) {
        const submitter = dynamicForm.querySelector('button:not([type]), button[type="submit"], input[type="submit"], input[type="image"]');
        sendDynamicAction(dynamicForm, submitter, null);
      }
      return;
    }
    if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key === ",") {
      event.preventDefault();
      event.stopPropagation();
      send("browser-command", { command: "open-settings" });
      return;
    }
  }, true);

  document.addEventListener("submit", (event) => {
    if (!(event.target instanceof HTMLFormElement)) return;
    if (event.target.hasAttribute("data-vibe-action")) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    submitForm(event, event.target, event.submitter);
  }, true);

  const reportError = (message) => send("runtime-error", {
    message: compact(message, 1_024) || "Artifact runtime error",
  });
  window.addEventListener("error", (event) => reportError(event.message));
  window.addEventListener("unhandledrejection", () => reportError("Unhandled artifact promise rejection"));

  const titleObserver = new MutationObserver(() => {
    send("title-change", { title: compact(document.title, 512) });
  });
  const titleElement = document.querySelector("title");
  if (titleElement) titleObserver.observe(titleElement, { childList: true, characterData: true, subtree: true });

  const applyDocumentAttributes = (target, source, names) => {
    for (const name of names) target.removeAttribute(name);
    for (const name of names) {
      const value = source.getAttribute(name);
      if (value) target.setAttribute(name, name === "style" ? sanitizeCss(value) : value.slice(0, 4_096));
    }
  };

  const executeGeneratedScripts = (sources) => {
    for (const source of sources) {
      const script = document.createElement("script");
      script.setAttribute("nonce", GENERATED_SCRIPT_NONCE);
      script.textContent = source;
      document.body.append(script);
      script.remove();
    }
  };

  const syncAttributes = (target, source) => {
    const preserve = new Set(["value", "checked", "selected"]);
    const runtimeOwned = (name) => name.startsWith("data-vibe-enhanced-")
      || name === "data-vibe-slide-index" || name === "data-vibe-playing" || name === "data-vibe-timer";
    for (const attribute of Array.from(target.attributes)) {
      if (!source.hasAttribute(attribute.name) && !preserve.has(attribute.name) && !runtimeOwned(attribute.name)) target.removeAttribute(attribute.name);
    }
    for (const attribute of Array.from(source.attributes)) {
      if (runtimeOwned(attribute.name) || (preserve.has(attribute.name) && (target === document.activeElement || target.matches(":checked")))) continue;
      if (target.getAttribute(attribute.name) !== attribute.value) target.setAttribute(attribute.name, attribute.value);
    }
  };

  const stableNodeKey = (node) => {
    if (!(node instanceof Element)) return "";
    const key = node.id || node.getAttribute("data-vibe-key") || node.getAttribute("data-vibe-region");
    return key ? `${node.localName}:${key}` : "";
  };

  const compatibleNode = (left, right) => {
    if (left.nodeType !== right.nodeType) return false;
    if (left.nodeType === Node.ELEMENT_NODE) {
      const leftKey = stableNodeKey(left);
      const rightKey = stableNodeKey(right);
      if (leftKey || rightKey) return leftKey === rightKey;
      return left.localName === right.localName;
    }
    return left.nodeType === Node.TEXT_NODE || left.nodeType === Node.COMMENT_NODE;
  };

  const morphNode = (target, source) => {
    if (target.nodeType === Node.TEXT_NODE || target.nodeType === Node.COMMENT_NODE) {
      if (target.nodeValue !== source.nodeValue) target.nodeValue = source.nodeValue;
      return;
    }
    if (!(target instanceof Element) || !(source instanceof Element) || target.localName !== source.localName) return;
    syncAttributes(target, source);
    morphChildren(target, source);
  };

  const morphChildren = (target, source) => {
    const desired = Array.from(source.childNodes);
    for (let index = 0; index < desired.length; index += 1) {
      const incoming = desired[index];
      let current = target.childNodes[index];
      if (!current || !compatibleNode(current, incoming)) {
        const incomingKey = stableNodeKey(incoming);
        let match = null;
        if (incomingKey) {
          for (let cursor = index + 1; cursor < target.childNodes.length; cursor += 1) {
            if (stableNodeKey(target.childNodes[cursor]) === incomingKey) {
              match = target.childNodes[cursor];
              break;
            }
          }
        }
        if (match) {
          target.insertBefore(match, current || null);
          current = match;
        } else {
          target.insertBefore(document.importNode(incoming, true), current || null);
          current = target.childNodes[index];
        }
      }
      morphNode(current, incoming);
    }
    while (target.childNodes.length > desired.length) target.lastChild.remove();
  };

  const syncArtifactStyles = (incomingStyles) => {
    const existing = Array.from(document.head.querySelectorAll("style[data-vibesurfer-artifact-style]"));
    incomingStyles.forEach((css, index) => {
      const sanitized = sanitizeCss(css);
      const style = existing[index] || document.createElement("style");
      if (!existing[index]) {
        style.setAttribute("data-vibesurfer-artifact-style", "");
        document.head.append(style);
      }
      if (style.textContent !== sanitized) style.textContent = sanitized;
    });
    for (let index = incomingStyles.length; index < existing.length; index += 1) existing[index].remove();
  };

  const renderArtifact = async (message) => {
    if (!message || typeof message !== "object"
        || message.protocol !== PROTOCOL || message.version !== VERSION || message.type !== "render"
        || message.artifactId !== artifactId || message.nonce !== nonce
        || typeof message.pageUrl !== "string" || message.pageUrl.length > MAX_PAGE_URL_LENGTH
        || typeof message.title !== "string" || !message.title || message.title.length > 512
        || typeof message.html !== "string" || message.html.length > MAX_RENDER_HTML_LENGTH
        || !Number.isInteger(message.revision) || message.revision < 0
        || (message.renderMode !== "preview" && message.renderMode !== "final")
        || (message.voiceSettings !== undefined && (!message.voiceSettings || typeof message.voiceSettings !== "object"
          || !["off", "built-in", "generate-if-requested"].includes(message.voiceSettings.musicMode)))
        || (message.mediaPermissions !== undefined && (!message.mediaPermissions || typeof message.mediaPermissions !== "object"
          || typeof message.mediaPermissions.narrationEnabled !== "boolean"
          || typeof message.mediaPermissions.externalMediaEnabled !== "boolean"))
        || (message.executeScripts !== undefined && typeof message.executeScripts !== "boolean")
        || estimateBytes(message) > MAX_RENDER_MESSAGE_BYTES) {
      reportError("The artifact render payload was rejected.");
      return;
    }
    if (message.revision <= renderedRevision) return;
    const nextPageUrl = safeUrl(message.pageUrl, message.pageUrl);
    if (!nextPageUrl) {
      reportError("The artifact page URL was rejected.");
      return;
    }

    let incoming;
    let generatedScripts;
    const nextDynamicManifest = message.dynamicManifest === undefined ? null : normalizeDynamicManifest(message.dynamicManifest);
    if (message.dynamicManifest !== undefined && !nextDynamicManifest) {
      reportError("The artifact dynamic manifest was rejected.");
      return;
    }
    try {
      incoming = new DOMParser().parseFromString(message.html, "text/html");
      generatedScripts = sanitizeIncomingDocument(incoming, nextPageUrl.href, message.executeScripts === true);
    } catch {
      reportError("The artifact document could not be parsed.");
      return;
    }

    const scrollingElement = document.scrollingElement || document.documentElement;
    const previousScrollLeft = rendered ? scrollingElement.scrollLeft : 0;
    const previousScrollTop = rendered ? scrollingElement.scrollTop : 0;
    const headStyles = Array.from(incoming.head.querySelectorAll("style"), (style) => style.textContent || "");
    syncArtifactStyles(headStyles);

    applyDocumentAttributes(document.documentElement, incoming.documentElement, ["class", "style", "dir", "lang", "data-vibesurfer-browser-theme"]);
    document.documentElement.setAttribute("data-vibesurfer-artifact", "");
    applyDocumentAttributes(document.body, incoming.body, ["class", "style", "dir"]);
    if (rendered) {
      try {
        morphChildren(document.body, incoming.body);
      } catch {
        clearCapabilityRuntime();
        const fragment = document.createDocumentFragment();
        for (const child of Array.from(incoming.body.childNodes)) fragment.append(document.importNode(child, true));
        document.body.replaceChildren(fragment);
      }
    } else {
      clearCapabilityRuntime();
      const fragment = document.createDocumentFragment();
      for (const child of Array.from(incoming.body.childNodes)) fragment.append(document.importNode(child, true));
      document.body.replaceChildren(fragment);
    }
    hoveredHref = "";
    pageUrl = nextPageUrl.href;
    if (message.renderMode === "final") {
      if (message.voiceSettings) voiceSettings = { ...message.voiceSettings };
      if (message.mediaPermissions) mediaPermissions = { ...message.mediaPermissions };
      dynamicManifest = nextDynamicManifest;
      sessionRevision = 0;
      regionRevisions.clear();
      for (const region of dynamicManifest?.regions || []) regionRevisions.set(region.id, 0);
    }
    document.title = compact(message.title, 512) || "Untitled page";
    if (message.renderMode === "final" && message.executeScripts === true && !finalScriptsExecuted) {
      executeGeneratedScripts(generatedScripts);
      finalScriptsExecuted = true;
    }
    enhanceCapabilities();
    enhanceTabs();
    scrollingElement.scrollLeft = previousScrollLeft;
    scrollingElement.scrollTop = previousScrollTop;
    const wasRendered = rendered;
    rendered = true;
    renderedRevision = message.revision;
    if (!wasRendered) send("ready", { title: document.title });
    else send("link-hover");
  };

  const handleHostCommand = (message) => {
    if (!message || typeof message !== "object" || message.protocol !== PROTOCOL || message.version !== VERSION
        || message.artifactId !== artifactId || message.nonce !== nonce) return;
    if (message.type === "render") {
      void renderArtifact(message);
      return;
    }
    if (rendered && message.type === "media-timeline" && typeof message.requestId === "string"
        && message.timeline && typeof message.timeline === "object" && Array.isArray(message.timeline.scenes)) {
      const state = videoContainers().map((container) => pseudoVideoStates.get(container))
        .find((candidate) => candidate?.prepareRequestId === message.requestId && candidate.videoId === message.timeline.videoId);
      if (!state || !Number.isFinite(message.timeline.durationMs) || message.timeline.durationMs < 1_000 || message.timeline.durationMs > 3_600_000
          || message.timeline.scenes.length !== pseudoVideoScenes(state.container).length) return;
      state.timeline = message.timeline;
      state.totalMs = message.timeline.durationMs;
      state.status = "ready";
      state.progress = null;
      state.currentMs = 0;
      state.displayCurrentMs = 0;
      state.syncedAt = performance.now();
      state.container.dispatchEvent(new Event("durationchange"));
      state.container.dispatchEvent(new Event("ready"));
      renderPseudoVideo(state);
      if (state.pendingPlay) {
        state.pendingPlay = false;
        send("media-command", { videoId: state.videoId, action: "play" });
      }
      return;
    }
    if (rendered && message.type === "media-state" && message.state && typeof message.state === "object") {
      const next = message.state;
      const state = videoContainers().map((container) => pseudoVideoStates.get(container)).find((candidate) => candidate?.videoId === next.videoId);
      if (!state || !["idle", "preparing", "ready", "playing", "paused", "waiting", "ended", "error"].includes(next.status)
          || !Number.isFinite(next.currentTimeMs) || !Number.isFinite(next.durationMs)
          || typeof next.muted !== "boolean" || !Number.isFinite(next.volume)) return;
      const previousStatus = state.status;
      const previousMuted = state.muted;
      const previousVolume = state.volume;
      state.status = next.status;
      state.currentMs = Math.max(0, Math.min(next.durationMs || next.currentTimeMs, next.currentTimeMs));
      state.displayCurrentMs = state.currentMs;
      state.totalMs = Math.max(0, next.durationMs);
      state.syncedAt = performance.now();
      state.muted = next.muted;
      state.volume = Math.max(0, Math.min(1, next.volume));
      state.progress = next.progress || null;
      state.message = compact(next.message, 1_024);
      renderPseudoVideo(state);
      state.container.dispatchEvent(new Event("timeupdate"));
      if (previousMuted !== state.muted || previousVolume !== state.volume) state.container.dispatchEvent(new Event("volumechange"));
      if (previousStatus !== next.status) {
        if (next.status === "playing") state.container.dispatchEvent(new Event("play"));
        else if (next.status === "paused") state.container.dispatchEvent(new Event("pause"));
        else if (["waiting", "ended", "error"].includes(next.status)) state.container.dispatchEvent(new Event(next.status));
        if (next.status === "playing") {
          state.resolvePlay?.();
          state.resolvePlay = null;
          state.rejectPlay = null;
          state.playPromise = null;
          ensureVideoAnimationLoop(state);
        } else if (next.status === "error") {
          const error = new Error(state.message || "Video playback failed.");
          state.rejectPlay?.(error);
          state.resolvePlay = null;
          state.rejectPlay = null;
          state.playPromise = null;
        }
      }
      return;
    }
    if (!rendered || !dynamicManifest || estimateBytes(message) > MAX_DYNAMIC_PATCH_BYTES) return;
    if (message.type === "dynamic-pending" && typeof message.requestId === "string" && Array.isArray(message.regionIds)) {
      setRequestPending(message.requestId, message.regionIds.filter((id) => dynamicManifest.regions.some((region) => region.id === id)));
    } else if (message.type === "dynamic-patch" && typeof message.requestId === "string") {
      applyRegionPatches(message);
    } else if (message.type === "dynamic-error" && typeof message.requestId === "string") {
      applyDynamicError(message);
    } else if (message.type === "state-sync") {
      applyStateSync(message);
    } else if (message.type === "dynamic-snapshot-request" && typeof message.requestId === "string" && Array.isArray(message.regionIds)) {
      const allowed = message.regionIds.filter((id) => dynamicManifest.regions.some((region) => region.id === id)).slice(0, 16);
      send("dynamic-snapshot", { requestId: message.requestId, regions: snapshotsFor(allowed) });
    }
  };

  const acceptPort = (event) => {
    const message = event.data;
    if (event.source !== window.parent || !message || typeof message !== "object") return;
    if (message.protocol !== PROTOCOL || message.version !== VERSION || message.type !== "init"
        || message.instanceId !== instanceId) return;
    if (message.artifactId !== artifactId || message.nonce !== nonce || event.ports.length !== 1) return;
    window.removeEventListener("message", acceptPort);
    if (bootstrapTimer !== undefined) window.clearInterval(bootstrapTimer);
    port = event.ports[0];
    port.onmessage = (messageEvent) => handleHostCommand(messageEvent.data);
    port.start();
    send("ready-for-render");
  };
  window.addEventListener("message", acceptPort);

  const announceBootstrap = () => {
    if (port || bootstrapAttempts >= MAX_BOOTSTRAP_ATTEMPTS) {
      if (bootstrapTimer !== undefined) window.clearInterval(bootstrapTimer);
      return;
    }
    bootstrapAttempts += 1;
    window.parent.postMessage({
      protocol: PROTOCOL,
      version: VERSION,
      type: "bootstrap-ready",
      instanceId,
      artifactId,
      nonce,
    }, "*");
  };
  announceBootstrap();
  bootstrapTimer = window.setInterval(announceBootstrap, BOOTSTRAP_INTERVAL_MS);
})();
