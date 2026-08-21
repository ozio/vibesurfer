;(() => {
  "use strict";

  const PROTOCOL = "vibesurfer:artifact-bridge";
  const VERSION = 3;
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
  let voiceSettings = { engine: "system", voice: "", speed: 1, musicEnabled: true };
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

  const pseudoVideoScenes = (container) => Array.from(container.querySelectorAll("[data-vibe-video-scene]"))
    .slice(0, 12)
    .map((element) => ({
      element,
      duration: Math.max(1_000, Math.min(120_000, Number(element.getAttribute("data-duration-ms")) || 5_000)),
    }));

  const stopPseudoMusic = (state, fadeSeconds = 0.25) => {
    if (!state.music) return;
    const music = state.music;
    state.music = null;
    const now = music.context.currentTime;
    try {
      music.gain.gain.cancelScheduledValues(now);
      music.gain.gain.setValueAtTime(Math.max(0.0001, music.gain.gain.value), now);
      music.gain.gain.exponentialRampToValueAtTime(0.0001, now + fadeSeconds);
      for (const oscillator of music.oscillators) oscillator.stop(now + fadeSeconds + 0.05);
    } catch { /* The audio graph may already be stopped. */ }
  };

  const setPseudoMusic = (state, preset, intensity) => {
    const allowed = {
      "calm-documentary": [196, 246.94, 293.66],
      "warm-memory": [220, 277.18, 329.63],
      melancholy: [174.61, 220, 261.63],
      "investigative-tension": [146.83, 174.61, 233.08],
      danger: [110, 116.54, 164.81],
      resolution: [261.63, 329.63, 392],
    };
    if (!voiceSettings.musicEnabled || !state.playing || preset === "silence" || !allowed[preset]) {
      stopPseudoMusic(state);
      state.musicPreset = "silence";
      return;
    }
    if (state.musicPreset === preset && state.music) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!audioContext || audioContext.state === "closed") audioContext = new AudioContext();
    const context = audioContext;
    void context.resume();
    const gain = context.createGain();
    const now = context.currentTime;
    const level = Math.max(0.012, Math.min(0.09, (Number(intensity) || 0.45) * 0.08));
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(level, now + 0.5);
    gain.connect(context.destination);
    const oscillators = allowed[preset].map((frequency, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = preset === "danger" ? "sawtooth" : index === 0 ? "sine" : "triangle";
      oscillator.frequency.setValueAtTime(frequency, now);
      oscillator.detune.setValueAtTime((index - 1) * 3, now);
      oscillator.connect(gain);
      oscillator.start(now);
      return oscillator;
    });
    stopPseudoMusic(state, 0.6);
    state.music = { context, gain, oscillators, level };
    state.musicPreset = preset;
  };

  const duckPseudoMusic = (state, ducked) => {
    if (!state.music) return;
    const { context, gain, level } = state.music;
    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(ducked ? Math.max(0.004, level * 0.22) : level, now, ducked ? 0.04 : 0.2);
  };

  const pausePseudoVideo = (state, preserveSpeech = false) => {
    if (state.playing) state.currentMs = Math.min(state.totalMs, performance.now() - state.startedAt);
    state.playing = false;
    if (state.timer) window.clearInterval(state.timer);
    state.timer = 0;
    if (!preserveSpeech) {
      if (state.activeSpeechRequest) send("speech-cancel", { requestId: state.activeSpeechRequest });
      state.activeSpeechRequest = "";
      try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch { /* unavailable */ }
    }
    stopPseudoMusic(state);
  };

  const narratePseudoCue = (state, cue) => {
    const text = compact(cue.textContent, 4_000);
    if (!text) return;
    const lang = cue.getAttribute("lang") || document.documentElement.lang || "en";
    const pauseAfter = Math.max(0, Math.min(30_000, Number(cue.getAttribute("data-pause-after-ms")) || 0));
    const finish = () => {
      duckPseudoMusic(state, false);
      if (!pauseAfter || !state.playing) return;
      pausePseudoVideo(state, true);
      state.pauseTimer = window.setTimeout(() => playPseudoVideo(state), pauseAfter);
    };
    const russianFallback = /^ru(?:-|$)/i.test(lang) || /[А-Яа-яЁё]/.test(text);
    if (!russianFallback && (voiceSettings.engine === "local" || voiceSettings.engine === "cloud")) {
      const requestId = `speech-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      state.activeSpeechRequest = requestId;
      state.finishSpeech = finish;
      duckPseudoMusic(state, true);
      send("speech-request", { requestId, engine: voiceSettings.engine, text, lang, voice: voiceSettings.voice || "af_heart", speed: voiceSettings.speed || 1 });
      return;
    }
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
    window.speechSynthesis.cancel();
    duckPseudoMusic(state, true);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = Math.max(0.6, Math.min(1.5, Number(state.container.getAttribute("data-vibe-speech-rate")) || voiceSettings.speed || 1));
    const selectedVoice = window.speechSynthesis.getVoices().find((voice) => voice.name === voiceSettings.voice || voice.lang.toLowerCase().startsWith(lang.toLowerCase().split("-")[0]));
    if (selectedVoice) utterance.voice = selectedVoice;
    utterance.onerror = () => duckPseudoMusic(state, false);
    utterance.onend = finish;
    window.speechSynthesis.speak(utterance);
  };

  const renderPseudoVideo = (state, previousMs = state.currentMs) => {
    const scenes = pseudoVideoScenes(state.container);
    state.totalMs = Math.min(600_000, scenes.reduce((sum, scene) => sum + scene.duration, 0));
    state.currentMs = Math.max(0, Math.min(state.totalMs, state.currentMs));
    let cursor = 0;
    let activeIndex = Math.max(0, scenes.length - 1);
    for (const [index, scene] of scenes.entries()) {
      if (state.currentMs < cursor + scene.duration) { activeIndex = index; break; }
      cursor += scene.duration;
    }
    scenes.forEach((scene, index) => {
      scene.element.toggleAttribute("hidden", index !== activeIndex);
      scene.element.setAttribute("aria-hidden", index === activeIndex ? "false" : "true");
      scene.element.style.setProperty("--vibe-video-progress", String(Math.max(0, Math.min(1, (state.currentMs - cursor) / scene.duration))));
    });
    const active = scenes[activeIndex]?.element;
    const caption = state.container.querySelector("[data-vibe-video-caption]");
    if (caption) caption.textContent = compact(active?.getAttribute("data-caption") || active?.querySelector("figcaption, [data-caption]")?.textContent || "", 1_000);
    const range = state.container.querySelector("[data-vibe-video-seek]");
    if (range) {
      range.max = String(Math.max(1, state.totalMs));
      range.value = String(Math.round(state.currentMs));
      range.setAttribute("aria-valuetext", `${formatMediaTime(state.currentMs)} of ${formatMediaTime(state.totalMs)}`);
    }
    const elapsed = state.container.querySelector("[data-vibe-video-elapsed]");
    const total = state.container.querySelector("[data-vibe-video-total]");
    if (elapsed) elapsed.textContent = formatMediaTime(state.currentMs);
    if (total) total.textContent = formatMediaTime(state.totalMs);
    const play = state.container.querySelector("[data-vibe-video-play]");
    if (play) {
      play.textContent = state.playing ? "Pause" : "Play";
      play.setAttribute("aria-pressed", state.playing ? "true" : "false");
    }

    if (state.playing && activeIndex !== state.sceneIndex) {
      state.sceneIndex = activeIndex;
      const musicCue = active?.querySelector("[data-vibe-music]");
      setPseudoMusic(state, musicCue?.getAttribute("data-preset") || active?.getAttribute("data-music-preset") || "silence", musicCue?.getAttribute("data-intensity") || active?.getAttribute("data-music-intensity"));
    }
    let sceneStart = 0;
    for (const scene of scenes) {
      for (const cue of scene.element.querySelectorAll("[data-vibe-narration]")) {
        const cueAt = sceneStart + Math.max(0, Math.min(scene.duration - 1, Number(cue.getAttribute("data-at-ms")) || 0));
        const key = `${scenes.indexOf(scene)}:${cueAt}:${compact(cue.textContent, 80)}`;
        if (state.playing && previousMs <= cueAt && state.currentMs >= cueAt && !state.firedCues.has(key)) {
          state.firedCues.add(key);
          narratePseudoCue(state, cue);
        }
      }
      sceneStart += scene.duration;
    }
  };

  const playPseudoVideo = (state) => {
    if (!state.totalMs) renderPseudoVideo(state);
    if (state.currentMs >= state.totalMs) {
      state.currentMs = 0;
      state.firedCues.clear();
    }
    state.playing = true;
    state.startedAt = performance.now() - state.currentMs;
    renderPseudoVideo(state, Math.max(0, state.currentMs - 1));
    if (state.timer) window.clearInterval(state.timer);
    state.timer = window.setInterval(() => {
      const previous = state.currentMs;
      state.currentMs = Math.min(state.totalMs, performance.now() - state.startedAt);
      renderPseudoVideo(state, previous);
      if (state.currentMs >= state.totalMs) pausePseudoVideo(state);
    }, 100);
  };

  const ensurePseudoVideo = (container) => {
    let controls = container.querySelector(":scope > [data-vibe-video-controls]");
    if (!controls) {
      controls = document.createElement("div");
      controls.setAttribute("data-vibe-video-controls", "");
      controls.innerHTML = '<button type="button" data-vibe-video-play aria-pressed="false">Play</button><button type="button" data-vibe-video-restart>Restart</button><label>Timeline <input type="range" min="0" value="0" step="100" data-vibe-video-seek></label><span><span data-vibe-video-elapsed>0:00</span> / <span data-vibe-video-total>0:00</span></span><button type="button" data-vibe-video-fullscreen>Fullscreen</button>';
      container.append(controls);
    }
    if (!container.querySelector(":scope > [data-vibe-video-caption]")) {
      const caption = document.createElement("p");
      caption.setAttribute("data-vibe-video-caption", "");
      caption.setAttribute("aria-live", "polite");
      container.append(caption);
    }
    if (!container.querySelector(":scope > details[data-vibe-video-transcript]")) {
      const details = document.createElement("details");
      details.setAttribute("data-vibe-video-transcript", "");
      const lines = Array.from(container.querySelectorAll("[data-vibe-narration]"), (cue) => `<p>${compact(cue.textContent, 4_000).replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</p>`).join("");
      details.innerHTML = `<summary>Transcript</summary>${lines || "<p>No narration.</p>"}`;
      container.append(details);
    }
    let state = pseudoVideoStates.get(container);
    if (!state) {
      state = { container, currentMs: 0, totalMs: 0, playing: false, startedAt: 0, timer: 0, pauseTimer: 0, sceneIndex: -1, firedCues: new Set(), music: null, musicPreset: "silence", activeSpeechRequest: "", finishSpeech: null };
      pseudoVideoStates.set(container, state);
      capabilityCleanups.push(() => {
        pausePseudoVideo(state);
        if (state.pauseTimer) window.clearTimeout(state.pauseTimer);
      });
    }
    renderPseudoVideo(state);
    return state;
  };

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

    for (const video of document.querySelectorAll("[data-vibe-pseudo-video]")) ensurePseudoVideo(video);

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
    const video = target.closest("[data-vibe-pseudo-video]");
    if (video && (target.hasAttribute("data-vibe-video-play") || target.hasAttribute("data-vibe-video-restart") || target.hasAttribute("data-vibe-video-fullscreen"))) {
      event.preventDefault();
      event.stopPropagation();
      const state = ensurePseudoVideo(video);
      if (target.hasAttribute("data-vibe-video-play")) {
        if (state.playing) pausePseudoVideo(state); else playPseudoVideo(state);
        renderPseudoVideo(state);
      } else if (target.hasAttribute("data-vibe-video-restart")) {
        pausePseudoVideo(state);
        state.currentMs = 0;
        state.sceneIndex = -1;
        state.firedCues.clear();
        renderPseudoVideo(state);
      } else if (video.requestFullscreen) {
        void video.requestFullscreen().catch(() => undefined);
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
    if (handleCapabilityClick(event)) return;
    const anchor = event.target.closest("a[href], area[href]");
    if (anchor instanceof HTMLAnchorElement || anchor instanceof HTMLAreaElement) {
      navigateAnchor(event, anchor);
      return;
    }
  }, true);

  document.addEventListener("input", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-vibe-video-seek]") : null;
    const video = target?.closest("[data-vibe-pseudo-video]");
    if (!target || !video) return;
    const state = ensurePseudoVideo(video);
    const wasPlaying = state.playing;
    pausePseudoVideo(state);
    state.currentMs = Math.max(0, Math.min(state.totalMs, Number(target.value) || 0));
    state.sceneIndex = -1;
    state.firedCues.clear();
    renderPseudoVideo(state);
    if (wasPlaying) playPseudoVideo(state);
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
          || !["local", "system", "cloud"].includes(message.voiceSettings.engine)
          || typeof message.voiceSettings.voice !== "string" || message.voiceSettings.voice.length > 120
          || typeof message.voiceSettings.speed !== "number" || message.voiceSettings.speed < 0.6 || message.voiceSettings.speed > 1.5
          || typeof message.voiceSettings.musicEnabled !== "boolean"))
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
    if (rendered && message.type === "speech-state" && typeof message.requestId === "string") {
      for (const container of document.querySelectorAll("[data-vibe-pseudo-video]")) {
        const state = pseudoVideoStates.get(container);
        if (!state || state.activeSpeechRequest !== message.requestId) continue;
        state.activeSpeechRequest = "";
        if (message.status === "completed") state.finishSpeech?.();
        else duckPseudoMusic(state, false);
        state.finishSpeech = null;
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
