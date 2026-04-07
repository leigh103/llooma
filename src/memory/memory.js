import { chat, embed } from '../ollama.js';
import { getDb } from '../db.js';

const EXTRACTION_PROMPT = `You are a memory extraction system. Given a conversation exchange, identify any facts worth remembering long-term about the user or their context.

Focus on: personal details (name, role, location, preferences), things the user explicitly asks to be remembered, and project context that would shape future answers.

Ignore: questions answered from documentation, general how-to queries, anything transient or session-specific.

Return ONLY a valid JSON array of short factual strings. Return [] if nothing is worth remembering. No explanation, no other text.`;

export async function extractAndStore(userMessage, assistantResponse) {
  let response;
  try {
    response = await chat([
      { role: 'system', content: EXTRACTION_PROMPT },
      {
        role: 'user',
        content: `User said: ${userMessage}\n\nAssistant replied: ${assistantResponse}`,
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
  const insert = db.prepare(`
    INSERT INTO knowledge_vec(embedding, source, chunk, ingested_at)
    VALUES (?, 'memory', ?, ?)
  `);

  for (const fact of facts) {
    if (typeof fact !== 'string' || !fact.trim()) continue;
    try {
      const embedding = await embed(fact);
      insert.run(new Float32Array(embedding), fact, new Date().toISOString());
    } catch (err) {
      console.warn(`⚠️  Failed to store memory "${fact}":`, err.message);
    }
  }
}
