import fs from 'fs';
import { globSync } from 'fs';
import path from 'path';
import { chat } from '../ollama.js';
import { ingestAll } from './ingest.js';

const DOCS_PATH = process.env.DOCS_PATH || './docs';

const DEFAULT_PROMPT = 'Summarise what this file does, its key functions and responsibilities, and how it fits into the wider application. Be concise and factual.';

function fileToDocName(filePath) {
  return path.basename(filePath).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') + '.md';
}

function expandPatterns(patterns) {
  const files = [];
  for (const pattern of patterns) {
    if (/[*?{[]/.test(pattern)) {
      const matches = globSync(pattern);
      if (matches.length === 0) {
        console.warn(`read: no files matched pattern — ${pattern}`);
      }
      files.push(...matches);
    } else {
      files.push(pattern);
    }
  }
  return [...new Set(files)];
}

async function summariseFile(filePath, prompt) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const message = await chat([
    {
      role: 'user',
      content: `${prompt}\n\nFilename: ${path.basename(filePath)}\n\n\`\`\`\n${content}\n\`\`\``,
    },
  ]);
  return message.content.trim();
}

export async function readService(service) {
  const { name, read } = service;
  const prompt = read.prompt || DEFAULT_PROMPT;
  const files = expandPatterns(read.files).filter(f => {
    if (!fs.existsSync(f)) {
      console.warn(`read: file not found, skipping — ${f}`);
      return false;
    }
    return true;
  });

  if (files.length === 0) return null;

  const outDir = path.join(DOCS_PATH, name);
  if (fs.existsSync(outDir)) {
    fs.readdirSync(outDir).filter(f => f.endsWith('.md')).forEach(f => fs.unlinkSync(path.join(outDir, f)));
  } else {
    fs.mkdirSync(outDir, { recursive: true });
  }

  let count = 0;
  for (const filePath of files) {
    console.log(`reading: ${filePath}`);
    try {
      const summary = await summariseFile(filePath, prompt);
      const markdown = `# ${path.basename(filePath)}\n\nSource: ${filePath}\n\n${summary}`;
      fs.writeFileSync(path.join(outDir, fileToDocName(filePath)), markdown, 'utf-8');
      count++;
    } catch (err) {
      console.error(`read error — ${filePath}: ${err.message}`);
    }
  }

  if (count === 0) return null;
  return { outDir, count };
}
