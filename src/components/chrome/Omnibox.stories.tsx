import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, fn, userEvent, waitFor, within } from "storybook/test";
import { BROWSER_EXPERIENCE_REGISTRY } from "../../browser/browser-experience-registry";
import { useBrowserStore } from "../../store/browser-store";
import { TAB_STRIP_FIXTURE } from "../../storybook/browser-story-fixtures";
import { withBrowserStoryState } from "../../storybook/BrowserStoryHarness";
import { Favicon } from "../ui/Favicon";
import { Omnibox, ConnectedOmnibox, type OmniboxProps } from "./Omnibox";
import { SiteInfoPopover } from "./SiteInfoPopover";
import { STANDARD_NAVIGATION_RECIPE } from "./navigation-recipes";
import {
  buildOmniboxSuggestions,
  siteInformationForTab,
} from "./omnibox-model";

const fixtureTabs = TAB_STRIP_FIXTURE.tabs ?? [];
const fixtureTab = fixtureTabs[1] ?? fixtureTabs[0]!;
const nativeAddressLanguage = BROWSER_EXPERIENCE_REGISTRY.native.chrome.address;

function suggestionsFor(value: string) {
  return buildOmniboxSuggestions({
    value,
    currentTabId: fixtureTabs[0]?.id ?? fixtureTab.id,
    tabs: fixtureTabs,
    language: nativeAddressLanguage,
  });
}

function OmniboxDemo(args: OmniboxProps) {
  const [value, setValue] = useState(args.value);
  const [open, setOpen] = useState(args.open);
  const [requestedActiveId, setRequestedActiveId] = useState(args.activeSuggestionId);
  const activeSuggestionId = args.suggestions.some((suggestion) => suggestion.id === requestedActiveId)
    ? requestedActiveId
    : args.suggestions[0]?.id;

  return (
    <Omnibox
      {...args}
      value={value}
      open={open}
      activeSuggestionId={activeSuggestionId}
      onValueChange={(nextValue) => {
        setValue(nextValue);
        args.onValueChange(nextValue);
      }}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        args.onOpenChange(nextOpen);
      }}
      onActiveSuggestionChange={(suggestionId) => {
        setRequestedActiveId(suggestionId);
        args.onActiveSuggestionChange(suggestionId);
      }}
    />
  );
}

const meta = {
  title: "Components/Chrome/Omnibox",
  component: Omnibox,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: {
      description: {
        component: "A fully controlled ARIA combobox for browser address and search input. It owns only focus, selection, IME-safe keyboard behavior and DOM semantics; value, popup state, active suggestion, actions and recipe presentation are controlled by the host.",
      },
    },
  },
  args: {
    recipe: STANDARD_NAVIGATION_RECIPE.omnibox,
    value: "https://quiet.vibe/ideas",
    committedValue: "https://quiet.vibe/ideas",
    suggestions: suggestionsFor("https://quiet.vibe/ideas"),
    open: false,
    activeSuggestionId: "address",
    placeholder: nativeAddressLanguage.placeholder,
    openInNewTabShortcut: "⌥↵",
    siteInfo: (
      <SiteInfoPopover
        information={siteInformationForTab(fixtureTab)}
        trigger={(
          <button className="omnibox__site-info" type="button" aria-label="Site information">
            <Favicon
              source={fixtureTab.favicon}
              title={fixtureTab.title}
              generated
              seed={fixtureTab.location}
            />
          </button>
        )}
      />
    ),
    onValueChange: fn(),
    onOpenChange: fn(),
    onActiveSuggestionChange: fn(),
    onSubmit: fn(),
    onSuggestionSelect: fn(),
    onEscape: fn(),
  },
  render: (args) => (
    <div className="story-surface story-surface--omnibox">
      <div className="story-omnibox-frame"><OmniboxDemo {...args} /></div>
    </div>
  ),
} satisfies Meta<typeof Omnibox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CommittedAddress: Story = {
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("combobox", { name: "Address and search" });
    await expect(input).toHaveAttribute("aria-expanded", "false");
    await expect(input).toHaveValue("https://quiet.vibe/ideas");
  },
};

export const QuerySuggestions: Story = {
  globals: { theme: "sedative" },
  args: {
    value: "three byte metacode",
    committedValue: "",
    suggestions: suggestionsFor("three byte metacode"),
    open: true,
    activeSuggestionId: "query",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox");
    const listbox = canvas.getByRole("listbox", { name: "Suggestions" });
    const activeOptionId = input.getAttribute("aria-activedescendant");
    await expect(input).toHaveAttribute("aria-controls", listbox.id);
    await expect(activeOptionId).toBeTruthy();
    await expect(canvasElement.ownerDocument.getElementById(activeOptionId!)).toHaveAttribute("aria-selected", "true");
    await expect(canvas.getByRole("option", { name: /Search the Hallunet for “three byte metacode”/ })).toHaveAttribute("data-suggestion-kind", "query");
  },
};

export const AddressSuggestions: Story = {
  globals: { theme: "cyberpunk", scheme: "dark" },
  args: {
    value: "quiet.vibe/ideas",
    committedValue: "",
    suggestions: suggestionsFor("quiet.vibe/ideas"),
    open: true,
    activeSuggestionId: "address",
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("option", { name: /Open quiet\.vibe\/ideas/ }))
      .toHaveAttribute("data-suggestion-kind", "address");
  },
};

export const TabSuggestions: Story = {
  args: {
    value: "quiet",
    committedValue: "",
    suggestions: suggestionsFor("quiet"),
    open: true,
    activeSuggestionId: "tab:tab-generated",
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("option", { name: /Quiet interface Switch to tab/ }))
      .toHaveAttribute("data-suggestion-kind", "tab");
  },
};

