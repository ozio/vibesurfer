import { Accessibility, PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { ChevronLeft, ChevronRight, CopyX, LoaderCircle, Plus, RefreshCw, X } from "lucide-react";
import { motion } from "motion/react";
import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useShallow } from "zustand/react/shallow";
import {
  browserCommandPresentation,
  executeBrowserCommand,
  type BrowserCommandId,
} from "../../browser/browser-command-registry";
import { BROWSER_EXPERIENCE_REGISTRY } from "../../browser/browser-experience-registry";
import { useBrowserServices, type BrowserServices } from "../../browser/browser-services";
import { useBrowserStore } from "../../store/browser-store";
import type { BrowserTab as BrowserTabModel, TabLayout } from "../../types/browser";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../ui/ContextMenu";
import { Favicon } from "../ui/Favicon";
import { IconButton } from "../ui/IconButton";

export type TabStripMotion = "full" | "reduced";

export interface BrowserTabContextAction {
  label: string;
  enabled?: boolean;
  shortcut?: ReactNode;
  onSelect: () => void;
}

export interface BrowserTabContextActions {
  reload?: BrowserTabContextAction;
  newTabRight?: BrowserTabContextAction;
  close?: BrowserTabContextAction;
  closeOtherTabs?: BrowserTabContextAction;
}

export interface TabStripProps {
  tabs: readonly BrowserTabModel[];
  activeTabId: string;
  orientation?: TabLayout;
  motion?: TabStripMotion;
  smoothScrolling?: boolean;
  newTabLabel?: string;
  className?: string;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNewTab: () => void;
  onReorder?: (sourceTabId: string, targetTabId: string) => void;
  getContextActions?: (tab: BrowserTabModel) => BrowserTabContextActions;
}

