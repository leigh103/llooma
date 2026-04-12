import fs from 'fs/promises';
import path from 'path';
import { getDb } from '../db.js';
import { embed } from '../ollama.js';
import 'dotenv/config';

const CHUNK_SIZE = 500;   // words per chunk
const CHUNK_OVERLAP = 50; // words overlap between chunks

/**
 * Split text into overlapping chunks
 */
function chunkText(text, source) {
  const words = text.split(/\s+/);
  const chunks = [];

  for (let i = 0; i < words.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
    const chunk = words.slice(i, i + CHUNK_SIZE).join(' ');
    if (chunk.trim().length > 50) {
      chunks.push({
        source,
        chunk,
        chunkIndex: chunks.length,
      });
    }
    if (i + CHUNK_SIZE >= words.length) break;
  }

  return chunks;
}

/**
 * Recursively find all .md files in a directory
 */
async function findMarkdownFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findMarkdownFiles(fullPath));
    } else if (entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Ingest a single markdown file into the vector store
 */
export async function ingestFile(filePath) {
  const db = getDb();
  const text = await fs.readFile(filePath, 'utf-8');
  const source = path.relative(process.env.DOCS_PATH || './docs', filePath);
  const chunks = chunkText(text, source);

  // Remove existing chunks for this source file
  db.prepare(`DELETE FROM knowledge_vec WHERE source = ?`).run(source);
  db.prepare(`DELETE FROM knowledge_fts WHERE source = ?`).run(source);

  const insertVec = db.prepare(`
    INSERT INTO knowledge_vec(embedding, source, chunk, ingested_at)
    VALUES (?, ?, ?, ?)
  `);
  const insertFts = db.prepare(`
    INSERT INTO knowledge_fts(chunk, source) VALUES (?, ?)
  `);

  for (const chunk of chunks) {
    const embedding = await embed(chunk.chunk);
    insertVec.run(new Float32Array(embedding), chunk.source, chunk.chunk, new Date().toISOString());
    insertFts.run(chunk.chunk, chunk.source);
  }

  return chunks.length;
}

/**
 * Ingest all markdown files in the docs folder
 */
export async function ingestAll(docsPath) {
  const dir = docsPath || process.env.DOCS_PATH || './docs';
  const files = await findMarkdownFiles(dir);

  for (const file of files) {
    await ingestFile(file);
  }
}
