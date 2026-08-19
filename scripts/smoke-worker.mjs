import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const root = resolve(import.meta.dirname, "..");
const mode = process.argv[2] ?? "--sidecar";

const targets = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "win32-x64": "x86_64-pc-windows-msvc",
};

function workerCommand() {
  if (mode === "--dist") {
    const script = resolve(root, "generation-worker/dist/index.js");
    return { program: process.execPath, args: [script], description: script };
  }

  const target = targets[`${process.platform}-${process.arch}`];
  if (!target) throw new Error(`Unsupported smoke target: ${process.platform}-${process.arch}`);
  const extension = process.platform === "win32" ? ".exe" : "";
  const binary = resolve(
    root,
    `generation-worker/sidecars/vibesurfer-generation-worker-${target}${extension}`,
  );
  return { program: binary, args: [], description: binary };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function smokeCapabilityRenderer(command) {
  const child = spawn(command.program, [...command.args, "--capability-renderer=mermaid"], {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.end(JSON.stringify({ source: "graph LR\nA[Survey] --> B[Report]" }));
  const code = await new Promise((resolveExit, rejectTimeout) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      rejectTimeout(new Error("Capability renderer smoke timed out"));
    }, 3_000);
    child.once("close", (exitCode) => {
      clearTimeout(timeout);
      resolveExit(exitCode);
    });
  });
  assert(code === 0, `Capability renderer failed: ${stderr}`);
  const result = JSON.parse(stdout);
  assert(typeof result.svg === "string" && result.svg.includes("<svg"), "Capability renderer returned no SVG.");
}

const originRequests = [];
const origin = createServer((request, response) => {
  originRequests.push(request.url ?? "/");
  response.writeHead(500, { "content-type": "text/plain" });
  response.end("The generation worker must never contact the imagined origin.");
});

await new Promise((resolveListen, rejectListen) => {
  origin.once("error", rejectListen);
  origin.listen(0, "127.0.0.1", resolveListen);
});

const address = origin.address();
assert(address && typeof address === "object", "Could not resolve the fake origin address.");
const imaginedUrl = `http://127.0.0.1:${address.port}/never-fetch-this`;
const command = workerCommand();
assert(existsSync(command.program), `Worker does not exist: ${command.description}`);
await smokeCapabilityRenderer(command);

const child = spawn(command.program, command.args, {
  cwd: root,
  stdio: ["pipe", "pipe", "pipe"],
});
const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
const events = [];
let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr = `${stderr}${chunk}`.slice(-8_000);
});

let resolveInitialized;
let resolveTerminal;
const initialized = new Promise((resolvePromise) => {
  resolveInitialized = resolvePromise;
});
const terminal = new Promise((resolvePromise) => {
  resolveTerminal = resolvePromise;
});

lines.on("line", (line) => {
  const event = JSON.parse(line);
  events.push(event);
  if (event.type === "initialized") resolveInitialized(event);
  if (["generation.completed", "generation.failed", "generation.cancelled"].includes(event.type)) {
    resolveTerminal(event);
  }
});

function send(value) {
  child.stdin.write(`${JSON.stringify(value)}\n`);
}

const timeout = AbortSignal.timeout(30_000);
const wait = (promise, label) => Promise.race([
  promise,
  new Promise((_, reject) => {
    timeout.addEventListener("abort", () => reject(new Error(`${label} timed out`)), { once: true });
  }),
]);

try {
  send({
    type: "initialize",
    requestId: "smoke-initialize",
    protocolVersion: 1,
    client: { name: "vibesurfer-smoke", version: "0.1.0" },
  });
  const initializedEvent = await wait(initialized, "Worker initialization");
  assert(initializedEvent.protocolVersion === 1, "Worker negotiated the wrong protocol version.");

  send({
    type: "generate",
    requestId: "smoke-request",
    jobId: "smoke-job",
    request: {
      url: imaginedUrl,
      mode: "quick",
      provider: { id: "mock", kind: "mock", modelId: "mock-v1" },
      settings: {
        style: { tailwindEnabled: true, tailwindVersion: "4.3.3" },
        images: {
          enabled: false,
          provider: "off",
          safeContent: true,
          allowExternalRequests: false,
        },
        autoRepair: true,
        maxRequests: 1,
        maxOutputTokens: 20_000,
        minInternalLinks: 8,
        maxArtifactBytes: 1_000_000,
      },
      context: {
        relevantHistory: [],
        navigationIntent: {
          trigger: "address-bar",
          disposition: "current",
          requestedUrl: imaginedUrl,
        },
      },
    },
  });

  const terminalEvent = await wait(terminal, "Mock generation");
  assert(terminalEvent.type === "generation.completed", `Generation failed: ${JSON.stringify(terminalEvent)}`);
  assert(terminalEvent.artifact?.url === imaginedUrl, "Artifact URL does not match the imagined location.");
  assert(terminalEvent.artifact?.html?.includes("<html"), "Completed artifact has no HTML document.");
  assert(originRequests.length === 0, `Worker contacted the imagined origin: ${originRequests.join(", ")}`);

  const sequences = events
    .filter((event) => event.jobId === "smoke-job" && Number.isInteger(event.sequence))
    .map((event) => event.sequence);
  assert(sequences.length > 1, "Generation emitted too few sequenced events.");
  assert(sequences.every((sequence, index) => sequence === index + 1), "Generation sequences are not monotonic.");

  process.stdout.write(
    `worker smoke passed (${mode === "--dist" ? "dist" : "sidecar"}, ${sequences.length} events, zero origin requests)\n`,
  );
} finally {
  child.stdin.end();
  lines.close();
  if (child.exitCode === null) child.kill();
  await new Promise((resolveClose) => origin.close(resolveClose));
}
