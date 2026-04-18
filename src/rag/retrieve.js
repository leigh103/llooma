import { getDb } from '../db.js';
import { embed } from '../ollama.js';
import 'dotenv/config';

const TOP_K = parseInt(process.env.RAG_TOP_K) || 3;
const RRF_K = 60;          // RRF constant — higher = less aggressive rank weighting
const MAX_DISTANCE = 0.95; // discard vector results with no meaningful similarity
const MAX_PER_SOURCE = parseInt(process.env.RAG_MAX_PER_SOURCE) || 2;
const MIN_RRF_SCORE = parseFloat(process.env.RAG_MIN_SCORE) || 0;

const FTS_STOPWORDS = new Set(['a','an','the','is','it','in','on','of','to','and','or','for','with','was','when','how','what','why','who','are','be','been','has','had','have','do','did','does','this','that','these','those','by','at','as','from','not','no','so','its','my','we','i','you','he','she','they']);

function sanitiseFtsQuery(query) {
  const words = query
    .replace(/[^a-z0-9\s]/gi, ' ')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2 && !FTS_STOPWORDS.has(w));
  return { and: words.join(' AND '), or: words.join(' OR ') };
}

/**
 * Find the most relevant knowledge chunks using hybrid vector + BM25 search,
 * merged with Reciprocal Rank Fusion (RRF).
 */
export async function retrieve(query, k = TOP_K) {
  const db = getDb();

  // Vector search — fetch 2× k so RRF has enough candidates from each side.
  // Filter by MAX_DISTANCE to exclude low-quality matches, but if that leaves
  // too few results, fall back to the raw top-k so the LLM always has something.
  const queryEmbedding = await embed(query);
  const allVecResults = db.prepare(`
    SELECT source, chunk, distance
    FROM knowledge_vec
    WHERE embedding MATCH ?
    AND k = ?
    ORDER BY distance
  `).all(new Float32Array(queryEmbedding), k * 2);
  const vecResults = allVecResults.filter(r => r.distance < MAX_DISTANCE).length >= 2
    ? allVecResults.filter(r => r.distance < MAX_DISTANCE)
    : allVecResults;

  // BM25 keyword search via FTS5 — try AND first for precision, fall back to OR
  let ftsResults = [];
  const { and: ftsAnd, or: ftsOr } = sanitiseFtsQuery(query);
  if (ftsOr) {
    const stmt = db.prepare(`
      SELECT source, chunk, rank
      FROM knowledge_fts
      WHERE knowledge_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
    try {
      ftsResults = stmt.all(ftsAnd, k * 2);
    } catch { /* malformed — will try OR below */ }
    if (ftsResults.length === 0) {
      try {
        ftsResults = stmt.all(ftsOr, k * 2);
      } catch { /* fall back to vector-only */ }
    }
  }

  // Reciprocal Rank Fusion: score = Σ 1 / (RRF_K + rank)
  const scores = new Map();
  const data = new Map();
  const key = r => `${r.source}::${r.chunk.slice(0, 80)}`;

  vecResults.forEach((r, i) => {
    const id = key(r);
    scores.set(id, (scores.get(id) || 0) + 1 / (RRF_K + i + 1));
    data.set(id, { source: r.source, chunk: r.chunk });
  });

  ftsResults.forEach((r, i) => {
    const id = key(r);
    scores.set(id, (scores.get(id) || 0) + 1 / (RRF_K + i + 1));
    data.set(id, { source: r.source, chunk: r.chunk });
  });

  const sourceCounts = new Map();
  const results = [];

  for (const [id, score] of [...scores.entries()].sort((a, b) => b[1] - a[1])) {
    if (results.length >= k) break;
    if (score < MIN_RRF_SCORE) break;
    const item = data.get(id);
    const count = sourceCounts.get(item.source) || 0;
    if (count >= MAX_PER_SOURCE) continue;
    sourceCounts.set(item.source, count + 1);
    results.push(item);
  }

  return results;
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
