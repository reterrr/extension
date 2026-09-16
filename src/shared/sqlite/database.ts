import initSqlJs, { type Database, type QueryExecResult, type SqlValue } from "sql.js";
import { deleteSqliteBytes, readSqliteBytes, writeSqliteBytes } from "./blobStore";
import { SQLITE_SCHEMA_V1, SQLITE_SCHEMA_VERSION } from "./schema";

let databasePromise: Promise<Database> | null = null;

function firstValue(result: QueryExecResult[] | undefined): SqlValue | undefined {
  return result?.[0]?.values?.[0]?.[0];
}

async function openDatabase(): Promise<Database> {
  const SQL = await initSqlJs({
    locateFile: (file) => browser.runtime.getURL(file),
  });
  const bytes = await readSqliteBytes();
  const db = new SQL.Database(bytes ?? undefined);
  db.run("PRAGMA foreign_keys = ON");

  const rawVersion = firstValue(db.exec("PRAGMA user_version"));
  const version = typeof rawVersion === "number" ? rawVersion : Number(rawVersion ?? 0);
  if (version > SQLITE_SCHEMA_VERSION) {
    db.close();
    throw new Error(
      `SQLite database schema ${version} is newer than supported ${SQLITE_SCHEMA_VERSION}.`,
    );
  }
  if (version < 1) {
    db.exec(SQLITE_SCHEMA_V1);
    await writeSqliteBytes(db.export());
  }
  return db;
}

export function getDatabase(): Promise<Database> {
  databasePromise ??= openDatabase().catch((error) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise;
}

export async function persistDatabase(db: Database): Promise<void> {
  await writeSqliteBytes(db.export());
}

export async function resetDatabase(): Promise<void> {
  if (databasePromise) {
    try {
      (await databasePromise).close();
    } catch {
      // The database may have failed during initialization.
    }
  }
  databasePromise = null;
  await deleteSqliteBytes();
}

export async function sqliteDatabaseInfo(): Promise<{
  schemaVersion: number;
  bytes: number;
}> {
  const db = await getDatabase();
  const rawVersion = firstValue(db.exec("PRAGMA user_version"));
  return {
    schemaVersion: Number(rawVersion ?? 0),
    bytes: db.export().byteLength,
  };
}
