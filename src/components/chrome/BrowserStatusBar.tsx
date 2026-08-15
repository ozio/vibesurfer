import { useState } from "react";
import { Dialog } from "radix-ui";
import type { ModelExchange, PageArtifact, TokenUsage } from "../../types/browser";

interface BrowserStatusBarProps {
  location: string;
  hoveredLink?: string;
  profileName: string;
  modelName: string;
  artifact?: PageArtifact;
  activeUsage?: TokenUsage;
}

export function BrowserStatusBar({
  location,
  hoveredLink,
  profileName,
  modelName,
  artifact,
  activeUsage,
}: BrowserStatusBarProps) {
  const [open, setOpen] = useState(false);
  const usage = artifact?.usage ?? activeUsage;
  const exchanges = artifact?.modelExchanges ?? [];
  const summary = compactUsage(usage, exchanges.length);
  const canInspect = Boolean(usage || exchanges.length);
  const destination = hoveredLink ?? location;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <footer className="browser-statusbar" title={hoveredLink}>
        <div className="browser-statusbar__modern">
          <span className="browser-statusbar__destination"><i className="status-orb" />{destination}</span>
          <span className="browser-statusbar__identity">{profileName} · {modelName}</span>
          <StatusInspectorTrigger disabled={!canInspect}>{summary}</StatusInspectorTrigger>
        </div>
        <div className="browser-statusbar__classic">
          <span className="classic-status-destination">
            {!hoveredLink && <i className="classic-status-icon">e</i>}
            {hoveredLink ?? "Done"}
          </span>
          <span className="classic-status-zone"><i className="classic-status-globe" />Hallunet</span>
          <StatusInspectorTrigger disabled={!canInspect} classic>{summary}</StatusInspectorTrigger>
          <span className="classic-status-zoom">⌕&nbsp; 100%</span>
          <i className="classic-resize-grip" aria-hidden="true" />
        </div>
      </footer>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog generation-inspector" aria-describedby="generation-inspector-description">
          <header className="generation-inspector__header">
            <div>
              <Dialog.Title>Generation details</Dialog.Title>
              <Dialog.Description id="generation-inspector-description">
                Token usage and the exact request/response record stored with this page.
              </Dialog.Description>
            </div>
            <Dialog.Close className="dialog__close" aria-label="Close generation details"><span>×</span></Dialog.Close>
          </header>
          <UsageSummary usage={usage} exchanges={exchanges} />
          <dl className="generation-inspector__metadata">
            <div><dt>URL</dt><dd>{artifact?.url ?? location}</dd></div>
            <div><dt>Model</dt><dd>{artifact?.modelId ?? modelName}</dd></div>
            {artifact && <div><dt>Pipeline</dt><dd>{exchanges.length === 1 ? "Compact local" : "Director → Builder"}</dd></div>}
            {artifact && <div><dt>Generated</dt><dd>{formatTimestamp(artifact.createdAt)}</dd></div>}
          </dl>
          <section className="generation-inspector__exchanges" aria-label="Model requests and responses">
            {exchanges.length > 0
              ? exchanges.map((exchange, index) => <ExchangeDetails key={exchange.id} exchange={exchange} index={index} />)
              : <p className="generation-inspector__empty">This artifact predates request logging. Its aggregate token usage is still available above.</p>}
          </section>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function StatusInspectorTrigger({
  children,
  disabled,
  classic = false,
}: {
  children: string;
  disabled: boolean;
  classic?: boolean;
}) {
  return (
    <Dialog.Trigger asChild>
      <button
        className={classic ? "browser-statusbar__usage classic-status-usage" : "browser-statusbar__usage"}
        type="button"
        disabled={disabled}
        title={disabled ? "No generation statistics for this page" : "Open generation details"}
      >
        {children}
      </button>
    </Dialog.Trigger>
  );
}

function UsageSummary({ usage, exchanges }: { usage?: TokenUsage; exchanges: ModelExchange[] }) {
  const requests = usage?.requests ?? exchanges.length;
  return (
    <div className="generation-inspector__summary">
      <Metric label="Requests" value={formatNumber(requests)} />
      <Metric label="Input" value={formatTokens(usage?.inputTokens)} />
      <Metric label="Output" value={formatTokens(usage?.outputTokens)} />
      <Metric label="Total" value={formatTokens(usage?.totalTokens)} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function ExchangeDetails({ exchange, index }: { exchange: ModelExchange; index: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <details className="generation-exchange" onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>
        <span><strong>{index + 1}. {stageName(exchange.purpose)}</strong><small>{exchange.providerId} · {exchange.modelId}</small></span>
        <span>{formatDuration(exchange.durationMs)} · {formatTokens(exchange.usage.totalTokens)}</span>
      </summary>
      {expanded && (
        <div className="generation-exchange__body">
          <PromptBlock title="System prompt" value={exchange.systemPrompt} />
          <PromptBlock title="Request" value={exchange.prompt} />
          <PromptBlock title="Response" value={exchange.response} />
        </div>
      )}
    </details>
  );
}

function PromptBlock({ title, value }: { title: string; value: string }) {
  return <section><h3>{title}</h3><pre>{value}</pre></section>;
}

function compactUsage(usage: TokenUsage | undefined, exchangeCount: number) {
  const requests = usage?.requests ?? exchangeCount;
  if (!usage && requests === 0) return "No stats";
  return `${requests} req · in ${formatTokens(usage?.inputTokens)} · out ${formatTokens(usage?.outputTokens)}`;
}

function formatNumber(value: number | undefined) {
  return new Intl.NumberFormat().format(value ?? 0);
}

function formatTokens(value: number | undefined) {
  const amount = value ?? 0;
  if (amount < 1_000) return formatNumber(amount);
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(amount / 1_000)}k`;
}

function formatDuration(value: number) {
  if (value < 1_000) return `${value} ms`;
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} s`;
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function stageName(stage: ModelExchange["purpose"]) {
  return ({
    "page-director": "Director",
    "page-builder": "Builder",
  } satisfies Record<ModelExchange["purpose"], string>)[stage];
}
