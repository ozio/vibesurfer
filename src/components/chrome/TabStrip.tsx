import { Accessibility, PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { move } from "@dnd-kit/helpers";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { ChevronLeft, ChevronRight, CopyX, LoaderCircle, Plus, RefreshCw, X } from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { ContextMenu } from "radix-ui";
import { useBrowserStore } from "../../store/browser-store";
import { openBlankTabAndFocus } from "../../app/browser-actions";
import type { BrowserTab, TabLayout } from "../../types/browser";
import { Favicon } from "../ui/Favicon";
import { IconButton } from "../ui/IconButton";

export interface TabStripProps {
  orientation: TabLayout;
}

export function TabStrip({ orientation }: TabStripProps) {
  const tabs = useBrowserStore((state) => state.tabs);
  const activeTabId = useBrowserStore((state) => state.activeTabId);
  const animations = useBrowserStore((state) => state.preferences.animations);
  const theme = useBrowserStore((state) => state.preferences.theme);
  const itemsRef = useRef<HTMLDivElement>(null);
  const keyboardHelpId = useId();
  const tabOrder = tabs.map((tab) => tab.id).join("\0");
  const [overflow, setOverflow] = useState({ active: false, before: false, after: false });
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  const [dragState, setDragState] = useState<{ sourceId: string | null; targetId: string | null }>({
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
  }, [activeTabId, orientation, overflow.active, tabOrder, updateOverflow]);

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

  const scrollTabs = (direction: -1 | 1) => {
    const items = itemsRef.current;
    if (!items) return;
    items.scrollBy({
      left: direction * Math.max(160, items.clientWidth * .65),
      behavior: animations && theme !== "ie-classic" ? "smooth" : "auto",
    });
  };

  const reorderTab = useCallback((tabId: string, direction: -1 | 1) => {
    const currentTabs = useBrowserStore.getState().tabs;
    const sourceIndex = currentTabs.findIndex((tab) => tab.id === tabId);
    const targetIndex = Math.max(0, Math.min(currentTabs.length - 1, sourceIndex + direction));
    if (sourceIndex < 0 || sourceIndex === targetIndex) return;

    const reordered = [...currentTabs];
    const [movedTab] = reordered.splice(sourceIndex, 1);
    if (!movedTab) return;
    reordered.splice(targetIndex, 0, movedTab);
    useBrowserStore.setState({ tabs: reordered });
    setReorderAnnouncement(`Moved ${movedTab.title} to position ${targetIndex + 1} of ${reordered.length}.`);
  }, []);

  return (
    <div className={`tab-strip tab-strip--${orientation}`} aria-label="Open tabs">
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
      {/* dnd-kit adds aria-pressed to its keyboard activator, which is invalid on role="tab".
          TabStrip owns the APG keyboard model and announcements; dnd-kit handles pointer drag only. */}
      <DragDropProvider
        sensors={() => [pointerWithThreshold]}
        plugins={(defaults) => defaults.filter((plugin) => plugin !== Accessibility)}
        onDragStart={(event) => {
          const sourceId = event.operation.source ? String(event.operation.source.id) : null;
          const targetId = event.operation.target ? String(event.operation.target.id) : null;
          setDragState({
            sourceId,
            targetId: targetId && targetId !== sourceId ? targetId : null,
          });
        }}
        onDragOver={(event) => {
          setDragState((current) => {
            const targetId = event.operation.target ? String(event.operation.target.id) : null;
            return {
              sourceId: current.sourceId,
              targetId: targetId && targetId !== current.sourceId ? targetId : current.targetId,
            };
          });
        }}
        onDragEnd={(event) => {
          setDragState({ sourceId: null, targetId: null });
          if (event.canceled) return;
          const currentTabs = useBrowserStore.getState().tabs;
          useBrowserStore.setState({ tabs: move(currentTabs, event) });
        }}
      >
        <div ref={itemsRef} className="tab-strip__items" role="tablist" aria-orientation={orientation}>
          {tabs.map((tab, index) => (
            <SortableTab
              key={tab.id}
              tab={tab}
              index={index}
              orientation={orientation}
              dropTarget={dragState.targetId === tab.id && dragState.sourceId !== tab.id}
              keyboardHelpId={keyboardHelpId}
              onKeyboardReorder={reorderTab}
            />
          ))}
        </div>
      </DragDropProvider>
      <span id={keyboardHelpId} className="sr-only">
        Press Delete to close this tab. Hold Alt and press an arrow key to reorder it.
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
      <IconButton className="new-tab-button" label="New tab" onClick={() => openBlankTabAndFocus()}>
        <Plus aria-hidden="true" />
        {orientation === "vertical" && <span>New tab</span>}
      </IconButton>
    </div>
  );
}

const pointerWithThreshold = PointerSensor.configure({
  activationConstraints: [new PointerActivationConstraints.Distance({ value: 5 })],
});

function SortableTab({
  tab,
  index,
  orientation,
  dropTarget,
  keyboardHelpId,
  onKeyboardReorder,
}: {
  tab: BrowserTab;
  index: number;
  orientation: TabLayout;
  dropTarget: boolean;
  keyboardHelpId: string;
  onKeyboardReorder: (tabId: string, direction: -1 | 1) => void;
}) {
  const activeTabId = useBrowserStore((state) => state.activeTabId);
  const activateTab = useBrowserStore((state) => state.activateTab);
  const closeTab = useBrowserStore((state) => state.closeTab);
  const reload = useBrowserStore((state) => state.reload);
  const canCloseOtherTabs = useBrowserStore((state) => state.tabs.length > 1);
  const { ref, handleRef, isDragging } = useSortable({ id: tab.id, index });
  const active = activeTabId === tab.id;

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <motion.button
          type="button"
          layout="position"
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
          aria-keyshortcuts={orientation === "horizontal" ? "Delete Alt+ArrowLeft Alt+ArrowRight" : "Delete Alt+ArrowUp Alt+ArrowDown"}
          data-dragging={isDragging}
          data-drop-target={dropTarget}
          data-drag-handle
          onClick={() => activateTab(tab.id)}
          onKeyDown={(event) => {
            if (event.key === "Delete") {
              event.preventDefault();
              closeTab(tab.id);
              return;
            }

            const previousKey = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
            const nextKey = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
            if (event.altKey && (event.key === previousKey || event.key === nextKey)) {
              event.preventDefault();
              onKeyboardReorder(tab.id, event.key === previousKey ? -1 : 1);
              return;
            }

            const currentTabs = useBrowserStore.getState().tabs;
            const currentIndex = currentTabs.findIndex((candidate) => candidate.id === tab.id);
            const targetIndex = event.key === "Home"
              ? 0
              : event.key === "End"
                ? currentTabs.length - 1
                : event.key === previousKey
                  ? (currentIndex - 1 + currentTabs.length) % currentTabs.length
                  : event.key === nextKey
                    ? (currentIndex + 1) % currentTabs.length
                    : -1;
            if (targetIndex < 0 || targetIndex === currentIndex) return;
            event.preventDefault();
            activateTab(currentTabs[targetIndex]!.id);
            const tabElements = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]');
            tabElements?.[targetIndex]?.focus();
          }}
          onAuxClick={(event) => {
            if (event.button === 1) closeTab(tab.id);
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
              closeTab(tab.id);
            }}
          >
            <X aria-hidden="true" />
          </span>
        </motion.button>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="menu" collisionPadding={10}>
          <ContextMenu.Item className="menu__item" onSelect={() => reload(tab.id)}>
            <RefreshCw aria-hidden="true" /><span>Reload</span>
          </ContextMenu.Item>
          <ContextMenu.Item
            className="menu__item"
            onSelect={() => openBlankTabAndFocus({ placement: "after-opener", opener: { tabId: tab.id, artifactId: tab.artifactId } })}
          >
            <Plus aria-hidden="true" /><span>New tab to the right</span>
          </ContextMenu.Item>
          <ContextMenu.Separator className="menu__separator" />
          <ContextMenu.Item className="menu__item" onSelect={() => closeTab(tab.id)}>
            <X aria-hidden="true" /><span>Close</span>
          </ContextMenu.Item>
          <ContextMenu.Item
            className="menu__item"
            disabled={!canCloseOtherTabs}
            onSelect={() => closeOtherTabs(tab.id)}
          >
            <CopyX aria-hidden="true" /><span>Close other tabs</span>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function tabMeta(tab: BrowserTab) {
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

function closeOtherTabs(tabId: string) {
  const { tabs, closeTab } = useBrowserStore.getState();
  for (const tab of tabs) {
    if (tab.id !== tabId) closeTab(tab.id);
  }
}
