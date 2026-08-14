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

  test("renders the persisted favicon colors and shape instead of the browser accent", () => {
    const { container } = render(
      <Favicon
        source={{ kind: "glyph", glyph: "R", foreground: "#ffe07a", background: "#0057a8", shape: "circle" }}
        title="Rambler"
        generated
      />,
    );

    const tile = container.querySelector(".favicon--letter");
    expect(tile).toHaveTextContent("R");
    expect(tile).toHaveClass("favicon--circle");
    expect(tile).toHaveStyle({ color: "#ffe07a", backgroundColor: "#0057a8" });
  });

  test("gives legacy glyphs stable origin-specific fallback colors", () => {
    const first = render(<Favicon source="R" title="Rambler" seed="https://rambler.ru" generated />);
    const firstColor = first.container.querySelector<HTMLElement>(".favicon--letter")?.style.backgroundColor;
    first.unmount();
    const second = render(<Favicon source="R" title="Radio" seed="https://radio.example" generated />);
    const secondColor = second.container.querySelector<HTMLElement>(".favicon--letter")?.style.backgroundColor;

    expect(firstColor).toBeTruthy();
    expect(secondColor).toBeTruthy();
    expect(firstColor).not.toBe(secondColor);
  });
});
