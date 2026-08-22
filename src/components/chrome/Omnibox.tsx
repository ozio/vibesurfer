import { ArrowRight, Globe2, PanelTop, Search, Settings, Sparkles } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { BROWSER_EXPERIENCE_REGISTRY } from "../../browser/browser-experience-registry";
import { useBrowserServices } from "../../browser/browser-services";
import { openInNewTabShortcutLabel } from "../../lib/platform";
import { useBrowserStore } from "../../store/browser-store";
import type { BrowserTab } from "../../types/browser";
import { Favicon } from "../ui/Favicon";
import { SiteInfoPopover } from "./SiteInfoPopover";
import type { BrowserOmniboxRecipe } from "./navigation-recipes";
import {
  buildOmniboxSuggestions,
  committedOmniboxValue,
  siteInformationForTab,
  type OmniboxSuggestion,
  type OmniboxSuggestionKind,
} from "./omnibox-model";

export type OmniboxDisposition = "current-tab" | "new-tab";

export interface OmniboxSubmitRequest {
  value: string;
  disposition: OmniboxDisposition;
}

export interface OmniboxSuggestionRequest {
  suggestion: OmniboxSuggestion;
  disposition: OmniboxDisposition;
}

export interface OmniboxHandle {
  focus: (options?: { select?: boolean }) => void;
  blur: () => void;
  select: () => void;
}

export interface OmniboxProps {
  recipe: BrowserOmniboxRecipe;
  value: string;
  committedValue: string;
  suggestions: readonly OmniboxSuggestion[];
  open: boolean;
  activeSuggestionId?: string;
  placeholder?: string;
  label?: string;
  suggestionsLabel?: string;
  openInNewTabShortcut?: string;
  siteInfo?: ReactNode;
  disabled?: boolean;
  className?: string;
  onValueChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onActiveSuggestionChange: (suggestionId: string | undefined) => void;
  onSubmit: (request: OmniboxSubmitRequest) => void;
  onSuggestionSelect: (request: OmniboxSuggestionRequest) => void;
  onEscape?: () => void;
}

