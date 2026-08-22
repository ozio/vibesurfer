import { useEffect, useMemo, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Check, Copy, TriangleAlert } from "lucide-react";

export interface CopyButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
  text: string;
  label?: string;
  copiedLabel?: string;
  failedLabel?: string;
  showLabel?: boolean;
  resetAfter?: number;
  writeText?: (text: string) => Promise<void>;
  onCopied?: () => void;
  onCopyError?: (error: unknown) => void;
}

export function CopyButton({
  text,
  label = "Copy",
  copiedLabel = "Copied",
  failedLabel = "Copy failed",
  showLabel = false,
  resetAfter = 1600,
  writeText,
  onCopied,
  onCopyError,
  className = "",
  disabled,
  ...props
}: CopyButtonProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (status === "idle") return;
    const timeout = window.setTimeout(() => setStatus("idle"), resetAfter);
    return () => window.clearTimeout(timeout);
  }, [resetAfter, status]);

  const statusLabel = status === "copied" ? copiedLabel : status === "failed" ? failedLabel : label;
  const Icon = status === "copied" ? Check : status === "failed" ? TriangleAlert : Copy;
  const copy = async () => {
    try {
      const writer = writeText ?? navigator.clipboard?.writeText.bind(navigator.clipboard);
      if (!writer) throw new Error("Clipboard API is unavailable");
      await writer(text);
      setStatus("copied");
      onCopied?.();
    } catch (error) {
      setStatus("failed");
      onCopyError?.(error);
    }
  };

  return (
    <button
      className={`ui-copy-button ${className}`.trim()}
      type="button"
      aria-label={showLabel ? undefined : statusLabel}
      data-state={status}
      disabled={disabled}
      onClick={() => void copy()}
      {...props}
    >
      <Icon aria-hidden="true" />
      <span className={showLabel ? undefined : "sr-only"} aria-live="polite">{statusLabel}</span>
    </button>
  );
}

export interface CodeBlockProps {
  code: string;
  language?: string;
  label?: ReactNode;
  copyable?: boolean;
  wrap?: boolean;
  className?: string;
  writeText?: (text: string) => Promise<void>;
}

export function CodeBlock({ code, language, label, copyable = true, wrap = false, className = "", writeText }: CodeBlockProps) {
  return (
    <figure className={`ui-code-block${wrap ? " is-wrapped" : ""} ${className}`.trim()}>
      {(label || language || copyable) && (
        <figcaption>
          <span>{label}{language && <small>{language}</small>}</span>
          {copyable && <CopyButton text={code} writeText={writeText} />}
        </figcaption>
      )}
      <pre tabIndex={0}><code className={language ? `language-${language}` : undefined}>{code}</code></pre>
    </figure>
  );
}

export interface JsonViewerProps {
  value: unknown;
  title?: ReactNode;
  defaultOpen?: boolean;
  collapsed?: boolean;
  maxDepth?: number;
  copyable?: boolean;
  className?: string;
  writeText?: (text: string) => Promise<void>;
}

function serializeJson(value: unknown, maxDepth: number) {
  const seen = new WeakSet<object>();
  const depth = new WeakMap<object, number>();
  return JSON.stringify(value, function (this: unknown, key, nestedValue: unknown) {
    if (typeof nestedValue === "bigint") return `${nestedValue}n`;
    if (!nestedValue || typeof nestedValue !== "object") return nestedValue;
    if (seen.has(nestedValue)) return "[Circular]";
    const parentDepth = typeof this === "object" && this !== null ? (depth.get(this) ?? -1) : -1;
    const nestedDepth = key === "" ? 0 : parentDepth + 1;
    if (nestedDepth > maxDepth) return Array.isArray(nestedValue) ? "[Array]" : "[Object]";
    seen.add(nestedValue);
    depth.set(nestedValue, nestedDepth);
    return nestedValue;
  }, 2) ?? String(value);
}

export function JsonViewer({
  value,
  title = "JSON",
  defaultOpen = true,
  collapsed = false,
  maxDepth = 12,
  copyable = true,
  className = "",
  writeText,
}: JsonViewerProps) {
  const json = useMemo(() => serializeJson(value, maxDepth), [maxDepth, value]);
  if (!collapsed) return <CodeBlock code={json} language="json" label={title} copyable={copyable} className={className} writeText={writeText} />;
  return (
    <details className={`ui-json-viewer ${className}`.trim()} open={defaultOpen}>
      <summary>{title}</summary>
      <CodeBlock code={json} language="json" copyable={copyable} writeText={writeText} />
    </details>
  );
}
