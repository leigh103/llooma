# Llooma — Project Context for Claude Code

## What is Llooma?

Llooma is a lightweight, self-hosted RAG (Retrieval-Augmented Generation) middleware built in Node.js. It sits between a set of markdown knowledge docs and a locally-running Ollama LLM, exposing a clean REST API, a browser chat UI, and a Slack integration.

It was built as a replacement for OpenClaw — which was too complex, hard to maintain, and did more than was needed. Llooma does exactly what's required and nothing else.

## Primary Use Case

Llooma is an AI assistant which provides persistent memory and RAG to Ollama (cloud and local) models. The RAG can be populated from multiple data sources, APIs, website scraping and local files.

## Infrastructure

- **Ollama**: Running in a Docker container on Unraid
  - Chat model: `gemma4:e4b`
  - Embedding model: `nomic-embed-text` (768 dimensions)
- **SQLite + sqlite-vec**: Lightweight vector store, stored as a local `.db` file
  - Used only by Llooma for knowledge embeddings
  - Default path: `./data/knowledge.db`, configurable via `DB_PATH`

## Project Structure

```
lloom/
  src/
    index.js          — Entry point. Starts Express server and Slack bot
    agent.js          — Core agent: RAG retrieval + agentic tool loop
    ollama.js         — Ollama HTTP client (embed, chat, streaming)
    db.js             — SQLite + sqlite-vec setup (knowledge table + vec0 virtual table)
    api/
      routes.js       — REST API routes (/chat, /chat/stream, /health)
    rag/
      retrieve.js     — Hybrid vector + BM25 search merged with RRF
    ingest/
      ingest.js       — Chunks markdown files and stores embeddings in SQLite
      run.js          — One-shot ingestion script (npm run ingest)
      watch.js        — File watcher, auto re-ingests docs on change
    tools/
      tools.js        — Tool definitions + executors (web search, datetime, ArangoDB queries)
    slack/
      slack.js        — Slack bot using Bolt.js in socket mode
  public/
    index.html        — Browser chat UI (vanilla JS, streaming SSE)
  docs/               — Markdown knowledge files to ingest (Melded documentation)
  .env.example
  package.json
  README.md
```

## Key Technical Decisions

### RAG Pipeline
1. Markdown docs in `./docs/` are split at heading boundaries first, then sliding-window chunked (~500 words, 50 word overlap) within any section that exceeds that size
2. HTML is stripped before chunking so markup noise doesn't degrade embedding quality
3. Each chunk is embedded via `nomic-embed-text` through Ollama's `/api/embed`
4. Both the vector embedding and raw text are stored in SQLite (see below)
5. At query time: embed the user's message → hybrid vector + keyword search → top 3 chunks merged via RRF → injected into system prompt

### SQLite Store (hybrid search)
- **`knowledge_vec`** — sqlite-vec `vec0` virtual table: stores embeddings + metadata (`source`, `chunk`, `ingested_at`) as auxiliary columns. KNN search via `WHERE embedding MATCH ? AND k = ?`
- **`knowledge_fts`** — SQLite FTS5 virtual table: stores the same chunk text for BM25 keyword search. Tokeniser: `porter ascii` (stemming enabled)
- Both tables are written in the same transaction per ingest; deletes are also paired so they stay in sync
- Embedding dimension must match the model — `nomic-embed-text` = 768

### Hybrid Search & Reciprocal Rank Fusion (RRF)
- `retrieve()` in `src/rag/retrieve.js` runs both searches in parallel:
  - **Vector**: fetches 2× k candidates, filters out results with `distance ≥ 0.95` (low-similarity), falls back to unfiltered top-k if fewer than 2 pass
  - **BM25 / FTS5**: the query is sanitised first — punctuation stripped, lowercased, stopwords removed (a hardcoded set in `retrieve.js`), words under 3 chars dropped — then tried as `term1 AND term2 AND ...` for precision; falls back to OR if no results
- Results from both lists are merged with **Reciprocal Rank Fusion**: score = `Σ 1 / (60 + rank)` — a chunk appearing in both lists gets contributions from each, naturally boosting items that rank well in either or both
- Final top-k by RRF score are returned as context chunks

### Memory Extraction
- After each response, `extractAndStore()` in `src/memory/memory.js` fires in the background (non-blocking)
- Sends only the user's message to the LLM with a prompt to extract memorable facts as a JSON array
- Facts are embedded and written to both `knowledge_vec` and `knowledge_fts` (source = `'memory'`) in a transaction, so they participate in both vector and keyword search on future queries
- Returns `[]` (no-op) for transient exchanges like greetings

### Agentic Tool Loop
- Tools are defined in `tools.js` and passed to Ollama's `/api/chat`
- If the model returns `tool_calls`, Llooma executes them and feeds results back
- Loops up to 5 iterations until the model returns plain text
- Streaming mode (`/api/chat/stream`) does RAG only — no tool loop — for simplicity

### Available Tools
- `get_current_datetime` — returns current UK time
- `web_search` — Brave Search API (requires `BRAVE_API_KEY` in `.env`)

### Slack
- Uses Bolt.js in Socket Mode (no public webhook needed)
- Responds to DMs and @mentions
- Calls the same `askMildred()` agent function as the REST API

## Environment Variables

See `.env.example` for full list. Key ones:

```
OLLAMA_URL=http://<unraid-ip>:11434
OLLAMA_CHAT_MODEL=qwen3:14b
OLLAMA_EMBED_MODEL=nomic-embed-text
DB_PATH=./data/knowledge.db
PORT=3000
API_KEY=...                  # x-api-key header required on all /api routes
SLACK_BOT_TOKEN=...          # optional
SLACK_SIGNING_SECRET=...     # optional
SLACK_APP_TOKEN=...          # optional (socket mode)
BRAVE_API_KEY=...            # optional, enables web_search tool
DOCS_PATH=./docs
```

## NPM Scripts

```
npm start             — Start the server
npm run dev           — Start with --watch (auto-restart on file change)
npm run ingest        — One-shot ingest of all docs in DOCS_PATH
npm run ingest:watch  — Watch DOCS_PATH and auto-re-ingest on changes
```

## Coding Style

- ES modules (`type: "module"` in package.json), use `import/export` not `require`
- `dotenv/config` imported at the top of files that need env vars
- Async/await throughout, no callbacks
- Keep files small and single-purpose
- No TypeScript — plain JavaScript
- No test framework currently set up
