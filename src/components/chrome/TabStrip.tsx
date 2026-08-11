import { PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { move } from "@dnd-kit/helpers";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { LoaderCircle, Plus, X } from "lucide-react";
import { motion } from "motion/react";
import { useBrowserStore } from "../../store/browser-store";
import type { BrowserTab, TabLayout } from "../../types/browser";
import { Favicon } from "../ui/Favicon";
import { IconButton } from "../ui/IconButton";

export function TabStrip({ orientation }: { orientation: TabLayout }) {
  const tabs = useBrowserStore((state) => state.tabs);
  const addTab = useBrowserStore((state) => state.addTab);

  return (
    <div className={`tab-strip tab-strip--${orientation}`} aria-label="Open tabs">
      <DragDropProvider
        sensors={(defaults) => [
          ...defaults.filter((sensor) => sensor !== PointerSensor),
          pointerWithThreshold,
        ]}
        onDragEnd={(event) => {
          if (event.canceled) return;
          const currentTabs = useBrowserStore.getState().tabs;
          useBrowserStore.setState({ tabs: move(currentTabs, event) });
        }}
      >
        <div className="tab-strip__items" role="tablist" aria-orientation={orientation}>
          {tabs.map((tab, index) => (
            <SortableTab key={tab.id} tab={tab} index={index} orientation={orientation} />
          ))}
        </div>
      </DragDropProvider>
      <IconButton className="new-tab-button" label="New tab" onClick={() => addTab()}>
        <Plus aria-hidden="true" />
      </IconButton>
    </div>
  );
}

const pointerWithThreshold = PointerSensor.configure({
  activationConstraints: [new PointerActivationConstraints.Distance({ value: 5 })],
});

function SortableTab({ tab, index, orientation }: { tab: BrowserTab; index: number; orientation: TabLayout }) {
  const activeTabId = useBrowserStore((state) => state.activeTabId);
  const activateTab = useBrowserStore((state) => state.activateTab);
  const closeTab = useBrowserStore((state) => state.closeTab);
  const { ref, handleRef, isDragging } = useSortable({ id: tab.id, index });
  const active = activeTabId === tab.id;

  return (
    <motion.div
      layout="position"
      ref={ref}
      className={`browser-tab browser-tab--${orientation}${active ? " is-active" : ""}${isDragging ? " is-dragging" : ""}`}
      role="tab"
      tabIndex={active ? 0 : -1}
      aria-selected={active}
      aria-label={tab.title}
      onClick={() => activateTab(tab.id)}
      onAuxClick={(event) => {
        if (event.button === 1) closeTab(tab.id);
      }}
      data-drag-handle
    >
      <span className="browser-tab__drag-target" ref={handleRef}>
        {tab.loadState === "loading" ? (
          <LoaderCircle className="favicon tab-loading" aria-label="Loading" />
        ) : (
          <Favicon source={tab.favicon} title={tab.title} generated={tab.kind === "generated" || tab.kind === "new-tab"} />
        )}
        <span className="browser-tab__title">{tab.title}</span>
      </span>
      <button
        type="button"
        className="browser-tab__close"
        aria-label={`Close ${tab.title}`}
        data-no-drag
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          closeTab(tab.id);
        }}
      >
        <X aria-hidden="true" />
      </button>
    </motion.div>
  );
}
