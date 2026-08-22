import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Globe2, PanelTop, Search, Settings, ShieldCheck, ShieldEllipsis, Sparkles } from "lucide-react";
import { Popover } from "radix-ui";
import { BROWSER_EXPERIENCE_REGISTRY } from "../../browser/browser-experience-registry";
import { useBrowserServices } from "../../browser/browser-services";
import { looksLikeUrl } from "../../lib/navigation";
import { openInNewTabShortcutLabel } from "../../lib/platform";
import { useBrowserStore } from "../../store/browser-store";
import type { BrowserTab } from "../../types/browser";
import { Favicon } from "../ui/Favicon";

type SuggestionAction =
  | { type: "navigate"; value: string }
  | { type: "new-tab"; value: string }
  | { type: "switch-tab"; id: string }
  | { type: "settings"; section: string };

interface Suggestion {
  id: string;
  label: string;
  detail: string;
  icon: "generate" | "web" | "tab" | "settings";
  action: SuggestionAction;
}

export function AddressBar({ tab }: { tab: BrowserTab }) {
  const tabs = useBrowserStore((state) => state.tabs);
  const navigate = useBrowserStore((state) => state.navigate);
  const addTab = useBrowserStore((state) => state.addTab);
  const activateTab = useBrowserStore((state) => state.activateTab);
  const openSettings = useBrowserStore((state) => state.openSettings);
  const theme = useBrowserStore((state) => state.preferences.theme);
  const [value, setValue] = useState(committedValue(tab));
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const composing = useRef(false);
  const selectOnPointerUp = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const platform = useBrowserServices().platform;
  const openInNewTabShortcut = openInNewTabShortcutLabel(platform);
  const language = BROWSER_EXPERIENCE_REGISTRY[theme].chrome.address;
  const siteInfo = siteInformation(tab);

  useEffect(() => {
    if (!focused) setValue(committedValue(tab));
  }, [focused, tab]);

  useEffect(() => {
    const focusAddress = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("vibesurfer:focus-address", focusAddress);
    return () => window.removeEventListener("vibesurfer:focus-address", focusAddress);
  }, []);

  const suggestions = useMemo<Suggestion[]>(() => {
    const query = value.trim();
    const result: Suggestion[] = [];

    if (query && !looksLikeUrl(query)) {
      result.push({
        id: "generate",
        label: `Search ${language.network} for “${query}”`,
        detail: language.queryDetail,
        icon: "generate",
        action: { type: "navigate", value: query },
      });
    }

    if (query && looksLikeUrl(query)) {
      result.push({
        id: "open",
        label: `Open ${query}`,
        detail: language.addressDetail,
        icon: "generate",
        action: { type: "navigate", value: query },
      });
    }

    const matchingTabs = tabs
      .filter((item) => item.id !== tab.id && `${item.title} ${item.location}`.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 3);
    matchingTabs.forEach((item) => {
      result.push({
        id: `tab-${item.id}`,
        label: item.title,
        detail: "Switch to tab",
        icon: "tab",
        action: { type: "switch-tab", id: item.id },
      });
    });

    if (!query || "settings profiles appearance themes vibe".includes(query.toLowerCase())) {
      result.push({
        id: "profiles-appearance",
        label: "Profiles & appearance",
        detail: "Chrome skin, density, animations and vibe",
        icon: "settings",
        action: { type: "settings", section: "profiles" },
      });
    }

    if (!query) {
      result.unshift({
        id: "prompt-starter",
        label: language.starterLabel,
        detail: language.starterDetail,
        icon: "generate",
        action: { type: "navigate", value: language.starterAddress },
      });
    }

    return result.slice(0, 6);
  }, [language, tab.id, tabs, value]);

  useEffect(() => setActiveIndex(0), [value]);

  const runAction = (action: SuggestionAction, openInNewTab = false) => {
    if (openInNewTab && "value" in action) {
      addTab(action.value);
    } else if (action.type === "navigate") {
      navigate(tab.id, action.value);
    } else if (action.type === "new-tab") {
      addTab(action.value);
    } else if (action.type === "switch-tab") {
      activateTab(action.id);
    } else {
      openSettings(action.section);
    }
    setFocused(false);
    inputRef.current?.blur();
  };

  return (
    <div className={`address-bar${focused ? " is-focused" : ""}`}>
      <span className="address-bar__classic-label" aria-hidden="true">Address</span>
      <Popover.Root>
        <Popover.Trigger asChild>
          <button className="address-bar__site-info" type="button" aria-label="Site information">
            <Favicon
              source={tab.favicon}
              title={tab.title}
              generated={tab.kind === "generated" || tab.kind === "new-tab"}
              seed={tab.virtualLocation?.origin ?? tab.location}
            />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            className="popover site-info-popover"
            align="start"
            sideOffset={8}
            collisionPadding={12}
            aria-labelledby="site-info-title"
          >
            <div className="site-info-popover__header">
              <span><ShieldEllipsis aria-hidden="true" /></span>
              <span>
                <strong id="site-info-title">{siteInfo.title}</strong>
                <small>{siteInfo.status}</small>
              </span>
            </div>
            <div className="site-info-popover__location" title={siteInfo.location}>{siteInfo.location}</div>
            <p className="site-info-popover__note">
              <ShieldCheck aria-hidden="true" />
              <span>{siteInfo.note}</span>
            </p>
            <Popover.Arrow className="popover__arrow" />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <input
        ref={inputRef}
        value={value}
        aria-label="Hallunet address bar"
        aria-autocomplete="list"
        aria-controls="address-suggestions"
        aria-expanded={focused && suggestions.length > 0}
        aria-activedescendant={focused ? suggestions[activeIndex]?.id : undefined}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder={language.placeholder}
        onFocus={() => {
          setFocused(true);
          inputRef.current?.select();
          requestAnimationFrame(() => inputRef.current?.select());
        }}
        onPointerDown={(event) => {
          selectOnPointerUp.current = document.activeElement !== event.currentTarget;
        }}
        onPointerUp={(event) => {
          if (!selectOnPointerUp.current) return;
          selectOnPointerUp.current = false;
          event.preventDefault();
          event.currentTarget.select();
        }}
        onBlur={() => {
          selectOnPointerUp.current = false;
          window.setTimeout(() => setFocused(false), 120);
        }}
        onChange={(event) => setValue(event.target.value)}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={() => (composing.current = false)}
        onKeyDown={(event) => {
          if (composing.current) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((index) => (index + 1) % Math.max(1, suggestions.length));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((index) => (index - 1 + suggestions.length) % Math.max(1, suggestions.length));
          } else if (event.key === "Enter") {
            event.preventDefault();
            const suggestion = suggestions[activeIndex];
            if (suggestion) runAction(suggestion.action, event.altKey);
            else runAction({ type: "navigate", value }, event.altKey);
          } else if (event.key === "Escape") {
            event.preventDefault();
            setValue(committedValue(tab));
            setFocused(false);
            inputRef.current?.blur();
          }
        }}
      />
      <Search className="address-bar__search" aria-hidden="true" />
      <button
        className="address-bar__go"
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => runAction({ type: "navigate", value })}
      >
        <ArrowRight aria-hidden="true" />
        <span>Go</span>
      </button>
      {focused && suggestions.length > 0 && (
        <div className="address-suggestions" id="address-suggestions" role="listbox">
          <div className="address-suggestions__heading">Suggestions</div>
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.id}
              id={suggestion.id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={`address-suggestion${index === activeIndex ? " is-active" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => runAction(suggestion.action)}
            >
              <span className={`address-suggestion__icon address-suggestion__icon--${suggestion.icon}`}>
                <SuggestionIcon kind={suggestion.icon} />
              </span>
              <span className="address-suggestion__copy">
                <strong>{suggestion.label}</strong>
                <small>{suggestion.detail}</small>
              </span>
              <ArrowRight className="address-suggestion__arrow" aria-hidden="true" />
            </button>
          ))}
          <div className="address-suggestions__hint"><kbd>↑</kbd><kbd>↓</kbd> choose <kbd>↵</kbd> open <kbd>{openInNewTabShortcut}</kbd> new tab</div>
        </div>
      )}
    </div>
  );
}

function committedValue(tab: BrowserTab) {
  if (tab.kind === "new-tab") return "";
  return tab.kind === "generated" && tab.prompt ? tab.prompt : tab.location;
}

function siteInformation(tab: BrowserTab) {
  const location = tab.virtualLocation?.url ?? tab.location;

  if (tab.kind === "generated") {
    return {
      title: "Hallunet address",
      status: "Discovered route · isolated locally",
      location,
      note: "This route continues inside the Hallunet and cannot contact the live web.",
    };
  }

  if (tab.kind === "remote") {
    return {
      title: "Unresolved address",
      status: "Outside network · not connected",
      location,
      note: "This coordinate remains isolated. External sites open only in your system browser.",
    };
  }

  return {
    title: tab.kind === "settings" ? "Local settings" : "Hallunet gateway",
    status: tab.kind === "settings" ? "vibesurfer · local interface" : "Unmapped network",
    location,
    note: "This gateway is local and does not contact the live web.",
  };
}

function SuggestionIcon({ kind }: { kind: Suggestion["icon"] }) {
  if (kind === "generate") return <Sparkles aria-hidden="true" />;
  if (kind === "web") return <Globe2 aria-hidden="true" />;
  if (kind === "settings") return <Settings aria-hidden="true" />;
  return <PanelTop aria-hidden="true" />;
}
