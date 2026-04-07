import chokidar from 'chokidar';
import path from 'path';
import { setupDb, getDb } from '../db.js';
import { ingestFile, ingestAll } from './ingest.js';
import 'dotenv/config';

const DOCS_PATH = process.env.DOCS_PATH || './docs';

setupDb();
await ingestAll(DOCS_PATH);

const watcher = chokidar.watch(`${DOCS_PATH}/**/*.md`, {
  ignoreInitial: true,
  persistent: true,
});

watcher
  .on('add', async filePath => await ingestFile(filePath))
  .on('change', async filePath => await ingestFile(filePath))
  .on('unlink', filePath => {
    const db = getDb();
    const source = path.relative(DOCS_PATH, filePath);
    db.prepare(`DELETE FROM knowledge_vec WHERE source = ?`).run(source);
  });
