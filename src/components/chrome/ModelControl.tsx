import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, CircleAlert, Cpu, ExternalLink, Search, Sparkles, WandSparkles } from "lucide-react";
import { Dialog, Popover } from "radix-ui";
import { modelCatalog } from "../../data/catalog";
import { getCodexAuthStatus, startCodexLogin } from "../../lib/codex";
import { useBrowserStore } from "../../store/browser-store";

export function ModelControl() {
  const activeModelId = useBrowserStore((state) => state.activeModelId);
  const setModel = useBrowserStore((state) => state.setModel);
  const codex = useBrowserStore((state) => state.codex);
  const providerConnections = useBrowserStore((state) => state.providerConnections);
  const activeProfileId = useBrowserStore((state) => state.activeProfileId);
  const patchCodex = useBrowserStore((state) => state.patchCodex);
  const openSettings = useBrowserStore((state) => state.openSettings);
  const [query, setQuery] = useState("");
  const [loginOpen, setLoginOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const models = useMemo(() => modelCatalog(providerConnections, activeProfileId), [activeProfileId, providerConnections]);
  const activeModel = models.find((model) => model.id === activeModelId) ?? models[0];
  const visibleModels = useMemo(
    () => models.filter((model) => `${model.name} ${model.provider}`.toLowerCase().includes(query.toLowerCase())),
    [models, query],
  );

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
    patchCodex({ state: "checking", message: "Checking Codex connection…" });
    try {
      const result = await getCodexAuthStatus();
      if (result.authenticated) {
        const pendingModelId = useBrowserStore.getState().codex.pendingModelId;
        patchCodex({ state: "signed-in", available: true, message: result.message, pendingModelId: undefined });
        if (pendingModelId) setModel(pendingModelId);
      } else {
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
    if (!model?.available) {
      setPickerOpen(false);
      openSettings("models");
      return;
    }
    if (model.requiresCodex && codex.state !== "signed-in") {
      patchCodex({ pendingModelId: model.id });
      setPickerOpen(false);
      setLoginOpen(true);
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

  return (
    <>
      <Popover.Root open={pickerOpen} onOpenChange={setPickerOpen}>
        <Popover.Trigger asChild>
          <button className="model-pill" type="button" aria-label={`Model: ${activeModel.name}`}>
            <span className="model-pill__mark"><Sparkles aria-hidden="true" /></span>
            <span className="model-pill__copy">
              <small>Model</small>
              <strong>{activeModel.name}</strong>
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
                  {!model.available ? <span className="model-row__connect">Set up</span> : activeModelId === model.id ? <Check aria-hidden="true" /> : null}
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
            <Dialog.Title>Connect Codex</Dialog.Title>
            <Dialog.Description id="codex-dialog-description">
              Check your existing Codex sign-in for the upcoming App Server adapter. Codex page generation is not enabled in this build; use a BYOK provider or Vibe Preview today.
            </Dialog.Description>
            <div className={`connection-status connection-status--${codex.state}`}>
              {codex.state === "error" ? <CircleAlert aria-hidden="true" /> : <span className="connection-status__dot" />}
              <span>{codex.message}</span>
            </div>
            <div className="dialog__actions">
              {codex.state === "signed-in" ? (
                <Dialog.Close asChild><button className="button button--primary" type="button">Done</button></Dialog.Close>
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
