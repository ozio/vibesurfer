import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteWorld } from "../types/browser";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../lib/platform", () => ({ isTauri: mocks.isTauri }));

import {
  deletePersistedProfileSiteWorlds,
  deletePersistedSiteWorld,
  fromSiteWorldRecord,
  getPersistedArtifact,
  getPersistedSiteWorld,
  listPersistedArtifacts,
  listPersistedSiteWorlds,
  savePersistedSiteWorld,
  toSiteWorldRecord,
} from "./host-api";

describe("artifact host persistence", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.isTauri.mockReturnValue(true);
  });

  it("scopes list and exact reads to the requested profile", async () => {
    const personal = artifactRecord();
    mocks.invoke
      .mockResolvedValueOnce([personal, { ...personal, id: "artifact-work", profileId: "work" }])
      .mockResolvedValueOnce(personal)
      .mockResolvedValueOnce({ ...personal, profileId: "work" });

    await expect(listPersistedArtifacts("personal", 24)).resolves.toMatchObject([{ id: personal.id }]);
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "list_artifacts", {
      profileId: "personal",
      limit: 24,
    });
    await expect(getPersistedArtifact("personal", personal.id)).resolves.toMatchObject({ id: personal.id });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "get_artifact", {
      id: personal.id,
      profileId: "personal",
    });
    await expect(getPersistedArtifact("personal", personal.id)).resolves.toBeUndefined();
  });

  it("keeps browser preview artifact reads local", async () => {
    mocks.isTauri.mockReturnValue(false);
    await expect(listPersistedArtifacts("personal")).resolves.toEqual([]);
    await expect(getPersistedArtifact("personal", "artifact-one")).resolves.toBeUndefined();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

describe("SiteWorld host persistence", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.isTauri.mockReturnValue(true);
  });

  it("round-trips the browser model while keeping record scope authoritative", () => {
    const world = siteWorld();
    const record = toSiteWorldRecord("personal", world);
    expect(record).toMatchObject({
      id: world.id,
      profileId: "personal",
      origin: world.origin,
      revision: world.revision,
      updatedAt: world.updatedAt,
    });

    const decoded = fromSiteWorldRecord({
      ...record,
      payload: {
        ...record.payload,
        id: "payload-cannot-change-id",
        origin: "https://payload.invalid",
        revision: 999,
        informationArchitecture: [
          ...world.informationArchitecture,
          { path: 42, label: "invalid" },
        ],
        establishedFacts: ["Fact one", 42, "Fact two"],
      },
    });

    expect(decoded).toEqual({
      ...world,
      establishedFacts: ["Fact one", "Fact two"],
    });
    expect(fromSiteWorldRecord({ ...record, origin: "file:///tmp/site" })).toBeUndefined();
    expect(fromSiteWorldRecord({ ...record, revision: -1 })).toBeUndefined();
  });

  it("uses profile-scoped CRUD commands", async () => {
    const world = siteWorld();
    const record = toSiteWorldRecord("personal", world);
    mocks.invoke
      .mockResolvedValueOnce([record])
      .mockResolvedValueOnce(record)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);

    await expect(listPersistedSiteWorlds("personal")).resolves.toEqual([world]);
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "list_site_worlds", {
      profileId: "personal",
      limit: 500,
    });
    await expect(getPersistedSiteWorld("personal", world.id)).resolves.toEqual(world);
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "get_site_world", {
      id: world.id,
      profileId: "personal",
    });
    await expect(savePersistedSiteWorld("personal", world)).resolves.toBe(true);
    expect(mocks.invoke).toHaveBeenNthCalledWith(3, "upsert_site_world", { siteWorld: record });
    await expect(deletePersistedSiteWorld("personal", world.id)).resolves.toBe(1);
    expect(mocks.invoke).toHaveBeenNthCalledWith(4, "delete_site_world", {
      id: world.id,
      profileId: "personal",
    });
    await expect(deletePersistedProfileSiteWorlds("personal")).resolves.toBe(2);
    expect(mocks.invoke).toHaveBeenNthCalledWith(5, "delete_profile_site_worlds", {
      profileId: "personal",
    });
  });

  it("keeps browser preview mode read-only", async () => {
    mocks.isTauri.mockReturnValue(false);
    await expect(listPersistedSiteWorlds("personal")).resolves.toEqual([]);
    await expect(getPersistedSiteWorld("personal", "site-example")).resolves.toBeUndefined();
    await expect(savePersistedSiteWorld("personal", siteWorld())).resolves.toBe(false);
    await expect(deletePersistedSiteWorld("personal", "site-example")).resolves.toBe(0);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

function siteWorld(): SiteWorld {
  return {
    id: "site-example",
    origin: "https://example.com",
    name: "Example",
    purpose: "A coherent test site",
    audience: "Readers",
    visualLanguage: {
      palette: ["#111111", "#ffffff"],
      typography: "sans",
      layout: "grid",
      tone: "calm",
    },
    informationArchitecture: [{ path: "/news", label: "News", purpose: "Updates" }],
    establishedFacts: ["Fact one", "Fact two"],
    visitedPageSummaries: [{
      artifactId: "artifact-one",
      url: "https://example.com/",
      title: "Example home",
      purpose: "Homepage",
      factsIntroduced: ["Fact one"],
      outboundRoutes: ["/news"],
    }],
    revision: 3,
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:03.000Z",
  };
}

function artifactRecord() {
  return {
    id: "artifact-one",
    profileId: "personal",
    siteId: "site-example",
    url: "https://example.com/",
    title: "Example",
    html: "<!doctype html><title>Example</title>",
    createdAt: "2026-08-12T00:00:00.000Z",
    payload: {
      generationId: "job-one",
      modelId: "openai:gpt-5",
      mode: "quick",
      summary: "Example page",
    },
  };
}
