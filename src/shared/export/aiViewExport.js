// Compatibility aliases for existing View callers. Both JSON export actions
// emit the portable v1 document accepted by Import.
export {
  createPortableExport as createAiViewExport,
  portableExportFilename as aiViewExportFilename,
} from "./portableExport.js";