export function TabStrip({
  tabs,
  activeTabId,
  orientation = "horizontal",
  motion: motionPreference = "full",
  smoothScrolling = true,
  newTabLabel = "New tab",
  className = "",
  onActivate,
  onClose,
  onNewTab,
  onReorder,
  getContextActions,
}: TabStripProps) {
  const itemsRef = useRef<HTMLDivElement>(null);
  const keyboardHelpId = useId();
  const tabOrder = tabs.map((tab) => tab.id).join("\0");
  const resolvedActiveTabId = tabs.some((tab) => tab.id === activeTabId)
    ? activeTabId
    : tabs[0]?.id;
  const [overflow, setOverflow] = useState({ active: false, before: false, after: false });
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  const [dragState, setDragState] = useState<{ sourceId: string | null; targetId: string | null }>({
    sourceId: null,
    targetId: null,
  });
  const dragOperationRef = useRef<{ sourceId: string | null; targetId: string | null }>({
    sourceId: null,
    targetId: null,
  });

  const updateOverflow = useCallback(() => {
    const items = itemsRef.current;
    if (!items || orientation !== "horizontal") {
      setOverflow((current) => current.active ? { active: false, before: false, after: false } : current);
      return;
    }

    const maxScroll = Math.max(0, items.scrollWidth - items.clientWidth);
    const next = {
      active: maxScroll > 1,
      before: items.scrollLeft > 1,
      after: items.scrollLeft < maxScroll - 1,
    };
    setOverflow((current) => (
      current.active === next.active && current.before === next.before && current.after === next.after
        ? current
        : next
    ));
  }, [orientation]);

  useLayoutEffect(() => {
    if (orientation !== "horizontal") return;
    const activeTab = itemsRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    activeTab?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    let settledFrame = 0;
    const layoutFrame = requestAnimationFrame(() => {
      updateOverflow();
      settledFrame = requestAnimationFrame(updateOverflow);
    });
    return () => {
      cancelAnimationFrame(layoutFrame);
      cancelAnimationFrame(settledFrame);
    };
  }, [orientation, resolvedActiveTabId, tabOrder, updateOverflow]);

  useLayoutEffect(() => {
    const items = itemsRef.current;
    if (!items || orientation !== "horizontal") return;
    items.addEventListener("scroll", updateOverflow, { passive: true });
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(items);
    updateOverflow();
    return () => {
      items.removeEventListener("scroll", updateOverflow);
      observer.disconnect();
    };
  }, [orientation, updateOverflow]);

  const focusTab = useCallback((tabId: string) => {
    requestAnimationFrame(() => {
      itemsRef.current?.querySelector<HTMLElement>(`[role="tab"][data-tab-id="${CSS.escape(tabId)}"]`)?.focus();
    });
  }, []);

  const requestClose = useCallback((tabId: string, close = () => onClose(tabId)) => {
    const index = tabs.findIndex((tab) => tab.id === tabId);
    const focusTarget = tabs[index + 1] ?? tabs[index - 1];
    close();
    if (focusTarget) focusTab(focusTarget.id);
  }, [focusTab, onClose, tabs]);

  const navigateFrom = useCallback((tabId: string, event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = tabs.findIndex((tab) => tab.id === tabId);
    if (currentIndex < 0 || tabs.length === 0) return;
    const previousKey = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
    const nextKey = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";

    if (event.key === "Delete") {
      event.preventDefault();
      requestClose(tabId);
      return;
    }

    if (event.altKey && onReorder && (event.key === previousKey || event.key === nextKey)) {
      const targetIndex = Math.max(0, Math.min(tabs.length - 1, currentIndex + (event.key === previousKey ? -1 : 1)));
      if (targetIndex === currentIndex) return;
      event.preventDefault();
      const target = tabs[targetIndex]!;
      onReorder(tabId, target.id);
      setReorderAnnouncement(`Moved ${tabs[currentIndex]!.title} to position ${targetIndex + 1} of ${tabs.length}.`);
      focusTab(tabId);
      return;
    }

    const targetIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : event.key === previousKey
          ? (currentIndex - 1 + tabs.length) % tabs.length
          : event.key === nextKey
            ? (currentIndex + 1) % tabs.length
            : -1;
    if (targetIndex < 0 || targetIndex === currentIndex) return;
    event.preventDefault();
    const target = tabs[targetIndex]!;
    onActivate(target.id);
    focusTab(target.id);
  }, [focusTab, onActivate, onReorder, orientation, requestClose, tabs]);

  const scrollTabs = (direction: -1 | 1) => {
    const items = itemsRef.current;
    if (!items) return;
    items.scrollBy({
      left: direction * Math.max(160, items.clientWidth * .65),
      behavior: motionPreference === "full" && smoothScrolling ? "smooth" : "auto",
    });
  };

  return (
    <div
      className={`tab-strip tab-strip--${orientation} ${className}`.trim()}
      aria-label="Open tabs"
      data-motion={motionPreference}
    >
      {orientation === "horizontal" && overflow.active && (
        <IconButton
          className="tab-scroll-button tab-scroll-button--previous"
          label="Scroll tabs left"
          disabled={!overflow.before}
          onClick={() => scrollTabs(-1)}
        >
          <ChevronLeft aria-hidden="true" />
        </IconButton>
      )}
      {/* dnd-kit handles pointer drag only; the tablist owns APG keyboard navigation. */}
      <DragDropProvider
        sensors={() => [pointerWithThreshold]}
        plugins={(defaults) => defaults.filter((plugin) => plugin !== Accessibility)}
        onDragStart={(event) => {
          const sourceId = event.operation.source ? String(event.operation.source.id) : null;
          const targetId = event.operation.target ? String(event.operation.target.id) : null;
          const next = {
            sourceId,
            targetId: targetId && targetId !== sourceId ? targetId : null,
          };
          dragOperationRef.current = next;
          setDragState(next);
        }}
        onDragOver={(event) => {
          setDragState((current) => {
            const targetId = event.operation.target ? String(event.operation.target.id) : null;
            const next = {
              sourceId: current.sourceId,
              targetId: targetId && targetId !== current.sourceId ? targetId : current.targetId,
            };
            dragOperationRef.current = next;
            return next;
          });
        }}
        onDragEnd={(event) => {
          const sourceId = event.operation.source
            ? String(event.operation.source.id)
            : dragOperationRef.current.sourceId;
          const targetId = dragOperationRef.current.targetId
            ?? (event.operation.target ? String(event.operation.target.id) : null);
          dragOperationRef.current = { sourceId: null, targetId: null };
          setDragState({ sourceId: null, targetId: null });
          if (event.canceled || !sourceId || !targetId || sourceId === targetId || !onReorder) return;
          const source = tabs.find((tab) => tab.id === sourceId);
          const targetIndex = tabs.findIndex((tab) => tab.id === targetId);
          onReorder(sourceId, targetId);
          if (source && targetIndex >= 0) {
            setReorderAnnouncement(`Moved ${source.title} to position ${targetIndex + 1} of ${tabs.length}.`);
            focusTab(sourceId);
          }
        }}
      >
        <div ref={itemsRef} className="tab-strip__items" role="tablist" aria-orientation={orientation}>
          {tabs.map((tab, index) => (
            <BrowserTab
              key={tab.id}
              tab={tab}
              index={index}
              active={resolvedActiveTabId === tab.id}
              orientation={orientation}
              motion={motionPreference}
              reorderable={Boolean(onReorder)}
              dropTarget={dragState.targetId === tab.id && dragState.sourceId !== tab.id}
              keyboardHelpId={keyboardHelpId}
              contextActions={getContextActions?.(tab) ?? defaultContextActions(tab, onClose)}
              onActivate={() => onActivate(tab.id)}
              onRequestClose={(close) => requestClose(tab.id, close)}
              onKeyDown={(event) => navigateFrom(tab.id, event)}
            />
          ))}
        </div>
      </DragDropProvider>
      <span id={keyboardHelpId} className="sr-only">
        Use arrow keys, Home, and End to switch tabs. Press Delete to close this tab.
        {onReorder && " Hold Alt and press an arrow key to reorder it."}
      </span>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {reorderAnnouncement}
      </span>
      {orientation === "horizontal" && overflow.active && (
        <IconButton
          className="tab-scroll-button tab-scroll-button--next"
          label="Scroll tabs right"
          disabled={!overflow.after}
          onClick={() => scrollTabs(1)}
        >
          <ChevronRight aria-hidden="true" />
        </IconButton>
      )}
      <IconButton className="new-tab-button" label={newTabLabel} onClick={onNewTab}>
        <Plus aria-hidden="true" />
        {orientation === "vertical" && <span>{newTabLabel}</span>}
      </IconButton>
    </div>
  );
}