export const Omnibox = forwardRef<OmniboxHandle, OmniboxProps>(function Omnibox({
  recipe,
  value,
  committedValue,
  suggestions,
  open,
  activeSuggestionId,
  placeholder,
  label = "Address and search",
  suggestionsLabel = "Suggestions",
  openInNewTabShortcut = "Alt+Enter",
  siteInfo,
  disabled = false,
  className = "",
  onValueChange,
  onOpenChange,
  onActiveSuggestionChange,
  onSubmit,
  onSuggestionSelect,
  onEscape,
}, forwardedRef) {
  const rawId = useId();
  const instanceId = `omnibox-${rawId.replaceAll(":", "")}`;
  const listboxId = `${instanceId}-listbox`;
  const suggestionsLabelId = `${instanceId}-suggestions-label`;
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const selectOnPointerUp = useRef(false);
  const expanded = open && suggestions.length > 0;
  const activeIndex = suggestions.findIndex((suggestion) => suggestion.id === activeSuggestionId);
  const activeOptionId = activeIndex >= 0 ? `${instanceId}-option-${activeIndex}` : undefined;

  const selectInput = useCallback(() => {
    inputRef.current?.select();
    requestAnimationFrame(() => inputRef.current?.select());
  }, []);

  useImperativeHandle(forwardedRef, () => ({
    focus: ({ select = true } = {}) => {
      inputRef.current?.focus();
      if (select) selectInput();
    },
    blur: () => inputRef.current?.blur(),
    select: selectInput,
  }), [selectInput]);

  const closeAndBlur = useCallback(() => {
    onOpenChange(false);
    onActiveSuggestionChange(undefined);
    inputRef.current?.blur();
  }, [onActiveSuggestionChange, onOpenChange]);

  const commitValue = (disposition: OmniboxDisposition) => {
    onSubmit({ value, disposition });
    closeAndBlur();
  };

  const commitSuggestion = (suggestion: OmniboxSuggestion, disposition: OmniboxDisposition) => {
    onSuggestionSelect({ suggestion, disposition });
    closeAndBlur();
  };

  const moveActiveSuggestion = (delta: -1 | 1) => {
    if (suggestions.length === 0) return;
    const nextIndex = activeIndex < 0
      ? delta === 1 ? 0 : suggestions.length - 1
      : (activeIndex + delta + suggestions.length) % suggestions.length;
    onOpenChange(true);
    onActiveSuggestionChange(suggestions[nextIndex]?.id);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActiveSuggestion(event.key === "ArrowDown" ? 1 : -1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const disposition = event.altKey ? "new-tab" : "current-tab";
      const suggestion = expanded && activeIndex >= 0 ? suggestions[activeIndex] : undefined;
      if (suggestion) commitSuggestion(suggestion, disposition);
      else commitValue(disposition);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onValueChange(committedValue);
      onEscape?.();
      closeAndBlur();
      return;
    }

    if (event.key === "Tab") onOpenChange(false);
  };

  return (
    <div
      className={`omnibox${open ? " is-open" : ""} ${className}`.trim()}
      data-appearance={recipe.appearance}
      data-open={open || undefined}
    >
      {recipe.addressLabel && (
        <span className="omnibox__address-label" aria-hidden="true">{recipe.addressLabel}</span>
      )}
      {siteInfo}
      <input
        ref={inputRef}
        role="combobox"
        value={value}
        aria-label={label}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={expanded}
        aria-controls={expanded ? listboxId : undefined}
        aria-activedescendant={expanded ? activeOptionId : undefined}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => {
          onOpenChange(true);
          if (!activeSuggestionId) onActiveSuggestionChange(suggestions[0]?.id);
          selectInput();
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
          onOpenChange(false);
        }}
        onChange={(event) => {
          onValueChange(event.target.value);
          onActiveSuggestionChange(undefined);
          onOpenChange(true);
        }}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={handleKeyDown}
      />
      {recipe.showSearchIcon && <Search className="omnibox__search" aria-hidden="true" />}
      {recipe.goLabel && (
        <button
          className="omnibox__go"
          type="button"
          aria-label={`${recipe.goLabel} to address`}
          disabled={disabled}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => commitValue("current-tab")}
        >
          <ArrowRight aria-hidden="true" />
          <span>{recipe.goLabel}</span>
        </button>
      )}
      {expanded && (
        <div className="omnibox-suggestions">
          <div className="omnibox-suggestions__heading" id={suggestionsLabelId}>{suggestionsLabel}</div>
          <div id={listboxId} role="listbox" aria-labelledby={suggestionsLabelId}>
            {suggestions.map((suggestion, index) => {
              const optionId = `${instanceId}-option-${index}`;
              const active = suggestion.id === activeSuggestionId;
              return (
                <div
                  key={suggestion.id}
                  id={optionId}
                  role="option"
                  aria-selected={active}
                  className={`omnibox-suggestion${active ? " is-active" : ""}`}
                  data-suggestion-id={suggestion.id}
                  data-suggestion-kind={suggestion.kind}
                  onPointerDown={(event) => event.preventDefault()}
                  onPointerEnter={() => onActiveSuggestionChange(suggestion.id)}
                  onClick={() => commitSuggestion(suggestion, "current-tab")}
                >
                  <span className={`omnibox-suggestion__icon omnibox-suggestion__icon--${suggestion.kind}`}>
                    <SuggestionIcon kind={suggestion.kind} />
                  </span>
                  <span className="omnibox-suggestion__copy">
                    <strong>{suggestion.label}</strong>
                    <small>{suggestion.detail}</small>
                  </span>
                  <ArrowRight className="omnibox-suggestion__arrow" aria-hidden="true" />
                </div>
              );
            })}
          </div>
          <div className="omnibox-suggestions__hint" aria-hidden="true">
            <kbd>↑</kbd><kbd>↓</kbd> choose <kbd>↵</kbd> open <kbd>{openInNewTabShortcut}</kbd> new tab
          </div>
        </div>
      )}
    </div>
  );
});

