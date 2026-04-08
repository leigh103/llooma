import fs from 'fs';
import path from 'path';
import 'dotenv/config';

const SERVICES_PATH = process.env.API_SERVICES_PATH || './config/apis';

export function loadApiServices() {
  if (!fs.existsSync(SERVICES_PATH)) return [];

  const files = fs.readdirSync(SERVICES_PATH).filter(f => f.endsWith('.json'));
  const services = [];

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(SERVICES_PATH, file), 'utf-8');
      const config = JSON.parse(raw);

      // Scrape/train-only configs don't need baseUrl — skip silently
      if (!config.baseUrl) continue;

      if (!config.name) {
        console.warn(`⚠️  API service ${file}: missing required "name", skipping`);
        continue;
      }

      // Resolve env: auth values
      if (config.auth?.value?.startsWith('env:')) {
        const envKey = config.auth.value.slice(4);
        const envVal = process.env[envKey];
        if (!envVal) {
          console.warn(`⚠️  API service "${config.name}": env var ${envKey} not set`);
        }
        config.auth = { ...config.auth, value: envVal || null };
      }

      services.push(config);
    } catch (err) {
      console.warn(`⚠️  Failed to load API service ${file}:`, err.message);
    }
  }

  return services;
}