export interface BrowserTabProps {
  tab: BrowserTabModel;
  index: number;
  active: boolean;
  orientation: TabLayout;
  motion?: TabStripMotion;
  reorderable?: boolean;
  dropTarget?: boolean;
  keyboardHelpId?: string;
  contextActions: BrowserTabContextActions;
  onActivate: () => void;
  onRequestClose: (close?: () => void) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

export function BrowserTab({
  tab,
  index,
  active,
  orientation,
  motion: motionPreference = "full",
  reorderable = false,
  dropTarget = false,
  keyboardHelpId,
  contextActions,
  onActivate,
  onRequestClose,
  onKeyDown,
}: BrowserTabProps) {
  const { ref, handleRef, isDragging } = useSortable({
    id: tab.id,
    index,
    disabled: !reorderable,
    transition: motionPreference === "reduced" ? null : undefined,
  });
  const previousKey = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
  const nextKey = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
  const shortcuts = ["Delete", ...(reorderable ? [`Alt+${previousKey}`, `Alt+${nextKey}`] : [])].join(" ");

  return (
    <ContextMenu
      ariaLabel={`Actions for ${tab.title}`}
      content={<BrowserTabContextMenu actions={contextActions} onClose={onRequestClose} />}
    >
      <motion.button
        type="button"
        layout={motionPreference === "full" ? "position" : false}
        ref={(element) => {
          ref(element);
          handleRef(element);
        }}
        className={`browser-tab browser-tab--${orientation}${active ? " is-active" : ""}${isDragging ? " is-dragging" : ""}${dropTarget ? " is-drop-target" : ""}`}
        role="tab"
        tabIndex={active ? 0 : -1}
        aria-selected={active}
        aria-label={tab.title}
        aria-describedby={keyboardHelpId}
        aria-keyshortcuts={shortcuts}
        data-tab-id={tab.id}
        data-motion={motionPreference}
        data-dragging={isDragging}
        data-drop-target={dropTarget}
        data-drag-handle={reorderable || undefined}
        onClick={onActivate}
        onKeyDown={onKeyDown}
        onAuxClick={(event) => {
          if (event.button === 1) onRequestClose();
        }}
      >
        <span className="browser-tab__content">
          {tab.loadState === "loading" ? (
            <LoaderCircle className="favicon tab-loading" aria-label="Loading" />
          ) : (
            <Favicon
              source={tab.favicon}
              title={tab.title}
              generated={tab.kind === "generated" || tab.kind === "new-tab"}
              seed={tab.virtualLocation?.origin ?? tab.location}
            />
          )}
          <span className="browser-tab__copy">
            <span className="browser-tab__title">{tab.title}</span>
            {orientation === "vertical" && <span className="browser-tab__meta">{tabMeta(tab)}</span>}
          </span>
          {tab.hasUnseenUpdate && <span className="browser-tab__unseen" aria-label="Updated in background" />}
        </span>
        <span
          className="browser-tab__close"
          aria-hidden="true"
          title={`Close ${tab.title}`}
          data-no-drag
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onRequestClose();
          }}
        >
          <X aria-hidden="true" />
        </span>
      </motion.button>
    </ContextMenu>
  );
}

