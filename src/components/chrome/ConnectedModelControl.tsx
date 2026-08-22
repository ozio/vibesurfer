import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useBrowserCommand } from "../../browser/browser-command-registry";
import { modelCatalog } from "../../data/catalog";
import { getCodexAuthStatus, getCodexModelCatalog, startCodexLogin } from "../../lib/codex";
import { useBrowserStore } from "../../store/browser-store";
import type { ModelOption as ModelOptionDefinition } from "../../types/browser";
import { CodexConnectionDialog } from "./CodexConnectionDialog";
import { ModelPicker } from "./ModelPicker";

export interface ConnectedModelControlProps {
  className?: string;
}

export function ConnectedModelControl({ className }: ConnectedModelControlProps) {
  const {
    activeModelId,
    setModel,
    codex,
    codexModels,
    codexSelection,
    providerConnections,
    activeProfileId,
    patchCodex,
    setCodexModels,
    patchCodexSelection,
  } = useBrowserStore(useShallow((state) => ({
    activeModelId: state.activeModelId,
    setModel: state.setModel,
    codex: state.codex,
    codexModels: state.codexModels,
    codexSelection: state.codexSelection,
    providerConnections: state.providerConnections,
    activeProfileId: state.activeProfileId,
    patchCodex: state.patchCodex,
    setCodexModels: state.setCodexModels,
    patchCodexSelection: state.patchCodexSelection,
  })));
  const openModels = useBrowserCommand("open-models");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const models = useMemo(
    () => modelCatalog(providerConnections, activeProfileId),
    [activeProfileId, providerConnections],
  );
  const activeModel = models.find((model) => model.id === activeModelId) ?? models[0]!;
  const selectedCodexModel = codexModels.find(
    (model) => model.id === codexSelection.modelId || model.model === codexSelection.modelId,
  ) ?? codexModels.find((model) => model.isDefault) ?? codexModels[0];
  const activeModelName = activeModelId === "codex:chatgpt" && selectedCodexModel
    ? selectedCodexModel.displayName
    : activeModel.name;

  const refreshStatus = useCallback(async () => {
    setCatalogError("");
    patchCodex({ state: "checking", message: "Checking Codex connection…" });
    try {
      const result = await getCodexAuthStatus();
      if (result.authenticated) {
        patchCodex({
          state: "signed-in",
          available: true,
          message: result.message,
          pendingModelId: undefined,
        });
        setCatalogLoading(true);
        try {
          const catalog = await getCodexModelCatalog();
          setCodexModels(catalog.models);
          patchCodex({
            message: `${result.message} · ${catalog.models.length} model${catalog.models.length === 1 ? "" : "s"} available.`,
          });
        } catch (error) {
          setCodexModels([]);
          setCatalogError(error instanceof Error ? error.message : String(error));
        } finally {
          setCatalogLoading(false);
        }
      } else {
        setCodexModels([]);
        patchCodex({
          state: result.available && result.healthy ? "signed-out" : "error",
          available: result.available && result.healthy,
          message: result.message || "Codex is not connected.",
        });
      }
    } catch (error) {
      patchCodex({
        state: "error",
        available: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [patchCodex, setCodexModels]);

  const beginLogin = useCallback(async () => {
    patchCodex({ state: "starting", message: "Opening secure sign-in…" });
    try {
      await startCodexLogin();
      patchCodex({
        state: "waiting-browser",
        available: true,
        message: "Complete sign-in in your browser, then return here.",
      });
    } catch (error) {
      patchCodex({
        state: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [patchCodex]);

  useEffect(() => {
    const openConnection = () => setConnectionOpen(true);
    const openPicker = () => setPickerOpen(true);
    window.addEventListener("vibesurfer:open-codex", openConnection);
    window.addEventListener("vibesurfer:open-model-picker", openPicker);
    return () => {
      window.removeEventListener("vibesurfer:open-codex", openConnection);
      window.removeEventListener("vibesurfer:open-model-picker", openPicker);
    };
  }, []);

  useEffect(() => {
    if (connectionOpen) void refreshStatus();
  }, [connectionOpen, refreshStatus]);

  const chooseModel = (model: ModelOptionDefinition) => {
    setPickerOpen(false);
    if (model.requiresCodex) {
      setConnectionOpen(true);
    } else if (!model.available) {
      openModels.execute();
    } else {
      setModel(model.id);
    }
  };

  const useCodex = () => {
    if (!selectedCodexModel) return;
    setModel("codex:chatgpt");
    setConnectionOpen(false);
  };

  return (
    <>
      <ModelPicker
        className={className}
        models={models}
        activeModelId={activeModelId}
        activeModelName={activeModelName}
        connectionState={codex.state}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={chooseModel}
        onManageModels={() => {
          setPickerOpen(false);
          openModels.execute();
        }}
      />
      <CodexConnectionDialog
        open={connectionOpen}
        connection={codex}
        models={codexModels}
        selection={codexSelection}
        catalogLoading={catalogLoading}
        catalogError={catalogError}
        onOpenChange={setConnectionOpen}
        onRefresh={refreshStatus}
        onBeginLogin={beginLogin}
        onUseCodex={useCodex}
        onSelectionChange={patchCodexSelection}
      />
    </>
  );
}
