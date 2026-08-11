import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { Tooltip } from "radix-ui";
import { BrowserApp } from "./app/BrowserApp";
import "./styles/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MemoryRouter>
      <Tooltip.Provider delayDuration={450} skipDelayDuration={150}>
        <BrowserApp />
      </Tooltip.Provider>
    </MemoryRouter>
  </StrictMode>,
);
