import { D1Database, D1PreparedStatement, D1Result, D1ExecResult } from "@cloudflare/workers-types";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

// A mock D1 implementation using better-sqlite3 for testing
export class MockD1Database implements D1Database {
  private db: Database.Database;

  constructor() {
    this.db = new Database(":memory:");
    // Load schema
    const schemaPath = path.resolve(__dirname, "../schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf-8");
    this.db.exec(schema);
  }

  prepare(query: string): D1PreparedStatement {
    return new MockD1PreparedStatement(this.db, query);
  }

  async dump(): Promise<ArrayBuffer> {
    throw new Error("Method not implemented.");
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    // Transaction
    const txn = this.db.transaction(() => {
      for (const stmt of statements) {
        // @ts-ignore
        results.push(stmt.executeSync()); // Hacky internal access
      }
    });
    txn();
    return Promise.resolve(results);
  }

  async exec(query: string): Promise<D1ExecResult> {
    this.db.exec(query);
    return Promise.resolve({ count: 1, duration: 0 });
  }
}

class MockD1PreparedStatement implements D1PreparedStatement {
  private db: Database.Database;
  private query: string;
  private params: any[] = [];

  constructor(db: Database.Database, query: string) {
    this.db = db;
    this.query = query;
  }

  bind(...values: any[]): D1PreparedStatement {
    this.params = values;
    return this;
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    const stmt = this.db.prepare(this.query);
    const result = stmt.get(...this.params);
    if (!result) return null;
    if (colName) return (result as any)[colName];
    return result as T;
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    const stmt = this.db.prepare(this.query);
    const info = stmt.run(...this.params);
    return {
      success: true,
      meta: {},
      results: [],
      lastRowId: info.lastInsertRowid ? Number(info.lastInsertRowid) : null,
      changes: info.changes,
    } as any;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const stmt = this.db.prepare(this.query);
    const results = stmt.all(...this.params);
    return {
      success: true,
      meta: {},
      results: results as T[],
    };
  }

  async raw<T = unknown>(): Promise<T[]> {
      const stmt = this.db.prepare(this.query);
      const results = stmt.raw().all(...this.params);
      return results as T[];
  }

  // Helper for batch
  executeSync() {
      const stmt = this.db.prepare(this.query);
      if (this.query.trim().toLowerCase().startsWith("select")) {
          const results = stmt.all(...this.params);
           return {
              success: true,
              meta: {},
              results: results,
            };
      } else {
        const info = stmt.run(...this.params);
         return {
          success: true,
          meta: {},
          results: [],
          lastRowId: info.lastInsertRowid ? Number(info.lastInsertRowid) : null,
          changes: info.changes,
        };
      }
  }
}

export function setupTestDb(): MockD1Database {
  return new MockD1Database();
}
