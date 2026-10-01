import "../shared/domain/geographyRuntime";
import { useEffect } from "react";
import "./importReviewStyles";
import "./importReviewWorkspaceParityStyles";
import "./importUi";
import { initImportReviewGrouping } from "./importReviewWorkspaceGrouping";
import { ImportReviewPanel } from "./ImportReviewPanel";

export default function ImportApp() {
  useEffect(initImportReviewGrouping, []);
  return <ImportReviewPanel />;
}