function BrowserTabContextMenu({
  actions,
  onClose,
}: {
  actions: BrowserTabContextActions;
  onClose: (close?: () => void) => void;
}) {
  const beforeSeparator = Boolean(actions.reload || actions.newTabRight);
  const afterSeparator = Boolean(actions.close || actions.closeOtherTabs);
  return (
    <>
      {actions.reload && (
        <ContextMenuItem disabled={actions.reload.enabled === false} shortcut={visualShortcut(actions.reload.shortcut)} onSelect={actions.reload.onSelect}>
          <RefreshCw aria-hidden="true" /><span>{actions.reload.label}</span>
        </ContextMenuItem>
      )}
      {actions.newTabRight && (
        <ContextMenuItem disabled={actions.newTabRight.enabled === false} shortcut={visualShortcut(actions.newTabRight.shortcut)} onSelect={actions.newTabRight.onSelect}>
          <Plus aria-hidden="true" /><span>{actions.newTabRight.label}</span>
        </ContextMenuItem>
      )}
      {beforeSeparator && afterSeparator && <ContextMenuSeparator />}
      {actions.close && (
        <ContextMenuItem
          disabled={actions.close.enabled === false}
          shortcut={visualShortcut(actions.close.shortcut)}
          onSelect={() => onClose(actions.close?.onSelect)}
        >
          <X aria-hidden="true" /><span>{actions.close.label}</span>
        </ContextMenuItem>
      )}
      {actions.closeOtherTabs && (
        <ContextMenuItem disabled={actions.closeOtherTabs.enabled === false} shortcut={visualShortcut(actions.closeOtherTabs.shortcut)} onSelect={actions.closeOtherTabs.onSelect}>
          <CopyX aria-hidden="true" /><span>{actions.closeOtherTabs.label}</span>
        </ContextMenuItem>
      )}
    </>
  );
}

export interface ConnectedTabStripProps {
  orientation: TabLayout;
  className?: string;
}

export function ConnectedTabStrip({ orientation, className }: ConnectedTabStripProps) {
  const services = useBrowserServices();
  const {
    tabs,
    activeTabId,
    animations,
    theme,
    activateTab,
    reorderTabs,
  } = useBrowserStore(useShallow((state) => ({
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    animations: state.preferences.animations,
    theme: state.preferences.theme,
    activateTab: state.activateTab,
    reorderTabs: state.reorderTabs,
  })));
  const newTab = browserCommandPresentation("new-tab", useBrowserStore.getState(), services);

  const getContextActions = useCallback((tab: BrowserTabModel): BrowserTabContextActions => ({
    reload: connectedAction("reload", tab.id, services),
    newTabRight: connectedAction("new-tab-right", tab.id, services),
    close: connectedAction("close-tab", tab.id, services),
    closeOtherTabs: connectedAction("close-other-tabs", tab.id, services),
  }), [services]);

  return (
    <TabStrip
      tabs={tabs}
      activeTabId={activeTabId}
      orientation={orientation}
      motion={animations ? "full" : "reduced"}
      smoothScrolling={BROWSER_EXPERIENCE_REGISTRY[theme].chrome.smoothTabScrolling}
      newTabLabel={newTab.label}
      className={className}
      onActivate={activateTab}
      onClose={(tabId) => { executeBrowserCommand("close-tab", services, { tabId }); }}
      onNewTab={() => { executeBrowserCommand("new-tab", services); }}
      onReorder={reorderTabs}
      getContextActions={getContextActions}
    />
  );
}

const pointerWithThreshold = PointerSensor.configure({
  activationConstraints: [new PointerActivationConstraints.Distance({ value: 5 })],
});

function connectedAction(
  commandId: BrowserCommandId,
  tabId: string,
  services: BrowserServices,
): BrowserTabContextAction {
  const presentation = browserCommandPresentation(commandId, useBrowserStore.getState(), services, { tabId });
  return {
    label: presentation.label,
    enabled: presentation.enabled,
    shortcut: presentation.shortcut,
    onSelect: () => { executeBrowserCommand(commandId, services, { tabId }); },
  };
}

function defaultContextActions(tab: BrowserTabModel, onClose: (tabId: string) => void): BrowserTabContextActions {
  return {
    close: {
      label: "Close",
      onSelect: () => onClose(tab.id),
    },
  };
}

function visualShortcut(shortcut: ReactNode) {
  return shortcut ? <span aria-hidden="true">{shortcut}</span> : undefined;
}

function tabMeta(tab: BrowserTabModel) {
  if (tab.kind === "new-tab") return "New page";
  if (tab.kind === "settings") return "Browser settings";
  if (tab.kind === "history") return "Browsing history";

  const location = tab.virtualLocation?.url ?? tab.location;
  try {
    return new URL(location).hostname.replace(/^www\./, "") || "Local page";
  } catch {
    return location.replace(/^vibe:\/\//, "") || "Local page";
  }
}
