import "../shared/domain/schema.js";
import "../shared/domain/geographyRuntime";
import "../shared/domain/core.js";
import "./importReviewWorkspaceBridge";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./importReviewWorkspaceParityStyles";

const root = document.getElementById("root");
if (!root) throw new Error("Missing sidepanel root element.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
