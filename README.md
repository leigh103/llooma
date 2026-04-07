# Mildred — Melded AI Assistant

A lightweight RAG-powered AI assistant for Melded. Uses Ollama for local inference, ArangoDB for vector search, and exposes a clean API with a built-in chat UI.

## Architecture

```
Your markdown docs
    ↓ (ingestion)
nomic-embed-text (Ollama) → embeddings → ArangoDB (vector index)

User message
    ↓
nomic-embed-text → query embedding → ArangoDB similarity search → relevant chunks
    ↓
qwen3:14b (Ollama) + context chunks + tools → response
    ↓
Chat UI / REST API / Slack
```

## Prerequisites

- Node.js 18+
- Ollama running with:
  - `ollama pull qwen3:14b` (or your preferred model)
  - `ollama pull nomic-embed-text`
- ArangoDB 3.12+ (for vector index support)

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your Ollama URL, ArangoDB credentials, etc.

# 3. Add your Melded docs
mkdir docs
# Drop your .md files in here — subdirectories are fine

# 4. Ingest docs into ArangoDB
npm run ingest

# 5. Start Mildred
npm start
# or for development with auto-restart:
npm run dev
```

Open http://localhost:3000 for the chat UI.

## Keeping docs up to date

Instead of manual re-ingestion, run the watcher:

```bash
npm run ingest:watch
```

This watches the `./docs` folder and automatically re-ingests any file that changes.

## API

All endpoints require `x-api-key` header if `API_KEY` is set in `.env`.

### POST /api/chat
Non-streaming chat. Good for Slack, Melded integrations, scripts.

```json
// Request
{ "message": "How do I add a new student?", "history": [] }

// Response
{ "reply": "To add a new student..." }
```

### POST /api/chat/stream
Streaming chat via Server-Sent Events. Used by the built-in UI.

```
data: {"token": "To "}
data: {"token": "add "}
...
data: [DONE]
```

### GET /api/health
```json
{ "status": "ok", "name": "Mildred", "timestamp": "..." }
```

## Slack

1. Create a Slack app at https://api.slack.com/apps
2. Enable Socket Mode
3. Add these Bot Token Scopes: `chat:write`, `im:history`, `app_mentions:read`
4. Subscribe to events: `message.im`, `app_mention`
5. Add your tokens to `.env`

Mildred will respond to DMs and @mentions.

## Web Search

Get a free API key from https://api.search.brave.com and add it as `BRAVE_API_KEY` in `.env`. Mildred will use it when she decides web search is needed.

## Adding Tools

Edit `src/tools/tools.js` to add new tools. Each tool needs:
1. A definition in `toolDefinitions` (tells the LLM what it can call)
2. An executor function (does the actual work)
3. An entry in the `executors` map

## Melded Integration Example

```javascript
// Call Mildred from your Melded Node.js app
const response = await fetch('http://mildred:3000/api/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': process.env.MILDRED_API_KEY,
  },
  body: JSON.stringify({
    message: userQuestion,
    history: conversationHistory,
  }),
});

const { reply } = await response.json();
```
