import { execFileSync } from "node:child_process";
import { basename, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workerRoot = basename(process.cwd()) === "generation-worker"
  ? process.cwd()
  : resolve(process.cwd(), "generation-worker");

function dryRun(rustTarget: string, bunTarget: string): string {
  const output = execFileSync(
    process.execPath,
    [
      resolve(workerRoot, "scripts/build-sidecar.mjs"),
      "--rust-target",
      rustTarget,
      "--bun-target",
      bunTarget,
      "--dry-run",
    ],
    { cwd: workerRoot, encoding: "utf8" },
  ).trim();
  return basename(output);
}

describe("sidecar cross-build naming", () => {
  it("derives the executable extension from the Rust target, not the host or Bun target", () => {
    expect(dryRun("x86_64-pc-windows-msvc", "bun-linux-x64"))
      .toBe("vibesurfer-generation-worker-x86_64-pc-windows-msvc.exe");
    expect(dryRun("x86_64-unknown-linux-gnu", "bun-windows-x64"))
      .toBe("vibesurfer-generation-worker-x86_64-unknown-linux-gnu");
  });
});
