import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { runMigrations } from './migrate';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'swt.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = initDatabase();
  }
  return db;
}

function initDatabase(): Database.Database {
  // Ensure the data directory exists
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const database = new Database(DB_PATH);

  // Enable WAL mode and foreign keys
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');

  // Read and execute the schema
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf-8');

  // Split by semicolons and execute each statement
  // Filter out PRAGMA statements since we already ran them above
  const statements = schemaSql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('PRAGMA'));

  for (const statement of statements) {
    database.exec(statement + ';');
  }

  // Run migrations for existing databases
  runMigrations(database);

  console.log('[DB] Database initialized successfully at', DB_PATH);
  return database;
}

export function closeDb(): void {
  if (db) {
    db.close();
    console.log('[DB] Database connection closed');
  }
}

export default getDb;
