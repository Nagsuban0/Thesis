// Loads backend/.env into process.env (Node 22 built-in, no dotenv needed).
// Real environment variables (hosting dashboard, shell) always win over the file.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const envFile = resolve(dirname(fileURLToPath(import.meta.url)), '../.env');
try {
  process.loadEnvFile(envFile);
} catch (err) {
  if (err.code !== 'ENOENT') console.warn(`[warn] Could not read .env: ${err.message}`);
}
