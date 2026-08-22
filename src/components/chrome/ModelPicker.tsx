import {
  Check,
  ChevronDown,
  Cpu,
  Search,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { Popover } from "radix-ui";
import {
  forwardRef,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type {
  CodexConnection,
  ModelOption as ModelOptionDefinition,
} from "../../types/browser";
import { useControllableState } from "../ui/useControllableState";

export interface ModelPickerProps {
  models: readonly ModelOptionDefinition[];
  activeModelId: string;
  activeModelName: string;
  connectionState?: CodexConnection["state"];
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  query?: string;
  defaultQuery?: string;
  onQueryChange?: (query: string) => void;
  onSelect: (model: ModelOptionDefinition) => void;
  onManageModels: () => void;
  className?: string;
}

export function ModelPicker({
  models,
  activeModelId,
  activeModelName,
  connectionState = "signed-out",
  open,
  defaultOpen = false,
  onOpenChange,
  query,
  defaultQuery = "",
  onQueryChange,
  onSelect,
  onManageModels,
  className = "",
}: ModelPickerProps) {
  const [pickerOpen, setPickerOpen] = useControllableState({
    value: open,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });
  const [searchQuery, setSearchQuery] = useControllableState({
    value: query,
    defaultValue: defaultQuery,
    onChange: onQueryChange,
  });
  const [activeModelIndex, setActiveModelIndex] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const modelRowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const modelListId = useId();
  const visibleModels = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
    return normalizedQuery
      ? models.filter((model) => (
        `${model.name} ${model.provider} ${model.description}`.toLocaleLowerCase().includes(normalizedQuery)
      ))
      : [...models];
  }, [models, searchQuery]);
  const connected = connectionState === "signed-in";
  const busy = connectionState === "checking" || connectionState === "starting" || connectionState === "waiting-browser";

  const setPickerVisibility = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSearchQuery("");
      setActiveModelIndex(null);
    }
    setPickerOpen(nextOpen);
  };

  const focusModelAt = (index: number) => {
    if (visibleModels.length === 0) return;
    const nextIndex = (index + visibleModels.length) % visibleModels.length;
    setActiveModelIndex(nextIndex);
    modelRowRefs.current[nextIndex]?.focus();
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || visibleModels.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusModelAt(activeModelIndex === null ? 0 : activeModelIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusModelAt(activeModelIndex === null ? visibleModels.length - 1 : activeModelIndex - 1);
    }
  };

  const handleModelKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
    model: ModelOptionDefinition,
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusModelAt(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusModelAt(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusModelAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusModelAt(visibleModels.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      onSelect(model);
    }
  };

  return (
    <Popover.Root open={pickerOpen} onOpenChange={setPickerVisibility}>
      <Popover.Trigger asChild>
        <button
          className={`model-pill ${className}`.trim()}
          type="button"
          aria-label={`Model: ${activeModelName}`}
          data-connection-state={connectionState}
        >
          <span className="model-pill__mark"><Sparkles aria-hidden="true" /></span>
          <span className="model-pill__copy">
            <small>Model</small>
            <strong>{activeModelName}</strong>
          </span>
          <span
            className={`model-pill__status${connected ? " is-online" : ""}${busy ? " is-busy" : ""}`}
            aria-hidden="true"
          />
          <ChevronDown className="model-pill__chevron" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="popover model-popover"
          aria-label="Choose a model"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            searchRef.current?.focus();
          }}
        >
          <div className="popover__header">
            <div><strong>Choose a model</strong><small>Applies to the next generation</small></div>
          </div>
          <label className="model-search">
            <Search aria-hidden="true" />
            <input
              ref={searchRef}
              role="combobox"
              aria-label="Search models"
              aria-autocomplete="list"
              aria-controls={modelListId}
              aria-expanded={pickerOpen}
              aria-activedescendant={activeModelIndex === null ? undefined : `${modelListId}-option-${activeModelIndex}`}
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setActiveModelIndex(null);
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search models"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <div className="model-list" id={modelListId} role="listbox" aria-label="Models">
            {visibleModels.map((model, index) => (
              <ModelOption
                key={model.id}
                ref={(node) => {
                  modelRowRefs.current[index] = node;
                }}
                id={`${modelListId}-option-${index}`}
                model={model}
                selected={activeModelId === model.id}
                active={activeModelIndex === index}
                onFocus={() => setActiveModelIndex(index)}
                onKeyDown={(event) => handleModelKeyDown(event, index, model)}
                onSelect={() => onSelect(model)}
              />
            ))}
            {visibleModels.length === 0 && (
              <div className="model-list__empty" role="status">
                <span><strong>No models found</strong><small>Try a provider or model name.</small></span>
              </div>
            )}
          </div>
          <button className="popover__footer-action" type="button" onClick={onManageModels}>
            Manage models and accounts…
          </button>
          <Popover.Arrow className="popover__arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export interface ModelOptionProps {
  id?: string;
  model: ModelOptionDefinition;
  selected: boolean;
  active?: boolean;
  onSelect: () => void;
  onFocus?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

export const ModelOption = forwardRef<HTMLButtonElement, ModelOptionProps>(function ModelOption({
  id,
  model,
  selected,
  active = false,
  onSelect,
  onFocus,
  onKeyDown,
}, ref) {
  return (
    <button
      ref={ref}
      id={id}
      className={`model-row${selected ? " is-selected" : ""}${active ? " is-active" : ""}`}
      type="button"
      role="option"
      aria-selected={selected}
      tabIndex={active ? 0 : -1}
      data-model-id={model.id}
      data-model-availability={model.available ? "available" : "setup-required"}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      onClick={onSelect}
    >
      <span className="model-row__icon">
        {model.group === "local" ? <Cpu aria-hidden="true" /> : <WandSparkles aria-hidden="true" />}
      </span>
      <span className="model-row__copy">
        <span><strong>{model.name}</strong>{model.badge && <em>{model.badge}</em>}</span>
        <small>{model.provider} · {model.description}</small>
      </span>
      {!model.available
        ? <span className="model-row__connect">Set up</span>
        : selected
          ? <Check aria-hidden="true" />
          : model.requiresCodex
            ? <span className="model-row__connect">Configure</span>
            : null}
    </button>
  );
});
