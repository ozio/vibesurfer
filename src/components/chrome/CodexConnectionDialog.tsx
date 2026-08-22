import { CircleAlert, ExternalLink, Sparkles } from "lucide-react";
import type {
  CodexConnection,
  CodexGenerationSelection,
  CodexModel,
} from "../../types/browser";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

export interface CodexConnectionDialogProps {
  open: boolean;
  connection: CodexConnection;
  models: readonly CodexModel[];
  selection: CodexGenerationSelection;
  catalogLoading?: boolean;
  catalogError?: string;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void | Promise<void>;
  onBeginLogin: () => void | Promise<void>;
  onUseCodex: () => void;
  onSelectionChange: (patch: Partial<CodexGenerationSelection>) => void;
}

export function CodexConnectionDialog({
  open,
  connection,
  models,
  selection,
  catalogLoading = false,
  catalogError = "",
  onOpenChange,
  onRefresh,
  onBeginLogin,
  onUseCodex,
  onSelectionChange,
}: CodexConnectionDialogProps) {
  const selectedModel = models.find(
    (model) => model.id === selection.modelId || model.model === selection.modelId,
  ) ?? models.find((model) => model.isDefault) ?? models[0];

  return (
    <Dialog
      className="codex-dialog"
      size="large"
      open={open}
      onOpenChange={onOpenChange}
      title={(
        <span className="codex-dialog__title">
          <span className="codex-dialog__icon"><Sparkles aria-hidden="true" /></span>
          <span>Codex (ChatGPT)</span>
        </span>
      )}
      description="Use the ChatGPT session available on this Mac, then choose the model, response speed, and reasoning effort for generated pages."
      footer={(
        <CodexDialogActions
          connection={connection}
          canUseCodex={Boolean(selectedModel) && !catalogLoading}
          catalogLoading={catalogLoading}
          onRefresh={onRefresh}
          onBeginLogin={onBeginLogin}
          onUseCodex={onUseCodex}
        />
      )}
    >
      <div
        className={`connection-status connection-status--${connection.state}`}
        role={connection.state === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        {connection.state === "error"
          ? <CircleAlert aria-hidden="true" />
          : <span className="connection-status__dot" />}
        <span>{connection.message}</span>
      </div>
      {connection.state === "signed-in" && (
        <div className="codex-controls" aria-label="Codex generation settings">
          {catalogLoading ? (
            <div className="codex-controls__message" role="status">Loading models from ChatGPT…</div>
          ) : catalogError ? (
            <div className="codex-controls__message is-error" role="alert">
              Could not load models: {catalogError}
            </div>
          ) : selectedModel ? (
            <>
              <label className="codex-control">
                <span><strong>Model</strong><small>Available to this ChatGPT account</small></span>
                <select
                  aria-label="Codex model"
                  value={selectedModel.id}
                  onChange={(event) => onSelectionChange({ modelId: event.target.value })}
                >
                  {models.map((model) => (
                    <option key={model.id} value={model.id}>{model.displayName}</option>
                  ))}
                </select>
              </label>
              <label className="codex-control">
                <span><strong>Speed</strong><small>Fast is shown only when the model advertises it</small></span>
                <select
                  aria-label="Codex speed"
                  value={selection.serviceTier ?? ""}
                  onChange={(event) => onSelectionChange({ serviceTier: event.target.value || undefined })}
                >
                  <option value="">Standard</option>
                  {selectedModel.serviceTiers.map((tier) => (
                    <option key={tier.id} value={tier.id}>{tier.name}</option>
                  ))}
                </select>
              </label>
              <label className="codex-control">
                <span>
                  <strong>Reasoning effort</strong>
                  <small>{selectedModel.supportedReasoningEfforts.find(
                    (option) => option.reasoningEffort === selection.reasoningEffort,
                  )?.description ?? "Uses the model default"}</small>
                </span>
                <select
                  aria-label="Codex reasoning effort"
                  value={selection.reasoningEffort ?? ""}
                  disabled={selectedModel.supportedReasoningEfforts.length === 0}
                  onChange={(event) => onSelectionChange({ reasoningEffort: event.target.value || undefined })}
                >
                  {selectedModel.supportedReasoningEfforts.length === 0 && <option value="">Default</option>}
                  {selectedModel.supportedReasoningEfforts.map((option) => (
                    <option key={option.reasoningEffort} value={option.reasoningEffort}>
                      {displayEffort(option.reasoningEffort)}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <div className="codex-controls__message" role="status">
              No compatible Codex models are available for this ChatGPT account.
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

function CodexDialogActions({
  connection,
  canUseCodex,
  catalogLoading,
  onRefresh,
  onBeginLogin,
  onUseCodex,
}: {
  connection: CodexConnection;
  canUseCodex: boolean;
  catalogLoading: boolean;
  onRefresh: () => void | Promise<void>;
  onBeginLogin: () => void | Promise<void>;
  onUseCodex: () => void;
}) {
  if (connection.state === "signed-in") {
    return (
      <>
        <Button variant="primary" disabled={!canUseCodex} onClick={onUseCodex}>Use Codex</Button>
        <Button disabled={catalogLoading} onClick={() => void onRefresh()}>Refresh</Button>
      </>
    );
  }

  if (connection.state === "waiting-browser") {
    return (
      <>
        <Button variant="primary" onClick={() => void onRefresh()}>I’ve signed in</Button>
        <Button leadingIcon={<ExternalLink aria-hidden="true" />} onClick={() => void onBeginLogin()}>Open again</Button>
      </>
    );
  }

  return (
    <>
      <Button
        variant="primary"
        disabled={!connection.available || connection.state === "checking" || connection.state === "starting"}
        onClick={() => void onBeginLogin()}
      >
        Continue with Codex
      </Button>
      <Button onClick={() => void onRefresh()}>Check again</Button>
    </>
  );
}

function displayEffort(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
