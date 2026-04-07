import axios from 'axios';
import { loadApiServices } from './api-services.js';
import 'dotenv/config';

const MAX_RESPONSE_CHARS = 8000;

// ─── Load API services at startup ────────────────────────────────────────────

const apiServices = loadApiServices();

// ─── API response cache ───────────────────────────────────────────────────────

const apiCache = new Map();

function getCached(key) {
  const entry = apiCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    apiCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(key, data, ttlSeconds) {
  apiCache.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
}

// ─── Tool Definitions (sent to Ollama) ───────────────────────────────────────

export const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'get_current_datetime',
      description: 'Get the current date and time',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for current information. Use when the user asks about something that may be recent or external to the knowledge base.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
        },
        required: ['query'],
      },
    },
  },
];

// Add api_call tool only if services are configured
if (apiServices.length > 0) {
  const serviceList = apiServices
    .map(s => `- ${s.name}: ${s.description}`)
    .join('\n');

  toolDefinitions.push({
    type: 'function',
    function: {
      name: 'api_call',
      description: `Make an HTTP request to a configured API service.\n\nAvailable services:\n${serviceList}`,
      parameters: {
        type: 'object',
        properties: {
          service:  { type: 'string', description: 'The service name' },
          endpoint: { type: 'string', description: 'The endpoint path, e.g. "/articles/123"' },
          method:   { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], description: 'HTTP method, defaults to GET' },
          params:   { type: 'object', description: 'Query params for GET requests, or request body for POST/PUT/PATCH' },
        },
        required: ['service', 'endpoint'],
      },
    },
  });
}

// ─── Tool Executors ───────────────────────────────────────────────────────────

async function get_current_datetime() {
  return new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' });
}

async function web_search({ query }) {
  const key = process.env.BRAVE_API_KEY;

  if (!key) {
    return 'Web search is not configured. Add BRAVE_API_KEY to .env to enable it.';
  }

  const res = await axios.get('https://api.search.brave.com/res/v1/web/search', {
    headers: { 'X-Subscription-Token': key },
    params: { q: query, count: 5 },
  });

  const results = res.data.web?.results || [];
  return results
    .map(r => `**${r.title}**\n${r.description}\n${r.url}`)
    .join('\n\n') || 'No results found.';
}

async function api_call({ service: serviceName, endpoint, method = 'GET', params = {} }) {
  const service = apiServices.find(s => s.name === serviceName);
  if (!service) {
    return `Unknown service: "${serviceName}". Available: ${apiServices.map(s => s.name).join(', ')}`;
  }

  const url = service.baseUrl.replace(/\/$/, '') + '/' + endpoint.replace(/^\//, '');

  // Check cache (only for GET requests)
  const ttl = service.cacheTtlSeconds;
  const cacheKey = `${serviceName}:${method}:${endpoint}:${JSON.stringify(params)}`;
  if (method === 'GET' && ttl > 0) {
    const cached = getCached(cacheKey);
    if (cached) return cached;
  }

  const headers = {};
  if (service.auth?.value) {
    headers[service.auth.header] = service.auth.value;
  }

  const res = await axios({
    method,
    url,
    headers,
    ...(method === 'GET' ? { params } : { data: params }),
  });

  const text = typeof res.data === 'string'
    ? res.data
    : JSON.stringify(res.data, null, 2);

  const result = text.length > MAX_RESPONSE_CHARS
    ? text.slice(0, MAX_RESPONSE_CHARS) + `\n\n[Response truncated — ${text.length} chars total, showing first ${MAX_RESPONSE_CHARS}]`
    : text;

  if (method === 'GET' && ttl > 0) setCached(cacheKey, result, ttl);

  return result;
}

// ─── Tool Runner ─────────────────────────────────────────────────────────────

const executors = {
  get_current_datetime,
  web_search,
  api_call,
};

export async function executeTool(name, args) {
  const fn = executors[name];
  if (!fn) return `Unknown tool: ${name}`;

  try {
    const result = await fn(args);
    return typeof result === 'string' ? result : JSON.stringify(result);
  } catch (err) {
    return `Tool error: ${err.message}`;
  }
}
