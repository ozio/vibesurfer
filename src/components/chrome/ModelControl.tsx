import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, CircleAlert, Cpu, ExternalLink, Search, Sparkles, WandSparkles } from "lucide-react";
import { Dialog, Popover } from "radix-ui";
import { modelCatalog } from "../../data/catalog";
import { getCodexAuthStatus, getCodexModelCatalog, startCodexLogin } from "../../lib/codex";
import { useBrowserStore } from "../../store/browser-store";

export function ModelControl() {
  const activeModelId = useBrowserStore((state) => state.activeModelId);
  const setModel = useBrowserStore((state) => state.setModel);
  const codex = useBrowserStore((state) => state.codex);
  const codexModels = useBrowserStore((state) => state.codexModels);
  const codexSelection = useBrowserStore((state) => state.codexSelection);
  const providerConnections = useBrowserStore((state) => state.providerConnections);
  const activeProfileId = useBrowserStore((state) => state.activeProfileId);
  const patchCodex = useBrowserStore((state) => state.patchCodex);
  const setCodexModels = useBrowserStore((state) => state.setCodexModels);
  const patchCodexSelection = useBrowserStore((state) => state.patchCodexSelection);
  const openSettings = useBrowserStore((state) => state.openSettings);
  const [query, setQuery] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const models = useMemo(() => modelCatalog(providerConnections, activeProfileId), [activeProfileId, providerConnections]);
  const activeModel = models.find((model) => model.id === activeModelId) ?? models[0];
  const visibleModels = useMemo(
    () => models.filter((model) => `${model.name} ${model.provider}`.toLowerCase().includes(query.toLowerCase())),
    [models, query],
  );
  const selectedCodexModel = codexModels.find(
    (model) => model.id === codexSelection.modelId || model.model === codexSelection.modelId,
  ) ?? codexModels.find((model) => model.isDefault) ?? codexModels[0];
  const activeModelName = activeModelId === "codex:chatgpt" && selectedCodexModel
    ? selectedCodexModel.displayName
    : activeModel.name;

  useEffect(() => {
    const open = () => setLoginOpen(true);
    window.addEventListener("vibesurfer:open-codex", open);
    return () => window.removeEventListener("vibesurfer:open-codex", open);
  }, []);

  useEffect(() => {
    const open = () => setPickerOpen(true);
    window.addEventListener("vibesurfer:open-model-picker", open);
    return () => window.removeEventListener("vibesurfer:open-model-picker", open);
  }, []);

  useEffect(() => {
    if (!loginOpen) return;
    void refreshStatus();
  }, [loginOpen]);

  const refreshStatus = async () => {
    setCatalogError("");
    patchCodex({ state: "checking", message: "Checking Codex connection…" });
    try {
      const result = await getCodexAuthStatus();
      if (result.authenticated) {
        patchCodex({ state: "signed-in", available: true, message: result.message, pendingModelId: undefined });
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
      patchCodex({ state: "error", available: false, message: error instanceof Error ? error.message : String(error) });
    }
  };

  const chooseModel = (modelId: string) => {
    const model = models.find((item) => item.id === modelId);
    if (model?.requiresCodex) {
      setPickerOpen(false);
      setLoginOpen(true);
      return;
    }
    if (!model?.available) {
      setPickerOpen(false);
      openSettings("models");
      return;
    }
    setModel(model.id);
    setPickerOpen(false);
  };

  const beginLogin = async () => {
    patchCodex({ state: "starting", message: "Opening secure sign-in…" });
    try {
      await startCodexLogin();
      patchCodex({ state: "waiting-browser", available: true, message: "Complete sign-in in your browser, then return here." });
    } catch (error) {
      patchCodex({ state: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const useCodex = () => {
    if (!selectedCodexModel) return;
    setModel("codex:chatgpt");
    setLoginOpen(false);
  };

  return (
    <>
      <Popover.Root open={pickerOpen} onOpenChange={setPickerOpen}>
        <Popover.Trigger asChild>
          <button className="model-pill" type="button" aria-label={`Model: ${activeModelName}`}>
            <span className="model-pill__mark"><Sparkles aria-hidden="true" /></span>
            <span className="model-pill__copy">
              <small>Model</small>
              <strong>{activeModelName}</strong>
            </span>
            <span className={`model-pill__status${codex.state === "signed-in" ? " is-online" : ""}`} />
            <ChevronDown className="model-pill__chevron" aria-hidden="true" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="popover model-popover" align="end" sideOffset={8} collisionPadding={12}>
            <div className="popover__header">
              <div><strong>Choose a model</strong><small>Applies to the next generation</small></div>
            </div>
            <label className="model-search">
              <Search aria-hidden="true" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search models" />
            </label>
            <div className="model-list">
              {visibleModels.map((model) => (
                <button
                  key={model.id}
                  className={`model-row${activeModelId === model.id ? " is-active" : ""}`}
                  type="button"
                  onClick={() => chooseModel(model.id)}
                >
                  <span className="model-row__icon">{model.group === "local" ? <Cpu aria-hidden="true" /> : <WandSparkles aria-hidden="true" />}</span>
                  <span className="model-row__copy">
                    <span><strong>{model.name}</strong>{model.badge && <em>{model.badge}</em>}</span>
                    <small>{model.provider} · {model.description}</small>
                  </span>
                  {!model.available ? <span className="model-row__connect">Set up</span> : activeModelId === model.id ? <Check aria-hidden="true" /> : model.requiresCodex ? <span className="model-row__connect">Configure</span> : null}
                </button>
              ))}
            </div>
            <button className="popover__footer-action" type="button" onClick={() => openSettings("models")}>Manage models and accounts…</button>
            <Popover.Arrow className="popover__arrow" />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <Dialog.Root open={loginOpen} onOpenChange={setLoginOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog codex-dialog" aria-describedby="codex-dialog-description">
            <div className="codex-dialog__icon"><Sparkles aria-hidden="true" /></div>
            <Dialog.Title>Codex (ChatGPT)</Dialog.Title>
            <Dialog.Description id="codex-dialog-description">
              Use the ChatGPT session already available on this Mac, then choose the model, response speed, and reasoning effort for generated pages.
            </Dialog.Description>
            <div className={`connection-status connection-status--${codex.state}`}>
              {codex.state === "error" ? <CircleAlert aria-hidden="true" /> : <span className="connection-status__dot" />}
              <span>{codex.message}</span>
            </div>
            {codex.state === "signed-in" && (
              <div className="codex-controls" aria-label="Codex generation settings">
                {catalogLoading ? (
                  <div className="codex-controls__message" role="status">Loading models from ChatGPT…</div>
                ) : catalogError ? (
                  <div className="codex-controls__message is-error" role="alert">Could not load models: {catalogError}</div>
                ) : selectedCodexModel ? (
                  <>
                    <label className="codex-control">
                      <span><strong>Model</strong><small>Available to this ChatGPT account</small></span>
                      <select
                        aria-label="Codex model"
                        value={selectedCodexModel.id}
                        onChange={(event) => patchCodexSelection({ modelId: event.target.value })}
                      >
                        {codexModels.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}
                      </select>
                    </label>
                    <label className="codex-control">
                      <span><strong>Speed</strong><small>Fast is shown only when the model advertises it</small></span>
                      <select
                        aria-label="Codex speed"
                        value={codexSelection.serviceTier ?? ""}
                        onChange={(event) => patchCodexSelection({ serviceTier: event.target.value || undefined })}
                      >
                        <option value="">Standard</option>
                        {selectedCodexModel.serviceTiers.map((tier) => <option key={tier.id} value={tier.id}>{tier.name}</option>)}
                      </select>
                    </label>
                    <label className="codex-control">
                      <span><strong>Reasoning effort</strong><small>{selectedCodexModel.supportedReasoningEfforts.find((option) => option.reasoningEffort === codexSelection.reasoningEffort)?.description ?? "Uses the model default"}</small></span>
                      <select
                        aria-label="Codex reasoning effort"
                        value={codexSelection.reasoningEffort ?? ""}
                        disabled={selectedCodexModel.supportedReasoningEfforts.length === 0}
                        onChange={(event) => patchCodexSelection({ reasoningEffort: event.target.value || undefined })}
                      >
                        {selectedCodexModel.supportedReasoningEfforts.length === 0 && <option value="">Default</option>}
                        {selectedCodexModel.supportedReasoningEfforts.map((option) => (
                          <option key={option.reasoningEffort} value={option.reasoningEffort}>{displayEffort(option.reasoningEffort)}</option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : (
                  <div className="codex-controls__message" role="status">No compatible Codex models are available for this ChatGPT account.</div>
                )}
              </div>
            )}
            <div className="dialog__actions">
              {codex.state === "signed-in" ? (
                <>
                  <button className="button button--primary" type="button" disabled={catalogLoading || !selectedCodexModel} onClick={useCodex}>Use Codex</button>
                  <button className="button" type="button" disabled={catalogLoading} onClick={() => void refreshStatus()}>Refresh</button>
                </>
              ) : codex.state === "waiting-browser" ? (
                <>
                  <button className="button button--primary" type="button" onClick={() => void refreshStatus()}>I’ve signed in</button>
                  <button className="button" type="button" onClick={() => void beginLogin()}><ExternalLink aria-hidden="true" /> Open again</button>
                </>
              ) : (
                <>
                  <button className="button button--primary" type="button" disabled={!codex.available || codex.state === "checking" || codex.state === "starting"} onClick={() => void beginLogin()}>
                    Continue with Codex
                  </button>
                  <button className="button" type="button" onClick={() => void refreshStatus()}>Check again</button>
                </>
              )}
            </div>
            <Dialog.Close className="dialog__close" aria-label="Close"><span>×</span></Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function displayEffort(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
