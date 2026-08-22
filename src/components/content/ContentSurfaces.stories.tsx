import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import {
  ArchivedWorldDialog,
  ArtifactErrorState,
  ArtifactFrameShell,
  FrameConnectionState,
  GenerationFailureNotice,
  PageContextMenu,
  RemoteBlockedState,
  SourceViewerDialog,
  SurfaceShell,
} from "./ContentSurfaces";

const openExternal = fn();
const retry = fn();
const chooseModel = fn();
const dismiss = fn();
const goBack = fn();
const goForward = fn();
const reload = fn();
const viewSource = fn();
const openLink = fn();
const restore = fn();
const useCurrent = fn();
const cancel = fn();

const meta = {
  title: "Components/Content surfaces/Surface states",
  component: SurfaceShell,
  subcomponents: {
    RemoteBlockedState,
    ArtifactFrameShell,
    FrameConnectionState,
    GenerationFailureNotice,
    ArtifactErrorState,
    SourceViewerDialog,
    ArchivedWorldDialog,
    PageContextMenu,
  },
  decorators: [(Story) => <div style={{ width: "100vw", height: "100vh", minHeight: 480 }}><Story /></div>],
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: {
      story: { inline: false, height: "520px" },
      description: { component: "Pure content-surface states. The application controller owns iframe compilation, MessageChannel identity, streaming updates, dynamic actions and persistence; these components own only accessible presentation and callbacks." },
    },
  },
  args: { children: null },
} satisfies Meta<typeof SurfaceShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RemoteBlocked: Story = {
  render: () => <RemoteBlockedState hostname="example.com" onOpenExternal={openExternal} />,
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole("button", { name: "Open live site externally" });
    await userEvent.click(button);
    await expect(openExternal).toHaveBeenCalledOnce();
  },
};

export const FrameConnecting: Story = {
  render: () => <ArtifactFrameShell src="about:blank" title="Quiet generated page" connectionStatus="connecting" />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status", { name: "Connecting generated page" })).toBeInTheDocument();
    await expect(within(canvasElement).getByTitle("Quiet generated page")).toHaveAttribute("sandbox", "allow-scripts");
  },
};

export const FrameReady: Story = {
  render: () => <ArtifactFrameShell src="about:blank" title="Connected artifact" connectionStatus="ready" />,
  globals: { theme: "sedative" },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTitle("Connected artifact")).toHaveClass("artifact-frame--ready");
  },
};

export const FrameConnectionFailed: Story = {
  render: () => (
    <ArtifactFrameShell
      src="about:blank"
      title="Disconnected artifact"
      connectionStatus="failed"
      connectionMessage="The private channel did not acknowledge this document identity."
    />
  ),
  play: async ({ canvasElement }) => {
    const alert = within(canvasElement).getByRole("alert");
    await expect(alert).toHaveTextContent("Safe page bridge unavailable");
    await expect(within(canvasElement).getByTitle("Disconnected artifact")).toHaveClass("artifact-frame--failed");
  },
};

export const RecoverableFailure: Story = {
  render: () => (
    <SurfaceShell variant="generated">
      <div style={{ height: "100%", background: "linear-gradient(135deg, var(--surface-2), var(--surface-3))" }} />
      <GenerationFailureNotice message="The model connection closed before the final response." partial onRetry={retry} onChooseModel={chooseModel} />
    </SurfaceShell>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("alert")).toHaveTextContent("partial result is still shown");
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    await expect(retry).toHaveBeenCalledOnce();
  },
};

export const TerminalArtifactError: Story = {
  render: () => <ArtifactErrorState title="This page could not be generated" message="The selected model is temporarily rate limited." onRetry={retry} onChooseModel={chooseModel} />,
  globals: { theme: "cyberpunk", scheme: "dark" },
  play: async ({ canvasElement }) => {
    const alert = within(canvasElement).getByRole("alert");
    await userEvent.click(within(alert).getByRole("button", { name: "Choose another model" }));
    await expect(chooseModel).toHaveBeenCalledOnce();
  },
};

export const SourceViewer: Story = {
  render: () => <SourceViewerDialog open title="Stillroom Radio" source={'<!doctype html>\n<html lang="en">\n  <title>Stillroom Radio</title>\n</html>'} onOpenChange={fn()} />,
  play: async ({ canvasElement }) => {
    const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Source: Stillroom Radio" });
    await expect(within(dialog).getByText("Page HTML displayed as inert text.")).toBeInTheDocument();
    await expect(within(dialog).getByText(/<!doctype html>/)).toBeInTheDocument();
  },
};

export const ArchivedNavigation: Story = {
  render: () => <ArchivedWorldDialog open kind="navigation" onOpenChange={fn()} onCancel={cancel} onRestore={restore} onUseCurrent={useCurrent} />,
  play: async ({ canvasElement }) => {
    const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Continue from an archived site?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Use current identity" }));
    await expect(useCurrent).toHaveBeenCalledOnce();
  },
};

export const ArchivedDynamicAction: Story = {
  render: () => <ArchivedWorldDialog open kind="dynamic-action" onOpenChange={fn()} onCancel={cancel} onRestore={restore} />,
  globals: { theme: "ie-classic" },
};

export const LinkContextMenu: Story = {
  render: () => (
    <SurfaceShell>
      <PageContextMenu
        menu={{ left: 48, top: 48, href: "https://quiet.vibe/rooms/rain", linkText: "Rain room" }}
        canGoBack
        canGoForward={false}
        onDismiss={dismiss}
        onBack={goBack}
        onForward={goForward}
        onReload={reload}
        onViewSource={viewSource}
        onOpenLink={openLink}
      />
    </SurfaceShell>
  ),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const menu = await body.findByRole("menu", { name: "Link actions" });
    await expect(within(menu).getByRole("menuitem", { name: "Forward" })).toBeDisabled();
    within(menu).getByRole("menuitem", { name: "Open link in new tab" }).focus();
    await userEvent.keyboard("{End}");
    await expect(within(menu).getByRole("menuitem", { name: "View source" })).toHaveFocus();
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Open link in new tab" }));
    await expect(openLink).toHaveBeenCalledOnce();
  },
};
