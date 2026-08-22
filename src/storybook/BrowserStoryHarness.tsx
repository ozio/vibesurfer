import { useLayoutEffect, useState, type ReactNode } from "react";
import type { Decorator } from "@storybook/react-vite";
import { createJSONStorage, type StateStorage } from "zustand/middleware";
import { useBrowserStore, type BrowserState } from "../store/browser-store";
import type { BrowserPreferences } from "../types/browser";
import {
  readBrowserStoryGlobals,
  type BrowserStoryGlobals,
} from "./BrowserStoryEnvironment";

type BrowserStateDataKey = {
  [Key in keyof BrowserState]: BrowserState[Key] extends Function ? never : Key;
}[keyof BrowserState];

export type BrowserStoryFixture = Omit<
  Partial<Pick<BrowserState, BrowserStateDataKey>>,
  "preferences"
> & {
  preferences?: Partial<BrowserPreferences>;
};

const storageValues = new Map<string, string>();
const storyStorage: StateStorage = {
  getItem: (key) => storageValues.get(key) ?? null,
  setItem: (key, value) => {
    storageValues.set(key, value);
  },
  removeItem: (key) => {
    storageValues.delete(key);
  },
};

type BrowserPersistStorage = NonNullable<
  ReturnType<typeof useBrowserStore.persist.getOptions>["storage"]
>;
const memoryPersistStorage = createJSONStorage(() => storyStorage) as BrowserPersistStorage;

useBrowserStore.persist.setOptions({ storage: memoryPersistStorage });
useBrowserStore.persist.clearStorage();

export const withBrowserStoryState: Decorator = (Story, context) => {
  const globals = readBrowserStoryGlobals(context.globals);
  const fixture = (context.parameters.browserFixture ?? {}) as BrowserStoryFixture;
  const signature = JSON.stringify({ id: context.id, globals, fixture });

  return (
    <BrowserStoryHarness key={signature} globals={globals} fixture={fixture}>
      <Story />
    </BrowserStoryHarness>
  );
};

export function BrowserStoryHarness({
  children,
  globals,
  fixture = {},
}: {
  children: ReactNode;
  globals: BrowserStoryGlobals;
  fixture?: BrowserStoryFixture;
}) {
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    useBrowserStore.setState(storyState(fixture, globals), true);
    setReady(true);

    return () => {
      useBrowserStore.setState(freshInitialState(), true);
      useBrowserStore.persist.clearStorage();
    };
  }, [fixture, globals]);

  return ready ? children : null;
}

function storyState(
  fixture: BrowserStoryFixture,
  globals: BrowserStoryGlobals,
): BrowserState {
  const initial = freshInitialState();
  const fixtureData = structuredClone(fixture);
  const state = {
    ...initial,
    ...fixtureData,
    preferences: {
      ...initial.preferences,
      ...fixtureData.preferences,
      theme: globals.theme,
      colorScheme: globals.scheme,
      density: globals.density,
      tabLayout: globals.tabs,
      animations: globals.motion === "full",
    },
  };

  return {
    ...state,
    profiles: state.profiles.map((profile) =>
      profile.id === state.activeProfileId
        ? { ...profile, chromeSkin: globals.theme }
        : profile,
    ),
  };
}

function freshInitialState(): BrowserState {
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(useBrowserStore.getInitialState())) {
    clone[key] = typeof value === "function" ? value : structuredClone(value);
  }
  return clone as unknown as BrowserState;
}
