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
      retrieve.js     — Vector similarity search using sqlite-vec KNN
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
1. Markdown docs in `./docs/` are chunked (~500 words, 50 word overlap)
2. Each chunk is embedded via `nomic-embed-text` through Ollama's `/api/embed`
3. Embeddings stored as documents in ArangoDB `knowledge` collection with a vector index
4. At query time: embed the user's message → `APPROX_NEAR_COSINE` search → top 5 chunks injected into system prompt

### SQLite Vector Store
- Two tables: `knowledge` (metadata) and `knowledge_vec` (vec0 virtual table for embeddings)
- Linked by rowid — inserts/deletes are wrapped in transactions to keep them in sync
- KNN search via `WHERE embedding MATCH ? AND k = ?` — exact search, no tuning needed
- The embedding dimension **must match** the embedding model — `nomic-embed-text` = 768

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

## About Melded

Melded is a Node.js SaaS application — an admin tool for music schools. It handles students, teachers, lesson scheduling, enrolments, and billing. It uses ArangoDB as its database. The Llooma/Mildred knowledge base is documentation about how to use Melded, written as markdown files in `./docs/`.

## Coding Style

- ES modules (`type: "module"` in package.json), use `import/export` not `require`
- `dotenv/config` imported at the top of files that need env vars
- Async/await throughout, no callbacks
- Keep files small and single-purpose
- No TypeScript — plain JavaScript
- No test framework currently set up
