import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Globe2, PanelTop, Search, Settings, ShieldEllipsis, Sparkles } from "lucide-react";
import { modelCatalog } from "../../data/catalog";
import { looksLikeUrl } from "../../lib/navigation";
import { useBrowserStore } from "../../store/browser-store";
import type { BrowserTab } from "../../types/browser";

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
  const activeModelId = useBrowserStore((state) => state.activeModelId);
  const providerConnections = useBrowserStore((state) => state.providerConnections);
  const activeProfileId = useBrowserStore((state) => state.activeProfileId);
  const navigate = useBrowserStore((state) => state.navigate);
  const addTab = useBrowserStore((state) => state.addTab);
  const activateTab = useBrowserStore((state) => state.activateTab);
  const openSettings = useBrowserStore((state) => state.openSettings);
  const [value, setValue] = useState(committedValue(tab));
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const composing = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeModel = useMemo(() => {
    const models = modelCatalog(providerConnections, activeProfileId);
    return models.find((model) => model.id === activeModelId) ?? models[0];
  }, [activeModelId, activeProfileId, providerConnections]);

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
        label: `Create “${query}”`,
        detail: `Generate with ${activeModel.name}`,
        icon: "generate",
        action: { type: "navigate", value: query },
      });
    }

    if (query && looksLikeUrl(query)) {
      result.push({
        id: "open",
        label: `Imagine ${query}`,
        detail: "Generate a page without contacting the live site",
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

    if (!query || "settings appearance themes".includes(query.toLowerCase())) {
      result.push({
        id: "appearance",
        label: "Appearance settings",
        detail: "Themes, density and tab layout",
        icon: "settings",
        action: { type: "settings", section: "appearance" },
      });
    }

    if (!query) {
      result.unshift({
        id: "prompt-starter",
        label: "Create a calm research space for a new idea",
        detail: `Try ${activeModel.name}`,
        icon: "generate",
        action: { type: "navigate", value: "A calm research space for a new idea" },
      });
    }

    return result.slice(0, 6);
  }, [activeModel.name, tab.id, tabs, value]);

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
      <button className="address-bar__site-info" type="button" aria-label="Site information">
        {tab.kind === "generated" || tab.kind === "new-tab" ? <Sparkles aria-hidden="true" /> : <ShieldEllipsis aria-hidden="true" />}
      </button>
      <input
        ref={inputRef}
        value={value}
        aria-label="Address and prompt bar"
        aria-autocomplete="list"
        aria-controls="address-suggestions"
        aria-expanded={focused && suggestions.length > 0}
        aria-activedescendant={focused ? suggestions[activeIndex]?.id : undefined}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder="Enter an address or describe what to build"
        onFocus={() => {
          setFocused(true);
          requestAnimationFrame(() => inputRef.current?.select());
        }}
        onBlur={() => {
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
          <div className="address-suggestions__hint"><kbd>↑</kbd><kbd>↓</kbd> choose <kbd>↵</kbd> open <kbd>⌥↵</kbd> new tab</div>
        </div>
      )}
    </div>
  );
}

function committedValue(tab: BrowserTab) {
  return tab.kind === "generated" && tab.prompt ? tab.prompt : tab.location;
}

function SuggestionIcon({ kind }: { kind: Suggestion["icon"] }) {
  if (kind === "generate") return <Sparkles aria-hidden="true" />;
  if (kind === "web") return <Globe2 aria-hidden="true" />;
  if (kind === "settings") return <Settings aria-hidden="true" />;
  return <PanelTop aria-hidden="true" />;
}
