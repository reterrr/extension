import "dotenv/config";

import Database from "better-sqlite3";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBurExcelWorkbook } from "./db/bur-excel-export.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOST =
  process.env.BURBOT_EXPORT_HOST || process.env.BURBOT_DB_HOST || "127.0.0.1";
const PORT = Number(process.env.BURBOT_EXPORT_PORT || "8766");
const DATABASE_PATH = resolve(
  ROOT,
  process.env.BURBOT_DB_PATH || "./data/burbot.sqlite",
);
const GEOGRAPHY_SOURCE_PATH = resolve(ROOT, "src/shared/types/geography.ts");

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("BURBOT_EXPORT_PORT must be a valid TCP port.");
}
if (!existsSync(DATABASE_PATH)) {
  throw new Error(`SQLite database does not exist yet: ${DATABASE_PATH}`);
}

const db = new Database(DATABASE_PATH, {
  readonly: true,
  fileMustExist: true,
});
db.pragma("query_only = ON");

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && !origin.startsWith("moz-extension://")) {
    res.writeHead(403, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(
      JSON.stringify({
        error: "Only the Burbot extension may access this service.",
      }),
    );
    return false;
  }

  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Vary", "Origin");
  return true;
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(value));
}

function exportFilename() {
  return `burbot-${new Date().toISOString().slice(0, 10)}.xlsx`;
}

const server = createServer((req, res) => {
  try {
    if (!setCors(req, res)) return;
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const pathname = new URL(
      req.url || "/",
      `http://${HOST}:${PORT}`,
    ).pathname;

    if (req.method === "GET" && pathname === "/health") {
      sendJson(res, 200, { ok: true, engine: "sqlite-excel-export" });
      return;
    }

    if (req.method === "GET" && pathname === "/export.xlsx") {
      const workbook = buildBurExcelWorkbook(db, GEOGRAPHY_SOURCE_PATH);
      res.writeHead(200, {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${exportFilename()}"`,
        "Content-Length": workbook.length,
        "Cache-Control": "no-store",
      });
      res.end(workbook);
      return;
    }

    sendJson(res, 404, { error: "Not found." });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Burbot Excel export service: http://${HOST}:${PORT}`);
});
