import { getDb } from '../db.js';
import { embed } from '../ollama.js';

const TOP_K = 5;

/**
 * Find the most relevant knowledge chunks for a query
 */
export async function retrieve(query, k = TOP_K) {
  const db = getDb();
  const queryEmbedding = await embed(query);

  const rows = db.prepare(`
    SELECT source, chunk, distance
    FROM knowledge_vec
    WHERE embedding MATCH ?
    AND k = ?
    ORDER BY distance
  `).all(new Float32Array(queryEmbedding), k);

  return rows;
}

/**
 * Build a context string from retrieved chunks to inject into the prompt
 */
export function buildContext(chunks) {
  if (chunks.length === 0) return null;

  const parts = chunks.map(c =>
    `[Source: ${c.source}]\n${c.chunk}`
  );

  return parts.join('\n\n---\n\n');
}
