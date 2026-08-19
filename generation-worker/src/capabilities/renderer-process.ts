import { spawn } from "node:child_process";
import { resolve } from "node:path";

export const MERMAID_RENDERER_ARGUMENT = "--capability-renderer=mermaid";

const RENDERER_TIMEOUT_MS = 2_000;
const MAX_RENDERER_OUTPUT_BYTES = 512 * 1024;

async function renderMermaidDirect(source: string): Promise<string> {
  const { renderMermaidSVG } = await import("beautiful-mermaid");
  return renderMermaidSVG(source, {
    bg: "transparent",
    fg: "currentColor",
    transparent: true,
  });
}

function childCommand(): { program: string; args: string[] } {
  const script = process.argv[1];
  if (!script || resolve(script) === resolve(process.execPath)) {
    return { program: process.execPath, args: [MERMAID_RENDERER_ARGUMENT] };
  }
  return { program: process.execPath, args: [script, MERMAID_RENDERER_ARGUMENT] };
}

export async function renderMermaidIsolated(source: string, signal?: AbortSignal): Promise<string> {
  // Vitest imports TypeScript directly rather than through the executable entrypoint.
  // Packaged and dist smoke tests exercise the real process boundary.
  if (process.env.VITEST) return renderMermaidDirect(source);

  const command = childCommand();
  const child = spawn(command.program, command.args, {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "ignore"],
  });

  return new Promise<string>((resolvePromise, rejectPromise) => {
    let stdout = "";
    let settled = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, RENDERER_TIMEOUT_MS);
    const abort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", abort, { once: true });

    const finish = (error?: Error, svg?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      if (error) rejectPromise(error);
      else resolvePromise(svg ?? "");
    };

    child.once("error", (error) => finish(error));
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout, "utf8") > MAX_RENDERER_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        finish(new Error("Diagram renderer exceeded its output budget."));
      }
    });
    child.once("close", (code) => {
      if (timedOut) return finish(new Error("Diagram renderer exceeded its two-second budget."));
      if (signal?.aborted) return finish(new Error("Diagram rendering was cancelled."));
      if (code !== 0) return finish(new Error("Diagram renderer process failed."));
      try {
        const result = JSON.parse(stdout) as { svg?: unknown };
        if (typeof result.svg !== "string") throw new Error("Diagram renderer returned malformed output.");
        finish(undefined, result.svg);
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Diagram renderer returned malformed output."));
      }
    });
    child.stdin.on("error", () => { /* A closing renderer is reported through close. */ });
    child.stdin.end(JSON.stringify({ source }));
  });
}

export async function runCapabilityRendererProcess(): Promise<void> {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input, "utf8") > 32 * 1024) throw new Error("Renderer input exceeds its budget.");
  }
  const request = JSON.parse(input) as { source?: unknown };
  if (typeof request.source !== "string" || request.source.length > 24 * 1024) {
    throw new Error("Renderer source is missing or too large.");
  }
  const svg = await renderMermaidDirect(request.source);
  process.stdout.write(JSON.stringify({ svg }));
}
