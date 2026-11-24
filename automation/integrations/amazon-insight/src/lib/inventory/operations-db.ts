import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { operationsDbPath } from "@/lib/inventory/paths";

type CachedConnection = {
  dbPath: string;
  database: DatabaseSync;
  initializedSchemas: Set<string>;
};

let cachedConnection: CachedConnection | null = null;

function isTestEnvironment() {
  return Boolean(process.env.VITEST || process.env.NODE_ENV === "test");
}

function configureDatabase(database: DatabaseSync) {
  database.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
}

export function resetOperationsDbCache() {
  if (!cachedConnection) return;
  try {
    cachedConnection.database.close();
  } catch {
    // ignore close errors during reset
  } finally {
    cachedConnection = null;
  }
}

export function withOperationsDb<T>(
  schemaKey: string,
  schemaDdl: string,
  callback: (database: DatabaseSync) => T,
): T {
  const dbPath = operationsDbPath();
  mkdirSync(path.dirname(dbPath), { recursive: true });

  // Vitest runs clean up temp dirs in afterEach; keeping a handle open across
  // calls on Windows triggers EBUSY when rmSync removes the temp folder.
  if (isTestEnvironment()) {
    resetOperationsDbCache();
    const database = new DatabaseSync(dbPath);
    try {
      configureDatabase(database);
      if (schemaDdl.trim()) database.exec(schemaDdl);
      return callback(database);
    } finally {
      database.close();
    }
  }

  if (cachedConnection && cachedConnection.dbPath !== dbPath) {
    resetOperationsDbCache();
  }

  if (!cachedConnection) {
    const database = new DatabaseSync(dbPath);
    configureDatabase(database);
    cachedConnection = {
      dbPath,
      database,
      initializedSchemas: new Set(),
    };
  }

  if (schemaDdl.trim() && !cachedConnection.initializedSchemas.has(schemaKey)) {
    cachedConnection.database.exec(schemaDdl);
    cachedConnection.initializedSchemas.add(schemaKey);
  }

  return callback(cachedConnection.database);
}

export function checkOperationsDbHealth(): boolean {
  try {
    return withOperationsDb("healthcheck", "", (database) => {
      const row = database.prepare("SELECT 1 AS ok").get() as { ok?: number } | undefined;
      return row?.ok === 1;
    });
  } catch {
    return false;
  }
}
