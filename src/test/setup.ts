import "@testing-library/jest-dom/vitest";

// Node 26 exposes an experimental, unconfigured localStorage getter. Make the
// jsdom origin-backed implementation unambiguous before application modules load.
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: window.localStorage,
});
