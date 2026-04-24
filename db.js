/**
 * Database module.
 *
 * Uses the built-in node:sqlite (Node.js >= 22.5.0) — synchronous API,
 * zero external dependencies, no native compilation required.
 *
 * Money is stored as INTEGER (paise) to avoid floating-point representation
 * errors that occur when using REAL for currency values.
 * e.g. ₹100.50 → stored as 10050, returned as 10050, formatted by the client.
 *
 * idempotency_key has a UNIQUE constraint so the database itself enforces
 * exactly-once semantics for expense creation, regardless of how the insert
 * is attempted.
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'expenses.db');

function createDb(dbPath = DB_PATH) {
  const db = new DatabaseSync(dbPath);

  // Enable WAL mode for better concurrent read performance and crash safety.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS expenses (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      idempotency_key TEXT    NOT NULL UNIQUE,
      amount          INTEGER NOT NULL CHECK (amount > 0),
      category        TEXT    NOT NULL,
      description     TEXT    NOT NULL,
      date            TEXT    NOT NULL,
      created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);

  return db;
}

// Singleton for the main application; tests create their own instances.
let _db;
function getDb() {
  if (!_db) {
    _db = createDb();
  }
  return _db;
}

module.exports = { createDb, getDb };
