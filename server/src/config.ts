import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '../..');
export const DATA_DIR = path.join(ROOT, 'data');
export const SCENES_DIR = path.join(DATA_DIR, 'scenes');
export const CAMPAIGNS_DIR = path.join(DATA_DIR, 'campaigns');
export const TOKEN_CACHE_DIR = path.join(DATA_DIR, 'images', 'tokens');
export const UPLOADS_DIR = path.join(DATA_DIR, 'images', 'uploads');
export const DB_DIR = path.join(DATA_DIR, 'db');
export const LAST_SCENE_FILE = path.join(DATA_DIR, 'last-scene.json');

export const PORT = Number(process.env.PORT ?? 3001);
export const HOST = process.env.HOST ?? '0.0.0.0';
export const IMAGE_BASE = process.env.DND_IMAGE_BASE ?? 'https://5e.tools';
export const DM_PASSWORD = process.env.DND_PASSWORD ?? null;
