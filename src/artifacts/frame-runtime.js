;(() => {
  "use strict";

  const PROTOCOL = "vibesurfer:artifact-bridge";
  const VERSION = 1;
  const MAX_ARTIFACT_ID_LENGTH = 512;
  const MAX_NONCE_LENGTH = 128;
  const MAX_PAGE_URL_LENGTH = 4_096;
  const MAX_RENDER_MESSAGE_BYTES = 4 * 1024 * 1024;
  const MAX_RENDER_HTML_LENGTH = MAX_RENDER_MESSAGE_BYTES;
  const MAX_GENERATED_SCRIPT_COUNT = 16;
  const MAX_GENERATED_SCRIPT_LENGTH = 256 * 1024;
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
    const anchor = event.target.closest("a[href], area[href]");
    if (anchor instanceof HTMLAnchorElement || anchor instanceof HTMLAreaElement) {
      navigateAnchor(event, anchor);
      return;
    }
    const submitter = event.target.closest("button, input");
    if (submitter instanceof HTMLButtonElement && submitter.type === "submit" && submitter.form) {
      submitForm(event, submitter.form, submitter);
    } else if (submitter instanceof HTMLInputElement
        && (submitter.type === "submit" || submitter.type === "image") && submitter.form) {
      submitForm(event, submitter.form, submitter);
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
            context: contextFor(anchor),
          });
        }
      }
    }
    send("context-menu", payload);
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key === ",") {
      event.preventDefault();
      event.stopPropagation();
      send("browser-command", { command: "open-settings" });
      return;
    }
    if (event.key !== "Enter" || event.isComposing || !(event.target instanceof HTMLElement)) return;
    if (event.target instanceof HTMLTextAreaElement || event.target.isContentEditable) return;
    if (!(event.target instanceof HTMLInputElement)
        || ["button", "reset", "checkbox", "radio", "file", "range", "color"].includes(event.target.type)) return;
    const form = event.target.closest("form");
    if (form instanceof HTMLFormElement) submitForm(event, form);
  }, true);

  document.addEventListener("submit", (event) => {
    if (event.target instanceof HTMLFormElement) submitForm(event, event.target, event.submitter);
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

  const renderArtifact = (message) => {
    if (!message || typeof message !== "object"
        || message.protocol !== PROTOCOL || message.version !== VERSION || message.type !== "render"
        || message.artifactId !== artifactId || message.nonce !== nonce
        || typeof message.pageUrl !== "string" || message.pageUrl.length > MAX_PAGE_URL_LENGTH
        || typeof message.title !== "string" || !message.title || message.title.length > 512
        || typeof message.html !== "string" || message.html.length > MAX_RENDER_HTML_LENGTH
        || (message.executeScripts !== undefined && typeof message.executeScripts !== "boolean")
        || estimateBytes(message) > MAX_RENDER_MESSAGE_BYTES) {
      reportError("The artifact render payload was rejected.");
      return;
    }
    const nextPageUrl = safeUrl(message.pageUrl, message.pageUrl);
    if (!nextPageUrl) {
      reportError("The artifact page URL was rejected.");
      return;
    }

    let incoming;
    let generatedScripts;
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
    for (const oldStyle of document.head.querySelectorAll("style[data-vibesurfer-artifact-style]")) oldStyle.remove();
    for (const css of headStyles) {
      const style = document.createElement("style");
      style.setAttribute("data-vibesurfer-artifact-style", "");
      style.textContent = sanitizeCss(css);
      document.head.append(style);
    }

    applyDocumentAttributes(document.documentElement, incoming.documentElement, ["class", "style", "dir", "lang", "data-vibesurfer-browser-theme"]);
    document.documentElement.setAttribute("data-vibesurfer-artifact", "");
    applyDocumentAttributes(document.body, incoming.body, ["class", "style", "dir"]);
    const fragment = document.createDocumentFragment();
    for (const child of Array.from(incoming.body.childNodes)) fragment.append(document.importNode(child, true));
    document.body.replaceChildren(fragment);
    hoveredHref = "";
    pageUrl = nextPageUrl.href;
    document.title = compact(message.title, 512) || "Untitled page";
    if (message.executeScripts === true) executeGeneratedScripts(generatedScripts);
    scrollingElement.scrollLeft = previousScrollLeft;
    scrollingElement.scrollTop = previousScrollTop;
    const wasRendered = rendered;
    rendered = true;
    if (!wasRendered) send("ready", { title: document.title });
    else send("link-hover");
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
    port.onmessage = (messageEvent) => renderArtifact(messageEvent.data);
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
