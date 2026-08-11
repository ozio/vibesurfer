import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { Favicon } from "../src/components/ui/Favicon";

describe("Favicon", () => {
  afterEach(cleanup);

  test("does not fetch a live-origin favicon", () => {
    const { container } = render(
      <Favicon source="https://example.test/favicon.ico" title="Example" />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("E");
  });

  test("renders a host-owned data image", () => {
    const { container } = render(
      <Favicon source="data:image/png;base64,AA==" title="Generated" generated />,
    );

    expect(container.querySelector("img")).toHaveAttribute("src", "data:image/png;base64,AA==");
  });

  test("renders a generated artifact glyph instead of the generic sparkle", () => {
    const { container } = render(
      <Favicon source="🧭" title="Generated compass" generated />,
    );

    expect(container).toHaveTextContent("🧭");
    expect(container.querySelector("svg")).toBeNull();
  });
});
