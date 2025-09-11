// scripts/rag-ingest.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { ensureIndex, storeDoc, DIM } from '../utils/redisVec.js';
import { embed } from '../utils/openaiClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TENANT = process.env.TENANT_ID || 'default';
const CARDS_DIR = path.join(__dirname, '../rag/cards');

async function run() {
  await ensureIndex();
  const files = fs.readdirSync(CARDS_DIR).filter(f => f.endsWith('.md'));

  for (const f of files) {
    const full = path.join(CARDS_DIR, f);
    const text = fs.readFileSync(full, 'utf8');
    const title = (text.split('\n')[0] || 'Card').replace(/^#\s*/, '').trim();
    const [vec] = await embed(text);
    if (vec.length !== DIM) throw new Error('embed dim mismatch');
    await storeDoc({
      id: f,
      tenant: TENANT,
      kind: 'card',
      title,
      text,
      embedding: vec
    });
    console.log('Upserted:', f);
  }
  console.log('Done.');
}

run().catch(e => { console.error(e); process.exit(1); });
