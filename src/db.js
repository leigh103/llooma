import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

const EMBED_DIM = 768; // nomic-embed-text dimension

let _db = null;

export function getDb() {
  if (_db) return _db;

  const dbPath = process.env.DB_PATH || './data/knowledge.db';
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });

  _db = new Database(dbPath);
  sqliteVec.load(_db);

  return _db;
}

export function setupDb() {
  const db = getDb();

  // Single vec0 table — embeddings + metadata stored together via auxiliary columns
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_vec USING vec0(
      embedding FLOAT[${EMBED_DIM}],
      +source TEXT,
      +chunk  TEXT,
      +ingested_at TEXT
    )
  `);

}
