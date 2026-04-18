import { chat, embed } from '../ollama.js';
import { getDb } from '../db.js';

const EXTRACTION_PROMPT = `You are a memory extraction system. Given a conversation exchange, identify any facts worth remembering long-term about the user or their context.

Focus on: personal details (name, role, location, preferences), things the user explicitly asks to be remembered, and project context that would shape future answers.

Ignore: questions answered from documentation, general how-to queries, anything transient or session-specific.

Return ONLY a valid JSON array of short factual strings. Return [] if nothing is worth remembering. No explanation, no other text.`;

export async function extractAndStore(userMessage) {
  let response;
  try {
    response = await chat([
      { role: 'system', content: EXTRACTION_PROMPT },
      {
        role: 'user',
        content: `User said: ${userMessage}`,
      },
    ]);
  } catch (err) {
    console.warn('⚠️  Memory extraction call failed:', err.message);
    return;
  }

  // Strip thinking tokens if present (e.g. qwen3 <think> blocks)
  const raw = response.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  let facts;
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    facts = match ? JSON.parse(match[0]) : [];
  } catch {
    return;
  }

  if (!Array.isArray(facts) || facts.length === 0) return;

  const db = getDb();
  const insertVec = db.prepare(`
    INSERT INTO knowledge_vec(embedding, source, chunk, ingested_at)
    VALUES (?, 'memory', ?, ?)
  `);
  const insertFts = db.prepare(`
    INSERT INTO knowledge_fts(chunk, source) VALUES (?, 'memory')
  `);

  for (const fact of facts) {
    if (typeof fact !== 'string' || !fact.trim()) continue;
    try {
      const embedding = await embed(fact);
      const now = new Date().toISOString();
      db.transaction(() => {
        insertVec.run(new Float32Array(embedding), fact, now);
        insertFts.run(fact);
      })();
    } catch (err) {
      console.warn(`⚠️  Failed to store memory "${fact}":`, err.message);
    }
  }
}
