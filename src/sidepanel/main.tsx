import "../shared/domain/schema.js";
import "../shared/domain/geographyRuntime";
import "../shared/domain/core.js";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SidepanelErrorBoundary } from "./SidepanelErrorBoundary";
import "./importReviewWorkspaceGrouping";
import "./importReviewWorkspaceParityStyles";
import { initWorkspaceEvents } from "../shared/storage/workspaceEvents";

initWorkspaceEvents();

const root = document.getElementById("root");
if (!root) throw new Error("Missing sidepanel root element.");

createRoot(root).render(
  <StrictMode>
    <SidepanelErrorBoundary>
      <App />
    </SidepanelErrorBoundary>
  </StrictMode>,
);
