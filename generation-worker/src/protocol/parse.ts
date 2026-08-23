import {
  HostCancelCommandSchema,
  HostGenerateCommandSchema,
  HostResetCommandSchema,
  InitializeCommandSchema,
  ProviderVerifyCommandSchema,
  WorkerCommandSchema,
  type WorkerInput,
} from "./types.js";

export type ParseCommandResult =
  | { ok: true; command: WorkerInput }
  | {
      ok: false;
      requestId?: string;
      message: string;
      issues?: Array<{ path: string; message: string }>;
    };

function possibleRequestId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("requestId" in value)) {
    return undefined;
  }
  const requestId = Reflect.get(value, "requestId");
  return typeof requestId === "string" && requestId.length <= 160 ? requestId : undefined;
}

export function parseCommandLine(line: string): ParseCommandResult {
  let raw: unknown;
  try {
    raw = JSON.parse(line) as unknown;
  } catch {
    return { ok: false, message: "Input must be one complete JSON object per line." };
  }

  const rawType = typeof raw === "object" && raw !== null && "type" in raw ? Reflect.get(raw, "type") : undefined;
  const schema =
    rawType === "initialize"
      ? InitializeCommandSchema
      : rawType === "provider.verify"
        ? ProviderVerifyCommandSchema
        : rawType === "reset"
          ? HostResetCommandSchema
        : rawType === "generate" && "request" in (raw as object)
          ? HostGenerateCommandSchema
          : rawType === "cancel" && !("v" in (raw as object))
            ? HostCancelCommandSchema
            : WorkerCommandSchema;
  const parsed = schema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, command: parsed.data };
  }

  const issues = parsed.error.issues.slice(0, 12).map((issue) => ({
    path: issue.path.join("."),
    message: issue.message.slice(0, 300),
  }));

  const requestId = possibleRequestId(raw);
  return {
    ok: false,
    ...(requestId ? { requestId } : {}),
    message: "Command does not match protocol version 1.",
    ...(issues.length > 0 ? { issues } : {}),
  };
}
