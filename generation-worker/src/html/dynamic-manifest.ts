import type { ArtifactWarning, DynamicAction, DynamicManifest, DynamicRegion } from "../domain.js";
import type { DocumentNode, ElementNode } from "./tree.js";
import { elements, getAttribute, removeAttribute, setAttribute } from "./tree.js";

const MAX_REGIONS = 16;
const MAX_ACTIONS = 32;
const MAX_BINDINGS = 64;
const REGION_ID = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const ACTION = /^(state|model):([A-Za-z][A-Za-z0-9.-]{0,63})$/;
const STATE_ACTIONS = new Map([
  ["cart.add", "cart.add"],
  ["cart.remove", "cart.remove"],
  ["cart.setquantity", "cart.setQuantity"],
  ["wishlist.toggle", "wishlist.toggle"],
  ["value.set", "value.set"],
]);
const BINDING = /^(?:cart\.(?:count|total)|wishlist\.count|value\.[A-Za-z][A-Za-z0-9_.-]{0,63})$/;
const DYNAMIC_ATTRIBUTES = ["data-vibe-region", "data-vibe-refresh", "data-vibe-action", "data-vibe-target", "data-vibe-bind"];

export interface CompileDynamicManifestInput {
  document: DocumentNode;
  enabled: boolean;
}

export interface CompileDynamicManifestResult {
  manifest?: DynamicManifest;
  warnings: ArtifactWarning[];
}

export function compileDynamicManifest(input: CompileDynamicManifestInput): CompileDynamicManifestResult {
  const all = elements(input.document);
  const localTabs = all.some((element) => getAttribute(element, "data-vibe-tabs") !== undefined);
  const warnings: ArtifactWarning[] = [];

  if (!input.enabled) {
    for (const element of all) stripDynamicAttributes(element);
    return localTabs
      ? { manifest: { version: 1, regions: [], actions: [], bindings: [], localTabs: true }, warnings }
      : { warnings };
  }

  const regions: DynamicRegion[] = [];
  const regionIds = new Set<string>();
  for (const element of all) {
    const raw = getAttribute(element, "data-vibe-region");
    if (raw === undefined) continue;
    const id = raw.trim();
    if (!REGION_ID.test(id) || regionIds.has(id) || regions.length >= MAX_REGIONS) {
      removeAttribute(element, "data-vibe-region");
      removeAttribute(element, "data-vibe-refresh");
      warnings.push({
        code: "dynamic-region-invalid",
        message: `A dynamic region was removed because its ID was invalid, duplicated, or exceeded the ${MAX_REGIONS}-region limit.`,
      });
      continue;
    }
    setAttribute(element, "data-vibe-region", id);
    regionIds.add(id);
    const refreshSeconds = normalizeRefresh(getAttribute(element, "data-vibe-refresh"));
    if (refreshSeconds !== undefined) setAttribute(element, "data-vibe-refresh", String(refreshSeconds));
    else removeAttribute(element, "data-vibe-refresh");
    regions.push({ id, ...(refreshSeconds !== undefined ? { refreshSeconds } : {}) });
  }

  const actions: DynamicAction[] = [];
  for (const element of all) {
    const raw = getAttribute(element, "data-vibe-action");
    if (raw === undefined) continue;
    const rawAction = raw.trim();
    const match = ACTION.exec(rawAction);
    const namespace = match?.[1]?.toLowerCase();
    const name = match?.[2] ?? "";
    const canonicalName = namespace === "state"
      ? STATE_ACTIONS.get(name.toLowerCase())
      : name.toLowerCase();
    const action = match && namespace && canonicalName ? `${namespace}:${canonicalName}` : rawAction;
    const targets = uniqueTokens(getAttribute(element, "data-vibe-target"))
      .filter((target) => regionIds.has(target))
      .slice(0, MAX_REGIONS);
    const validState = namespace !== "state" || Boolean(canonicalName);
    const validModel = namespace !== "model" || targets.length > 0;
    if (!match || !validState || !validModel || actions.length >= MAX_ACTIONS) {
      removeAttribute(element, "data-vibe-action");
      removeAttribute(element, "data-vibe-target");
      warnings.push({
        code: "dynamic-action-invalid",
        message: `A dynamic action was removed because its namespace, state reducer, targets, or the ${MAX_ACTIONS}-action limit was invalid.`,
      });
      continue;
    }
    setAttribute(element, "data-vibe-action", action);
    if (targets.length > 0) setAttribute(element, "data-vibe-target", targets.join(" "));
    else removeAttribute(element, "data-vibe-target");
    actions.push({ action, execution: namespace as "state" | "model", targets });
  }

  const bindings: string[] = [];
  for (const element of all) {
    const raw = getAttribute(element, "data-vibe-bind");
    if (raw === undefined) continue;
    const binding = raw.trim();
    if (!BINDING.test(binding) || bindings.length >= MAX_BINDINGS) {
      removeAttribute(element, "data-vibe-bind");
      warnings.push({
        code: "dynamic-binding-invalid",
        message: `A state binding was removed because its path was invalid or exceeded the ${MAX_BINDINGS}-binding limit.`,
      });
      continue;
    }
    setAttribute(element, "data-vibe-bind", binding);
    if (!bindings.includes(binding)) bindings.push(binding);
  }

  for (const element of all) {
    if (getAttribute(element, "data-vibe-refresh") !== undefined
        && getAttribute(element, "data-vibe-region") === undefined) removeAttribute(element, "data-vibe-refresh");
    if (getAttribute(element, "data-vibe-target") !== undefined
        && getAttribute(element, "data-vibe-action") === undefined) removeAttribute(element, "data-vibe-target");
  }

  if (regions.length === 0 && actions.length === 0 && bindings.length === 0 && !localTabs) return { warnings };
  return { manifest: { version: 1, regions, actions, bindings, localTabs }, warnings };
}

function normalizeRefresh(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.max(60, Math.min(3_600, Math.round(parsed)));
}

function uniqueTokens(raw: string | undefined): string[] {
  return [...new Set((raw ?? "").split(/\s+/).map((token) => token.trim()).filter((token) => REGION_ID.test(token)))];
}

function stripDynamicAttributes(element: ElementNode): void {
  for (const attribute of DYNAMIC_ATTRIBUTES) removeAttribute(element, attribute);
}
