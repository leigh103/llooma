import { setupDb } from '../db.js';
import { ingestAll } from './ingest.js';
import 'dotenv/config';

setupDb();
await ingestAll();
process.exit(0);