export interface ConnectedOmniboxProps {
  tab: BrowserTab;
  recipe: BrowserOmniboxRecipe;
  className?: string;
}

export function ConnectedOmnibox({ tab, recipe, className }: ConnectedOmniboxProps) {
  const services = useBrowserServices();
  const omniboxRef = useRef<OmniboxHandle>(null);
  const {
    tabs,
    theme,
    navigate,
    addTab,
    activateTab,
    openSettings,
  } = useBrowserStore(useShallow((state) => ({
    tabs: state.tabs,
    theme: state.preferences.theme,
    navigate: state.navigate,
    addTab: state.addTab,
    activateTab: state.activateTab,
    openSettings: state.openSettings,
  })));
  const committedValue = committedOmniboxValue(tab);
  const [value, setValue] = useState(committedValue);
  const [open, setOpen] = useState(false);
  const [requestedActiveSuggestionId, setRequestedActiveSuggestionId] = useState<string>();
  const language = BROWSER_EXPERIENCE_REGISTRY[theme].chrome.address;
  const suggestions = useMemo(() => buildOmniboxSuggestions({
    value,
    currentTabId: tab.id,
    tabs,
    language,
  }), [language, tab.id, tabs, value]);
  const activeSuggestionId = suggestions.some((suggestion) => suggestion.id === requestedActiveSuggestionId)
    ? requestedActiveSuggestionId
    : suggestions[0]?.id;

  useEffect(() => {
    setValue(committedValue);
    setOpen(false);
    setRequestedActiveSuggestionId(undefined);
  }, [tab.id]);

  useEffect(() => {
    if (!open) setValue(committedValue);
  }, [committedValue, open]);

  useEffect(() => {
    const focusAddress = () => omniboxRef.current?.focus({ select: true });
    window.addEventListener("vibesurfer:focus-address", focusAddress);
    return () => window.removeEventListener("vibesurfer:focus-address", focusAddress);
  }, []);

  const submit = ({ value: nextValue, disposition }: OmniboxSubmitRequest) => {
    if (disposition === "new-tab") addTab(nextValue);
    else navigate(tab.id, nextValue);
  };

  const selectSuggestion = ({ suggestion, disposition }: OmniboxSuggestionRequest) => {
    const action = suggestion.action;
    if (action.type === "navigate") {
      submit({ value: action.value, disposition });
    } else if (action.type === "switch-tab") {
      activateTab(action.tabId);
    } else {
      openSettings(action.section);
    }
  };

  return (
    <Omnibox
      ref={omniboxRef}
      recipe={recipe}
      value={value}
      committedValue={committedValue}
      suggestions={suggestions}
      open={open}
      activeSuggestionId={activeSuggestionId}
      placeholder={language.placeholder}
      openInNewTabShortcut={openInNewTabShortcutLabel(services.platform)}
      siteInfo={(
        <SiteInfoPopover
          information={siteInformationForTab(tab)}
          trigger={(
            <button className="omnibox__site-info" type="button" aria-label="Site information">
              <Favicon
                source={tab.favicon}
                title={tab.title}
                generated={tab.kind === "generated" || tab.kind === "new-tab"}
                seed={tab.virtualLocation?.origin ?? tab.location}
              />
            </button>
          )}
        />
      )}
      className={className}
      onValueChange={setValue}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setRequestedActiveSuggestionId(undefined);
      }}
      onActiveSuggestionChange={setRequestedActiveSuggestionId}
      onSubmit={submit}
      onSuggestionSelect={selectSuggestion}
    />
  );
}

function SuggestionIcon({ kind }: { kind: OmniboxSuggestionKind }) {
  if (kind === "query") return <Sparkles aria-hidden="true" />;
  if (kind === "address") return <Globe2 aria-hidden="true" />;
  if (kind === "settings") return <Settings aria-hidden="true" />;
  return <PanelTop aria-hidden="true" />;
}
