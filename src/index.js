import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

import { setupDb } from './db.js';
import { router } from './api/routes.js';
import { startSlack } from './slack/slack.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// Set up SQLite vector store
try {
  setupDb();
} catch (err) {
  console.error('❌ Database setup failed:', err.message);
  process.exit(1);
}

// Express app
const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, '../public')));
app.use('/api', router);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, '0.0.0.0');

startSlack();
