import fs from 'fs';
import path from 'path';
import axios from 'axios';
import 'dotenv/config';
import { ingestAll } from './ingest.js';

const SERVICES_PATH = process.env.API_SERVICES_PATH || './config/apis';
const DOCS_PATH = process.env.DOCS_PATH || './docs';

const TITLE_CANDIDATES = ['title', 'name', 'heading', 'subject', 'label'];
const ID_CANDIDATES    = ['slug', 'id', '_id', 'key', 'uuid'];
const SKIP_PATTERNS    = [/_at$/, /_url$/, /_id$/, /^url$/, /^image/, /^status$/, /^type$/, /^order$/];

function detectFields(sample, excludeFields = []) {
  const keys = Object.keys(sample);
  const exclude = new Set(excludeFields.map(f => f.toLowerCase()));

  const titleField = TITLE_CANDIDATES
    .map(c => keys.find(k => k.toLowerCase() === c))
    .find(Boolean);

  const idField = ID_CANDIDATES
    .map(c => keys.find(k => k.toLowerCase() === c))
    .find(Boolean);

  const reserved = new Set([titleField, idField].filter(Boolean));

  const bodyFields = keys
    .filter(k => {
      if (reserved.has(k)) return false;
      if (exclude.has(k.toLowerCase())) return false;
      if (SKIP_PATTERNS.some(p => p.test(k.toLowerCase()))) return false;
      return typeof sample[k] === 'string' && sample[k].trim().length > 0;
    })
    .sort((a, b) => (sample[b]?.length || 0) - (sample[a]?.length || 0));

  return { titleField, idField, bodyFields };
}

function toMarkdown(obj, { titleField, bodyFields }) {
  const parts = [];
  if (titleField && obj[titleField]) parts.push(`# ${obj[titleField]}\n`);
  for (const field of bodyFields) {
    if (obj[field]?.trim()) parts.push(obj[field].trim());
  }
  return parts.join('\n\n');
}

function toFilename(obj, idField, index) {
  const raw = idField ? obj[idField] : null;
  const slug = raw
    ? String(raw).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    : `item-${index}`;
  return `${slug}.md`;
}

async function trainService(service) {
  const { name, baseUrl, auth, train } = service;
  const endpoint = train.endpoint || '/';
  const excludeFields = train.excludeFields || [];

  const url = baseUrl.replace(/\/$/, '') + '/' + endpoint.replace(/^\//, '');
  const headers = {};
  if (auth?.value) headers[auth.header] = auth.value;

  const res = await axios.get(url, { headers });

  let items = res.data;
  if (!Array.isArray(items)) {
    const arrayKey = Object.keys(items).find(k => Array.isArray(items[k]));
    if (arrayKey) {
      items = items[arrayKey];
    } else {
      throw new Error('Response is not an array and no array field found');
    }
  }

  if (items.length === 0) return null;

  const fields = detectFields(items[0], excludeFields);

  const outDir = path.join(DOCS_PATH, name);
  if (fs.existsSync(outDir)) {
    fs.readdirSync(outDir)
      .filter(f => f.endsWith('.md'))
      .forEach(f => fs.unlinkSync(path.join(outDir, f)));
  } else {
    fs.mkdirSync(outDir, { recursive: true });
  }

  for (let i = 0; i < items.length; i++) {
    const markdown = toMarkdown(items[i], fields);
    if (!markdown.trim()) continue;
    const filename = toFilename(items[i], fields.idField, i);
    fs.writeFileSync(path.join(outDir, filename), markdown, 'utf-8');
  }

  return outDir;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

if (!fs.existsSync(SERVICES_PATH)) process.exit(0);

const files = fs.readdirSync(SERVICES_PATH).filter(f => f.endsWith('.json'));
const outDirs = [];

for (const file of files) {
  let service;
  try {
    const raw = fs.readFileSync(path.join(SERVICES_PATH, file), 'utf-8');
    service = JSON.parse(raw);
  } catch (err) {
    console.error(`Failed to parse ${file}:`, err.message);
    continue;
  }

  if (!service.train) continue;

  if (service.auth?.value?.startsWith('env:')) {
    const envKey = service.auth.value.slice(4);
    service.auth = { ...service.auth, value: process.env[envKey] || null };
  }

  try {
    const outDir = await trainService(service);
    if (outDir) outDirs.push(outDir);
  } catch (err) {
    console.error(`Failed to train ${service.name}:`, err.message);
  }
}

for (const dir of outDirs) {
  await ingestAll(dir);
}

process.exit(0);
