import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, fn, userEvent, within } from "storybook/test";
import { FormField as UiFormField } from "./FormField";
import { NumberField as UiNumberField, RangeField as UiRangeField, SearchField as UiSearchField, Select as UiSelect, TextArea as UiTextArea } from "./Fields";

const searchChange = fn();
const numberChange = fn();
const rangeChange = fn();

const options = [
  { value: "local", label: "Local model" },
  { value: "openai", label: "OpenAI" },
  { value: "offline", label: "Unavailable provider", disabled: true },
] as const;

const meta = {
  title: "Components/UI/Fields",
  component: UiFormField,
  subcomponents: { SearchField: UiSearchField, Select: UiSelect, TextArea: UiTextArea, NumberField: UiNumberField, RangeField: UiRangeField },
  decorators: [(Story) => <div className="story-surface story-surface--column"><div className="story-form-frame"><Story /></div></div>],
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    docs: { description: { component: "Field primitives own label, description, required, invalid, and described-by wiring. Native controls preserve platform input behavior and remain easy to theme." } },
  },
  args: { label: "Profile name", children: (props) => <input {...props} /> },
} satisfies Meta<typeof UiFormField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FormField: Story = {
  render: () => (
    <div className="story-stack">
      <UiFormField label="Profile name" description="Shown only inside Vibesurfer." required>
        {(props) => <input className="story-native-input" defaultValue="Research" {...props} />}
      </UiFormField>
      <UiFormField label="Provider key" error="The key could not be verified.">
        {(props) => <input className="story-native-input" defaultValue="invalid-key" {...props} />}
      </UiFormField>
      <UiFormField label="Disabled field" description="Unavailable while the runtime starts.">
        {(props) => <input className="story-native-input" value="Waiting" disabled readOnly {...props} />}
      </UiFormField>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const field = within(canvasElement).getByRole("textbox", { name: /Provider key/ });
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field).toHaveAccessibleDescription("The key could not be verified.");
  },
};

export const SearchField: Story = {
  render: () => (
    <div className="story-stack">
      <UiSearchField label="Search settings" placeholder="Search settings" onValueChange={searchChange} />
      <UiSearchField label="Search history" defaultValue="generated" description="Matches titles and addresses." />
      <UiSearchField label="Search disabled" value="Unavailable" disabled />
      <UiSearchField label="Search with error" error="Search index is offline." />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole("searchbox", { name: "Search settings" });
    await userEvent.type(input, "local");
    await expect(searchChange).toHaveBeenLastCalledWith("local");
    await userEvent.click(canvas.getAllByRole("button", { name: "Clear search" })[0]!);
    await expect(input).toHaveValue("");
  },
};

export const Select: Story = {
  render: () => (
    <div className="story-stack">
      <UiSelect label="Generation provider" options={options} defaultValue="local" description="Used for new pages." />
      <UiSelect label="Required provider" options={options} placeholder="Choose a provider" defaultValue="" required />
      <UiSelect label="Invalid provider" options={options} defaultValue="openai" error="Reconnect this provider." />
      <UiSelect label="Disabled provider" options={options} defaultValue="local" disabled />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const select = within(canvasElement).getByRole("combobox", { name: "Generation provider" });
    await userEvent.selectOptions(select, "openai");
    await expect(select).toHaveValue("openai");
  },
};

export const TextArea: Story = {
  render: () => (
    <div className="story-stack">
      <UiTextArea label="Theme instructions" placeholder="Describe the intended browser atmosphere" maxLength={80} showCount />
      <UiTextArea label="Saved instructions" defaultValue="Quiet surfaces and restrained motion." description="Passed to new generated sites." showCount />
      <UiTextArea label="Invalid instructions" defaultValue="Too broad" error="Add at least one concrete visual rule." />
      <UiTextArea label="Disabled instructions" value="Managed by policy" disabled readOnly />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const textarea = canvas.getByRole("textbox", { name: "Theme instructions" });
    await userEvent.type(textarea, "Calm");
    await expect(canvas.getByText("4 / 80")).toBeInTheDocument();
  },
};

export const NumberField: Story = {
  render: () => (
    <div className="story-stack">
      <UiNumberField label="Parallel jobs" defaultValue={2} min={1} max={6} onValueChange={numberChange} description="Applies to local generation." />
      <UiNumberField label="Retry count" defaultValue={0} min={0} max={5} />
      <UiNumberField label="Invalid limit" value={10} min={1} max={6} error="Choose a value from 1 to 6." readOnly />
      <UiNumberField label="Disabled limit" value={1} disabled />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getAllByRole("button", { name: "Increase value" })[0]!);
    await expect(canvas.getByRole("spinbutton", { name: "Parallel jobs" })).toHaveValue(3);
    await expect(numberChange).toHaveBeenLastCalledWith(3);
  },
};

export const Range: Story = {
  name: "Range",
  render: () => (
    <div className="story-stack">
      <UiRangeField label="Sidebar width" defaultValue={280} min={200} max={360} step={10} formatValue={(value) => `${value}px`} onValueChange={rangeChange} />
      <UiRangeField label="Animation intensity" defaultValue={0} min={0} max={100} formatValue={(value) => `${value}%`} description="Zero keeps state changes immediate." />
      <UiRangeField label="Locked zoom" value={100} disabled formatValue={(value) => `${value}%`} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const slider = within(canvasElement).getByRole("slider", { name: "Sidebar width" });
    await fireEvent.change(slider, { target: { value: "290" } });
    await expect(slider).toHaveValue("290");
    await expect(rangeChange).toHaveBeenLastCalledWith(290);
  },
};
