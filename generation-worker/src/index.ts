#!/usr/bin/env node
import { once } from "node:events";
import { createInterface } from "node:readline";

import { WorkerRuntime, type OutputSink } from "./runtime.js";

class JsonlWriter {
  #queue: Promise<void> = Promise.resolve();

  write(value: unknown): Promise<void> {
    const line = `${JSON.stringify(value)}\n`;
    this.#queue = this.#queue.then(async () => {
      if (!process.stdout.write(line, "utf8")) {
        await once(process.stdout, "drain");
      }
    });
    return this.#queue;
  }
}
export async function runStdioWorker(): Promise<void> {
  const writer = new JsonlWriter();
  const sink: OutputSink = (output) => writer.write(output);
  const runtime = new WorkerRuntime(sink);
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });

  for await (const line of lines) {
    if (!line.trim()) continue;
    await runtime.handleLine(line);
    if (runtime.shutdownRequested) break;
  }
  await runtime.close();
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  runStdioWorker().catch(() => {
    // stdout is reserved for JSONL protocol messages; never print raw failures or input.
    process.exitCode = 1;
  });
}