export const SettingsSuggestions: Story = {
  args: {
    value: "settings",
    committedValue: "",
    suggestions: suggestionsFor("settings"),
    open: true,
    activeSuggestionId: "settings:profiles",
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("option", { name: /Profiles & appearance/ }))
      .toHaveAttribute("data-suggestion-kind", "settings");
  },
};

export const KeyboardSelection: Story = {
  args: {
    value: "quiet",
    committedValue: "",
    suggestions: suggestionsFor("quiet"),
    open: true,
    activeSuggestionId: "query",
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("combobox");
    input.focus();
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(canvas.getByRole("option", { name: /Quiet interface Switch to tab/ })).toHaveAttribute("aria-selected", "true"));
    await userEvent.keyboard("{Enter}");
    await expect(args.onSuggestionSelect).toHaveBeenCalledWith(expect.objectContaining({
      disposition: "current-tab",
      suggestion: expect.objectContaining({ id: "tab:tab-generated" }),
    }));
  },
};

export const EscapeRestoresCommittedValue: Story = {
  args: {
    value: "unfinished edit",
    committedValue: "https://quiet.vibe/ideas",
    suggestions: suggestionsFor("unfinished edit"),
    open: true,
    activeSuggestionId: "query",
  },
  play: async ({ args, canvasElement }) => {
    const input = within(canvasElement).getByRole("combobox");
    input.focus();
    await userEvent.keyboard("{Escape}");
    await expect(input).toHaveValue("https://quiet.vibe/ideas");
    await expect(input).toHaveAttribute("aria-expanded", "false");
    await expect(input).not.toHaveFocus();
    await expect(args.onEscape).toHaveBeenCalledOnce();
  },
};

export const AltEnterOpensNewTab: Story = {
  args: {
    value: "quiet.vibe/ideas",
    committedValue: "",
    suggestions: suggestionsFor("quiet.vibe/ideas"),
    open: true,
    activeSuggestionId: "address",
  },
  play: async ({ args, canvasElement }) => {
    const input = within(canvasElement).getByRole("combobox");
    input.focus();
    await userEvent.keyboard("{Alt>}{Enter}{/Alt}");
    await expect(args.onSuggestionSelect).toHaveBeenCalledWith(expect.objectContaining({
      disposition: "new-tab",
      suggestion: expect.objectContaining({ id: "address" }),
    }));
  },
};

export const ImeCompositionDoesNotSubmit: Story = {
  args: {
    value: "静かな場所",
    committedValue: "",
    suggestions: suggestionsFor("静かな場所"),
    open: true,
    activeSuggestionId: "query",
  },
  play: async ({ args, canvasElement }) => {
    const input = within(canvasElement).getByRole("combobox");
    input.focus();
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 229, isComposing: true });
    await expect(args.onSuggestionSelect).not.toHaveBeenCalled();
    await expect(args.onSubmit).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    await expect(args.onSuggestionSelect).toHaveBeenCalledOnce();
  },
};

export const FocusSelectsCommittedValue: Story = {
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("combobox") as HTMLInputElement;
    await userEvent.click(input);
    await waitFor(() => expect(input.selectionStart).toBe(0));
    await expect(input.selectionEnd).toBe(input.value.length);
  },
};

export const SiteInformation: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Site information" }));
    const body = within(canvasElement.ownerDocument.body);
    const dialog = await body.findByRole("dialog", { name: "Hallunet address" });
    await expect(dialog).toHaveTextContent("Discovered route · isolated locally");
    await expect(dialog).toHaveTextContent("https://quiet.vibe/ideas");
  },
};

export const UniqueIdsPerInstance: Story = {
  args: {
    value: "quiet",
    committedValue: "",
    suggestions: suggestionsFor("quiet"),
    open: true,
    activeSuggestionId: "query",
  },
  render: (args) => (
    <div className="story-surface story-surface--omnibox">
      <div className="story-omnibox-pair"><OmniboxDemo {...args} /><OmniboxDemo {...args} /></div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const inputs = within(canvasElement).getAllByRole("combobox");
    const controls = inputs.map((input) => input.getAttribute("aria-controls"));
    const activeDescendants = inputs.map((input) => input.getAttribute("aria-activedescendant"));
    await expect(new Set(controls).size).toBe(2);
    await expect(new Set(activeDescendants).size).toBe(2);
    for (const id of [...controls, ...activeDescendants]) {
      await expect(id).toBeTruthy();
      await expect(canvasElement.ownerDocument.getElementById(id!)).toBeInTheDocument();
    }
  },
};

export const ConnectedStoreAdapter: Story = {
  decorators: [withBrowserStoryState],
  parameters: { browserFixture: TAB_STRIP_FIXTURE },
  render: () => <div className="story-surface story-surface--omnibox"><div className="story-omnibox-frame"><ConnectedOmniboxStory /></div></div>,
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole("combobox") as HTMLInputElement;
    window.dispatchEvent(new Event("vibesurfer:focus-address"));
    await waitFor(() => expect(input).toHaveFocus());
    await expect(input.selectionStart).toBe(0);
    await expect(input.selectionEnd).toBe(input.value.length);
    await userEvent.type(input, "quiet");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect(useBrowserStore.getState().activeTabId).toBe("tab-generated");
  },
};

function ConnectedOmniboxStory() {
  const tab = useBrowserStore((state) => (
    state.tabs.find((candidate) => candidate.id === state.activeTabId) ?? state.tabs[0]!
  ));
  return <ConnectedOmnibox tab={tab} recipe={STANDARD_NAVIGATION_RECIPE.omnibox} />;
}
