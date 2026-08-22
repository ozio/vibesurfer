export type UiThemeTokenCategory = "Typography" | "Surface" | "Text" | "Border" | "Accent" | "Status" | "Focus" | "Shadow" | "Radius" | "Sizing" | "Motion";

export interface UiThemeTokenDefinition {
  name: `--${string}`;
  category: UiThemeTokenCategory;
  purpose: string;
}

export const UI_THEME_TOKENS = [
  { name: "--font-ui", category: "Typography", purpose: "Controls, labels, and browser chrome" },
  { name: "--font-display", category: "Typography", purpose: "Prominent titles and themed display copy" },
  { name: "--font-mono", category: "Typography", purpose: "Code, JSON, URLs, and technical values" },
  { name: "--app-bg", category: "Surface", purpose: "Application and story canvas" },
  { name: "--chrome-bg", category: "Surface", purpose: "Browser chrome and fixed navigation" },
  { name: "--chrome-raised", category: "Surface", purpose: "Raised chrome controls" },
  { name: "--surface", category: "Surface", purpose: "Default cards, fields, and controls" },
  { name: "--surface-2", category: "Surface", purpose: "Inset or secondary surfaces" },
  { name: "--surface-3", category: "Surface", purpose: "Tracks and tertiary surfaces" },
  { name: "--surface-hover", category: "Surface", purpose: "Hover state" },
  { name: "--surface-active", category: "Surface", purpose: "Pressed and selected state" },
  { name: "--overlay", category: "Surface", purpose: "Menus, popovers, tooltips, and dialogs" },
  { name: "--text", category: "Text", purpose: "Default foreground" },
  { name: "--text-strong", category: "Text", purpose: "Headings and high-emphasis foreground" },
  { name: "--muted", category: "Text", purpose: "Descriptions and secondary labels" },
  { name: "--subtle", category: "Text", purpose: "Placeholders and low-emphasis metadata" },
  { name: "--border", category: "Border", purpose: "Default separators and control borders" },
  { name: "--border-strong", category: "Border", purpose: "Emphasized and floating-surface borders" },
  { name: "--accent", category: "Accent", purpose: "Primary actions and selection" },
  { name: "--accent-hover", category: "Accent", purpose: "Primary action hover" },
  { name: "--accent-soft", category: "Accent", purpose: "Tinted accent background" },
  { name: "--accent-contrast", category: "Accent", purpose: "Foreground placed on the accent" },
  { name: "--action-primary", category: "Accent", purpose: "Accessible primary action background" },
  { name: "--action-primary-hover", category: "Accent", purpose: "Accessible primary action hover background" },
  { name: "--action-primary-contrast", category: "Accent", purpose: "Foreground placed on primary actions" },
  { name: "--danger", category: "Status", purpose: "Destructive actions and errors" },
  { name: "--danger-contrast", category: "Status", purpose: "Foreground placed on destructive actions" },
  { name: "--success", category: "Status", purpose: "Success and healthy state" },
  { name: "--warning", category: "Status", purpose: "Warnings and pending state" },
  { name: "--focus-ring", category: "Focus", purpose: "Keyboard focus outline" },
  { name: "--shadow-sm", category: "Shadow", purpose: "Raised controls and low elevation" },
  { name: "--shadow-md", category: "Shadow", purpose: "Menus and popovers" },
  { name: "--shadow-lg", category: "Shadow", purpose: "Dialogs and high elevation" },
  { name: "--radius-xs", category: "Radius", purpose: "Compact items and tooltip corners" },
  { name: "--radius-sm", category: "Radius", purpose: "Controls and menu items" },
  { name: "--radius-md", category: "Radius", purpose: "Cards, fields, and popovers" },
  { name: "--radius-lg", category: "Radius", purpose: "Dialogs and large surfaces" },
  { name: "--radius-xl", category: "Radius", purpose: "Feature surfaces" },
  { name: "--control-height", category: "Sizing", purpose: "Standard browser control height" },
  { name: "--icon-button-size", category: "Sizing", purpose: "Standard icon-only action size" },
  { name: "--motion-fast", category: "Motion", purpose: "Hover and press transitions" },
  { name: "--motion-medium", category: "Motion", purpose: "Overlay and disclosure transitions" },
  { name: "--ease", category: "Motion", purpose: "Shared transition curve" },
] as const satisfies readonly UiThemeTokenDefinition[];
