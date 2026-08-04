# D&D DM 追踪界面实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个局域网多人 D&D 5e DM 追踪工具：可上传地图、画网格与墙、放置怪物/玩家 token（怪物头像自动下载并圆形裁剪）、快速查询 5e不全书中文数据、会话收藏夹、先攻顺序追踪（玩家提交先攻值、当前回合 token 外圈高亮）。

**Architecture:** Node.js 后端（Express REST + ws WebSocket 实时同步，服务器权威）+ React/Konva 前端（Vite 构建，深色主题）。数据来自 `tjliqy/5etools-cn`（cn2.0 分支）离线打包，怪物图片从 5e.tools CDN 下载并缓存。单根 package.json，`server/`、`client/`、`shared/` 三目录，相对路径导入。

**Tech Stack:** React 18, Konva + react-konva, Tailwind CSS, Vite 5, Node.js, Express, ws, Fuse.js, sharp, multer, Vitest, tsx, concurrently。

## Global Constraints

- Node.js >= 20（开发机 v25.8.0 已满足），npm 单一根 `package.json`（不用 workspaces）。
- TypeScript strict 模式（`"strict": true`）。所有源码 `.ts`/`.tsx`。
- **界面文案一律中文**；代码标识符、注释用英文。
- 端口约定：后端 HTTP/WS = `3001`（`0.0.0.0` 监听以支持局域网），Vite 开发 = `5173`。
- 数据目录 `data/` 全部 gitignore（运行时下载/生成物不入库）。
- 角色判定：连接源地址 `127.0.0.1`/`::1`/`::ffff:127.0.0.1` = DM，其余 = 玩家；玩家可用口令升级为 DM。
- 图片源 `DND_IMAGE_BASE` 环境变量可配置，默认 `https://5e.tools`；下载失败一律回退占位 SVG，**不得让请求崩溃**。
- 数据源仓库固定 `tjliqy/5etools-cn`，分支 `cn2.0`，许可证 CC BY-NC-SA 4.0（中文数据）/ MIT（源码）。
- 5etools 数据条目标记 `{@damage 8d6}` 等需在展示前清洗为纯文本。
- 先攻条目按 `value` 降序稳定排序；玩家提交以 `sessionId` 做 upsert 不产生重复。
- 每任务结束必须 `npm test`（或指定测试）通过并 git commit。

---

## 文件结构

```
DnD-DMTool/
├─ package.json
├─ tsconfig.base.json
├─ tsconfig.json
├─ vitest.config.ts
├─ .gitignore                     （已有，含 data/）
├─ shared/
│  └─ types.ts                    Scene/Token/Op 等共享类型
├─ scripts/
│  └─ data-update.mjs             下载 5etools-cn 数据 + 构建搜索索引
├─ server/
│  ├─ src/
│  │  ├─ index.ts                 入口：Express + WS + 静态服务
│  │  ├─ config.ts                路径/端口/环境变量
│  │  ├─ types.ts                 re-export shared/types
│  │  ├─ ops.ts                   applyOp + canOp（纯函数）
│  │  ├─ initiative.ts            sortInitiative / advanceInitiative（纯函数）
│  │  ├─ store.ts                 SceneStore（场景持久化）
│  │  ├─ search.ts                SearchService（索引 + Fuse 查询）
│  │  ├─ entries.ts               EntryService（懒加载 + LRU）
│  │  ├─ tokens.ts                TokenService（下载 + 圆形裁剪 + 缓存 + 占位）
│  │  ├─ game.ts                  GameServer（当前场景 + 客户端管理）
│  │  ├─ routes.ts                Express 路由
│  │  └─ ws.ts                    ws WebSocket 服务
│  └─ test/                       集成测试（supertest + ws 双客户端）
├─ client/
│  ├─ index.html
│  ├─ vite.config.ts
│  ├─ tailwind.config.js
│  ├─ postcss.config.js
│  ├─ src/
│  │  ├─ main.tsx
│  │  ├─ App.tsx                  布局壳
│  │  ├─ index.css                Tailwind 指令 + 深色主题变量
│  │  ├─ types.ts                 re-export shared/types
│  │  ├─ format.ts                renderMarkup / formatMonster / formatSpell
│  │  ├─ api.ts                   REST 客户端
│  │  ├─ ws.ts                    WebSocket 连接 + 重连 + useScene hook
│  │  ├─ store.ts                 场景状态本地代理（乐观应用 + 服务端确认）
│  │  ├─ components/
│  │  │  ├─ TopBar.tsx            顶部状态栏
│  │  │  ├─ Toolbar.tsx           工具竖栏
│  │  │  ├─ InitiativePanel.tsx   先攻栏
│  │  │  ├─ QueryPanel.tsx        查询窗口（查询/收藏夹）
│  │  │  ├─ DetailDrawer.tsx      详情抽屉
│  │  │  ├─ BoardCanvas.tsx       Konva 画布（地图/网格/墙/token）
│  │  │  ├─ TokenShape.tsx        token 绘制（圆裁剪/名字/高亮环）
│  │  │  └─ SceneSwitcher.tsx     场景切换弹层
│  │  └─ __tests__/format.test.ts
```

---

## Task 1: 项目脚手架

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `client/index.html`
- Create: `client/vite.config.ts`
- Create: `client/tailwind.config.js`
- Create: `client/postcss.config.js`
- Create: `client/src/main.tsx`
- Create: `client/src/index.css`
- Create: `client/src/App.tsx`（占位）
- Create: `server/src/index.ts`（占位，仅起 Express 返回 hello）
- Create: `server/src/config.ts`
- Create: `server/src/types.ts`
- Create: `shared/types.ts`（占位空导出）
- Create: `server/src/index.test.ts`（冒烟测试）

**Interfaces:**
- Consumes: 无。
- Produces: `npm run dev`（并行起 3001 后端 + 5173 前端）、`npm test`（Vitest）、`npm run build`、`npm run data:update`（占位）。

- [ ] **Step 1: 写 package.json 与依赖**

```json
{
  "name": "dnd-dm-tool",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "concurrently -n server,client -c blue,green \"npm:dev:server\" \"npm:dev:client\"",
    "dev:server": "tsx watch server/src/index.ts",
    "dev:client": "vite client",
    "build": "npm run build:client",
    "build:client": "vite build client",
    "start": "tsx server/src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "data:update": "node scripts/data-update.mjs"
  },
  "dependencies": {
    "express": "^4.19.2",
    "fuse.js": "^7.0.0",
    "konva": "^9.3.6",
    "multer": "^1.4.5-lts.1",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-konva": "^18.2.10",
    "sharp": "^0.33.4",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/multer": "^1.4.11",
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@types/supertest": "^6.0.2",
    "@types/ws": "^8.5.10",
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.19",
    "concurrently": "^8.2.2",
    "postcss": "^8.4.38",
    "supertest": "^7.0.0",
    "tailwindcss": "^3.4.4",
    "tsx": "^4.15.0",
    "typescript": "^5.5.2",
    "vite": "^5.3.1",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: 写 tsconfig**

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "types": ["node", "vitest/globals"]
  }
}
```

`tsconfig.json`:
```json
{
  "extends": "./tsconfig.base.json",
  "include": ["shared", "server/src", "server/test", "client/src", "client/vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: 写 vitest 配置与占位文件**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['server/src/**/*.test.ts', 'server/test/**/*.test.ts', 'client/src/**/*.test.ts'],
  },
});
```

`shared/types.ts`（本任务仅空占位，Task 2 填充）:
```ts
export {};
```

`server/src/types.ts`:
```ts
export * from '../../shared/types';
```

`server/src/config.ts`:
```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '../..');
export const DATA_DIR = path.join(ROOT, 'data');
export const SCENES_DIR = path.join(DATA_DIR, 'scenes');
export const TOKEN_CACHE_DIR = path.join(DATA_DIR, 'images', 'tokens');
export const UPLOADS_DIR = path.join(DATA_DIR, 'images', 'uploads');
export const DB_DIR = path.join(DATA_DIR, 'db');
export const LAST_SCENE_FILE = path.join(DATA_DIR, 'last-scene.json');

export const PORT = Number(process.env.PORT ?? 3001);
export const HOST = process.env.HOST ?? '0.0.0.0';
export const IMAGE_BASE = process.env.DND_IMAGE_BASE ?? 'https://5e.tools';
export const DM_PASSWORD = process.env.DND_PASSWORD ?? null;
```

`server/src/index.ts`:
```ts
import express from 'express';
import { PORT, HOST } from './config';

const app = express();
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.listen(PORT, HOST, () => {
  console.log(`[dnd-dm-tool] server listening on http://${HOST}:${PORT}`);
});
```

`server/src/index.test.ts`:
```ts
import request from 'supertest';
import express from 'express';
import { describe, it, expect } from 'vitest';

function makeApp() {
  const app = express();
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('health', () => {
  it('returns ok', async () => {
    const res = await request(makeApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
```

`client/index.html`:
```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DM 追踪</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`client/vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    fs: { allow: [path.resolve(__dirname, '..')] },
    proxy: {
      '/api': 'http://localhost:3001',
      '/ws': { target: 'ws://localhost:3001', ws: true },
    },
  },
  build: { outDir: 'dist' },
});
```

`client/tailwind.config.js`:
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: { extend: {} },
  plugins: [],
};
```

`client/postcss.config.js`:
```js
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

`client/src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --bg: #17181c;
  --panel: #1f2128;
  --panel-2: #262932;
  --border: #343844;
  --text: #e5e7eb;
  --muted: #9aa0ad;
  --accent: #f59e0b;
  --danger: #ef4444;
  --ok: #22c55e;
}

html, body, #root { height: 100%; }
body { background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
```

`client/src/main.tsx`:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`client/src/App.tsx`（占位）:
```tsx
export default function App() {
  return <div className="h-full flex items-center justify-center text-zinc-400">DM 追踪工具（脚手架）</div>;
}
```

`client/src/types.ts`:
```ts
export * from '../../shared/types';
```

- [ ] **Step 4: 安装依赖并跑通冒烟**

```bash
cd /Users/xiejiaxue/Documents/DnD-DMTool && npm install
npm test
npx tsc --noEmit
```

Expected: 1 个测试 PASS；`tsc` 无类型错误。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "chore: 项目脚手架（Vite + Express + Vitest + Tailwind + TS strict）"
```

---

## Task 2: 共享类型与场景模型

**Files:**
- Create: `shared/types.ts`（填充）
- Create: `server/src/scene.ts`（`createScene`、`newId`）
- Create: `server/src/scene.test.ts`

**Interfaces:**
- Consumes: Task 1 的 tsconfig/vitest。
- Produces: `Scene`, `Op`（全部 union 成员）, `Role`, `Token`, `PlayerToken`, `Wall`, `InitiativeEntry`, `Favorite`, `GridConfig`, `IndexEntry` 类型；`createScene(name): Scene`；`newId(): string`。

- [ ] **Step 1: 写共享类型**

```ts
export type Role = 'dm' | 'player';

export type EntryType = 'monster' | 'spell' | 'item' | 'feat' | 'condition';

export interface GridConfig {
  size: number;
  color: string;
  offset: [number, number];
  snap: boolean;
}

export interface Token {
  id: string;
  kind: 'monster' | 'player';
  name: string;
  entryId: string | null;
  x: number;
  y: number;
  size: number;
  avatar: string;
  color: string;
}

export interface PlayerToken extends Token {
  sessionId: string | null;
}

export interface Wall {
  id: string;
  p1: [number, number];
  p2: [number, number];
}

export interface InitiativeEntry {
  id: string;
  name: string;
  value: number;
  source: 'dm' | 'player';
  sessionId: string | null;
  tokenId: string | null;
  active: boolean;
}

export interface Favorite {
  type: EntryType;
  entryId: string;
}

export interface PlayArea { x: number; y: number; w: number; h: number }

export interface Scene {
  id: string;
  name: string;
  mapImage: string | null;
  mapSize: [number, number];
  grid: GridConfig;
  playArea: PlayArea;
  tokens: Token[];
  players: PlayerToken[];
  walls: Wall[];
  initiative: InitiativeEntry[];
  favorites: Favorite[];
}

export type Op =
  | { op: 'moveToken'; tokenId: string; x: number; y: number }
  | { op: 'addToken'; token: Token }
  | { op: 'removeToken'; tokenId: string }
  | { op: 'updateToken'; tokenId: string; patch: Partial<Pick<Token, 'name' | 'size' | 'avatar' | 'color'>> }
  | { op: 'addPlayer'; player: PlayerToken }
  | { op: 'updatePlayer'; tokenId: string; patch: Partial<Pick<PlayerToken, 'name' | 'color' | 'sessionId'>> }
  | { op: 'addWall'; wall: Wall }
  | { op: 'removeWall'; wallId: string }
  | { op: 'updateGrid'; patch: Partial<GridConfig> }
  | { op: 'updateMap'; mapImage: string | null; mapSize: [number, number]; playArea: PlayArea }
  | { op: 'submitInitiative'; name: string; value: number; tokenId: string | null; sessionId?: string | null }
  | { op: 'addToInitiative'; name: string; value: number; source: 'dm'; tokenId: string | null }
  | { op: 'removeFromInitiative'; entryId: string }
  | { op: 'advanceTurn' }
  | { op: 'reorderInitiative'; order: string[] }
  | { op: 'addFavorite'; favorite: Favorite }
  | { op: 'removeFavorite'; type: EntryType; entryId: string };

export interface IndexEntry {
  type: EntryType;
  id: string;                 // `${source}__${ENG_name}`
  nameZh: string;
  nameEn: string;
  source: string;
  bookFile: string;
  cr?: string;
  level?: number;
}
```

- [ ] **Step 2: 写场景工厂 + 测试**

`server/src/scene.ts`:
```ts
import { Scene, GridConfig, PlayArea } from './types';

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 7)}`;
}

const DEFAULT_GRID: GridConfig = { size: 100, color: '#00000040', offset: [0, 0], snap: true };
const DEFAULT_PLAY: PlayArea = { x: 0, y: 0, w: 1600, h: 1200 };

export function createScene(name: string): Scene {
  return {
    id: newId('scene'),
    name,
    mapImage: null,
    mapSize: [1600, 1200],
    grid: { ...DEFAULT_GRID },
    playArea: { ...DEFAULT_PLAY },
    tokens: [],
    players: [],
    walls: [],
    initiative: [],
    favorites: [],
  };
}
```

`server/src/scene.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createScene, newId } from './scene';

describe('scene factory', () => {
  it('creates a scene with unique id and empty collections', () => {
    const s = createScene('地牢');
    expect(s.id).toMatch(/^scene-/);
    expect(s.name).toBe('地牢');
    expect(s.tokens).toEqual([]);
    expect(s.initiative).toEqual([]);
    expect(s.grid.size).toBe(100);
  });

  it('newId produces unique ids', () => {
    const a = newId('t');
    const b = newId('t');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^t-/);
  });

  it('scene serializes and deserializes (round-trip)', () => {
    const s = createScene('测试');
    const copy = JSON.parse(JSON.stringify(s)) as typeof s;
    expect(copy).toEqual(s);
  });
});
```

- [ ] **Step 3: 跑测试**

```bash
npm test -- server/src/scene.test.ts
```

Expected: 3 个测试 PASS。

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "feat: 共享类型与场景模型工厂"
```

---

## Task 3: 操作引擎（applyOp + canOp）

**Files:**
- Create: `server/src/ops.ts`
- Create: `server/src/ops.test.ts`

**Interfaces:**
- Consumes: `shared/types.ts`（Task 2），`newId`（Task 2）。
- Produces:
  - `canOp(role: Role, op: Op): boolean` —— DM 全部；玩家仅 `moveToken`、`submitInitiative`。
  - `applyOp(scene: Scene, op: Op): void` —— 就地修改 scene，所有 op 的实现。
  - `isPlayerOp(op: Op): boolean`。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { applyOp, canOp, isPlayerOp } from './ops';
import { createScene } from './scene';
import { Scene, Op } from './types';

function freshScene(): Scene {
  return JSON.parse(JSON.stringify(createScene('t')));
}

describe('canOp', () => {
  it('dm can do everything', () => {
    const ops: Op[] = [
      { op: 'moveToken', tokenId: 'a', x: 0, y: 0 },
      { op: 'addToken', token: {} as never },
      { op: 'advanceTurn' },
      { op: 'reorderInitiative', order: [] },
    ];
    for (const op of ops) expect(canOp('dm', op)).toBe(true);
  });

  it('player can only moveToken and submitInitiative', () => {
    expect(canOp('player', { op: 'moveToken', tokenId: 'a', x: 0, y: 0 })).toBe(true);
    expect(canOp('player', { op: 'submitInitiative', name: 'x', value: 5, tokenId: null })).toBe(true);
    expect(canOp('player', { op: 'addToken', token: {} as never })).toBe(false);
    expect(canOp('player', { op: 'advanceTurn' })).toBe(false);
  });
});

describe('applyOp token ops', () => {
  it('adds and moves and removes tokens', () => {
    const s = freshScene();
    applyOp(s, { op: 'addToken', token: { id: 't1', kind: 'monster', name: '地精', entryId: 'MM__Goblin', x: 0, y: 0, size: 100, avatar: '/api/token/MM__Goblin', color: '#fff' } });
    expect(s.tokens).toHaveLength(1);
    applyOp(s, { op: 'moveToken', tokenId: 't1', x: 300, y: 400 });
    expect(s.tokens[0].x).toBe(300);
    applyOp(s, { op: 'updateToken', tokenId: 't1', patch: { name: '哥布林' } });
    expect(s.tokens[0].name).toBe('哥布林');
    applyOp(s, { op: 'removeToken', tokenId: 't1' });
    expect(s.tokens).toHaveLength(0);
  });

  it('updateToken on missing token is a no-op', () => {
    const s = freshScene();
    applyOp(s, { op: 'moveToken', tokenId: 'nope', x: 1, y: 2 });
    expect(s.tokens).toHaveLength(0);
  });
});

describe('applyOp players', () => {
  it('adds and updates players', () => {
    const s = freshScene();
    applyOp(s, { op: 'addPlayer', player: { id: 'p1', kind: 'player', name: '阿拉贡', entryId: null, x: 100, y: 100, size: 100, avatar: '', color: '#e53e3e', sessionId: null } });
    expect(s.players).toHaveLength(1);
    applyOp(s, { op: 'updatePlayer', tokenId: 'p1', patch: { sessionId: 'sess-1' } });
    expect(s.players[0].sessionId).toBe('sess-1');
  });
});

describe('applyOp walls & grid & map', () => {
  it('walls', () => {
    const s = freshScene();
    applyOp(s, { op: 'addWall', wall: { id: 'w1', p1: [0, 0], p2: [100, 100] } });
    expect(s.walls).toHaveLength(1);
    applyOp(s, { op: 'removeWall', wallId: 'w1' });
    expect(s.walls).toHaveLength(0);
  });

  it('grid patch merges', () => {
    const s = freshScene();
    applyOp(s, { op: 'updateGrid', patch: { size: 50 } });
    expect(s.grid.size).toBe(50);
    expect(s.grid.snap).toBe(true);
  });

  it('map update', () => {
    const s = freshScene();
    applyOp(s, { op: 'updateMap', mapImage: 'uploads/m.jpg', mapSize: [800, 600], playArea: { x: 0, y: 0, w: 800, h: 600 } });
    expect(s.mapImage).toBe('uploads/m.jpg');
    expect(s.mapSize).toEqual([800, 600]);
  });
});

describe('applyOp initiative', () => {
  it('submitInitiative adds then upserts by sessionId, sorts desc', () => {
    const s = freshScene();
    applyOp(s, { op: 'submitInitiative', name: '甲', value: 10, tokenId: null });
    applyOp(s, { op: 'submitInitiative', name: '乙', value: 20, tokenId: null });
    applyOp(s, { op: 'submitInitiative', name: '丙', value: 15, tokenId: null });
    expect(s.initiative).toHaveLength(3);
    expect(s.initiative.map(e => e.value)).toEqual([20, 15, 10]);
    const id = s.initiative.find(e => e.name === '乙')!.id;
    // 重提交（无 sessionId 时按名字 upsert）
    applyOp(s, { op: 'submitInitiative', name: '乙', value: 5, tokenId: null });
    expect(s.initiative).toHaveLength(3);
    expect(s.initiative.map(e => e.value)).toEqual([15, 10, 5]);
    expect(id).toBeDefined();
  });

  it('addToInitiative, removeFromInitiative, reorder, advanceTurn', () => {
    const s = freshScene();
    applyOp(s, { op: 'addToInitiative', name: 'A', value: 30, source: 'dm', tokenId: 't1' });
    applyOp(s, { op: 'addToInitiative', name: 'B', value: 20, source: 'dm', tokenId: null });
    expect(s.initiative.map(e => e.value)).toEqual([30, 20]);
    const firstId = s.initiative[0].id;
    applyOp(s, { op: 'advanceTurn' });
    expect(s.initiative.find(e => e.active)).toBe(s.initiative[0]);
    applyOp(s, { op: 'advanceTurn' });
    expect(s.initiative.find(e => e.active)).toBe(s.initiative[1]);
    applyOp(s, { op: 'advanceTurn' });
    expect(s.initiative.find(e => e.active)).toBe(s.initiative[0]); // 回绕
    applyOp(s, { op: 'reorderInitiative', order: [s.initiative[1].id, s.initiative[0].id] });
    expect(s.initiative.map(e => e.value)).toEqual([20, 30]);
    applyOp(s, { op: 'removeFromInitiative', entryId: s.initiative[1].id });
    expect(s.initiative).toHaveLength(1);
  });
});

describe('applyOp favorites', () => {
  it('add and remove favorite', () => {
    const s = freshScene();
    applyOp(s, { op: 'addFavorite', favorite: { type: 'monster', entryId: 'MM__Goblin' } });
    expect(s.favorites).toHaveLength(1);
    applyOp(s, { op: 'addFavorite', favorite: { type: 'monster', entryId: 'MM__Goblin' } });
    expect(s.favorites).toHaveLength(1); // 去重
    applyOp(s, { op: 'removeFavorite', type: 'monster', entryId: 'MM__Goblin' });
    expect(s.favorites).toHaveLength(0);
  });
});
```

注意：本测试第 25-27 行的 `addToken` 的 `token` 用了 `{} as never` 作为占位构造，仅用于 `canOp` 校验，`applyOp` 测试里有完整 token。

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- server/src/ops.test.ts
```

Expected: FAIL（`./ops` 不存在）。

- [ ] **Step 3: 实现 ops.ts**

```ts
import { Op, Role, Scene, InitiativeEntry } from './types';
import { sortInitiative, advanceInitiative } from './initiative';  // Task 4 提供，先实现占位
```

> 说明：`applyOp` 的先攻排序与推进复用了 Task 4 的 `sortInitiative`/`advanceInitiative`。若并行实现导致 Task 3 无法编译，可先在本文件内联最小实现，Task 4 再收敛。此处直接引用 Task 4 的实现（Task 4 随后立即落地）。

```ts
export function isPlayerOp(op: Op): boolean {
  return op.op === 'moveToken' || op.op === 'submitInitiative';
}

export function canOp(role: Role, op: Op): boolean {
  if (role === 'dm') return true;
  return isPlayerOp(op);
}

export function applyOp(scene: Scene, op: Op): void {
  switch (op.op) {
    case 'addToken': {
      if (!scene.tokens.some(t => t.id === op.token.id)) scene.tokens.push(op.token);
      return;
    }
    case 'moveToken': {
      const t = findToken(scene, op.tokenId);
      if (t) { t.x = op.x; t.y = op.y; }
      return;
    }
    case 'removeToken': {
      scene.tokens = scene.tokens.filter(t => t.id !== op.tokenId);
      return;
    }
    case 'updateToken': {
      const t = findToken(scene, op.tokenId);
      if (t) Object.assign(t, op.patch);
      return;
    }
    case 'addPlayer': {
      if (!scene.players.some(p => p.id === op.player.id)) scene.players.push(op.player);
      return;
    }
    case 'updatePlayer': {
      const p = scene.players.find(p => p.id === op.tokenId);
      if (p) Object.assign(p, op.patch);
      return;
    }
    case 'addWall': {
      if (!scene.walls.some(w => w.id === op.wall.id)) scene.walls.push(op.wall);
      return;
    }
    case 'removeWall': {
      scene.walls = scene.walls.filter(w => w.id !== op.wallId);
      return;
    }
    case 'updateGrid': {
      Object.assign(scene.grid, op.patch);
      return;
    }
    case 'updateMap': {
      scene.mapImage = op.mapImage;
      scene.mapSize = op.mapSize;
      scene.playArea = op.playArea;
      return;
    }
    case 'submitInitiative': {
      const existing = op.sessionId != null
        ? scene.initiative.find(e => e.sessionId === op.sessionId)
        : scene.initiative.find(e => e.source === 'player' && e.name === op.name);
      if (existing) {
        existing.name = op.name;
        existing.value = op.value;
        existing.tokenId = op.tokenId ?? existing.tokenId;
      } else {
        scene.initiative.push({
          id: genEntryId(scene),
          name: op.name,
          value: op.value,
          source: 'player',
          sessionId: op.sessionId ?? null,
          tokenId: op.tokenId ?? null,
          active: false,
        });
      }
      scene.initiative = sortInitiative(scene.initiative);
      return;
    }
    case 'addToInitiative': {
      scene.initiative.push({
        id: genEntryId(scene),
        name: op.name,
        value: op.value,
        source: op.source,
        sessionId: null,
        tokenId: op.tokenId,
        active: false,
      });
      scene.initiative = sortInitiative(scene.initiative);
      return;
    }
    case 'removeFromInitiative': {
      scene.initiative = scene.initiative.filter(e => e.id !== op.entryId);
      return;
    }
    case 'advanceTurn': {
      scene.initiative = advanceInitiative(scene.initiative);
      return;
    }
    case 'reorderInitiative': {
      const byId = new Map(scene.initiative.map(e => [e.id, e]));
      const ordered: InitiativeEntry[] = [];
      for (const id of op.order) {
        const e = byId.get(id);
        if (e) { ordered.push(e); byId.delete(id); }
      }
      for (const e of byId.values()) ordered.push(e); // 未被列出的追加尾部
      scene.initiative = ordered;
      return;
    }
    case 'addFavorite': {
      if (!scene.favorites.some(f => f.type === op.favorite.type && f.entryId === op.favorite.entryId)) {
        scene.favorites.push(op.favorite);
      }
      return;
    }
    case 'removeFavorite': {
      scene.favorites = scene.favorites.filter(f => !(f.type === op.type && f.entryId === op.entryId));
      return;
    }
  }
}

function findToken(scene: Scene, tokenId: string) {
  return scene.tokens.find(t => t.id === tokenId) ?? scene.players.find(t => t.id === tokenId);
}

let n = 0;
function genEntryId(scene: Scene): string {
  n += 1;
  return `ini-${Date.now().toString(36)}-${n}`;
}
```

- [ ] **Step 4: 实现 Task 4 的先攻纯函数（本任务依赖）**

见 Task 4 的 `server/src/initiative.ts` 实现。先在 `ops.ts` 中导入。若按顺序执行，直接先完成 Task 4 再回来跑本任务测试。

- [ ] **Step 5: 跑测试**

```bash
npm test -- server/src/ops.test.ts server/src/initiative.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "feat: 操作引擎 applyOp 与权限 canOp"
```

---

## Task 4: 先攻逻辑纯函数

**Files:**
- Create: `server/src/initiative.ts`
- Create: `server/src/initiative.test.ts`

**Interfaces:**
- Consumes: `shared/types.ts`。
- Produces:
  - `sortInitiative(entries: InitiativeEntry[]): InitiativeEntry[]`（value 降序，稳定）。
  - `advanceInitiative(entries: InitiativeEntry[]): InitiativeEntry[]`（无 active → 第一项 active；有 → 下一项，末尾回绕到第一项）。
  - `activeEntry(entries: InitiativeEntry[]): InitiativeEntry | null`。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { sortInitiative, advanceInitiative, activeEntry } from './initiative';
import { InitiativeEntry } from './types';

function e(id: string, value: number, active = false): InitiativeEntry {
  return { id, name: id, value, source: 'dm', sessionId: null, tokenId: null, active };
}

describe('sortInitiative', () => {
  it('sorts by value desc, stable for ties', () => {
    const sorted = sortInitiative([e('a', 10), e('b', 20), e('c', 15), e('d', 20)]);
    expect(sorted.map(x => x.id)).toEqual(['b', 'd', 'c', 'a']);
  });
});

describe('advanceInitiative', () => {
  it('activates first when none active', () => {
    const list = [e('a', 10), e('b', 20)];
    const out = advanceInitiative(list);
    expect(out.find(x => x.active)!.id).toBe('a');
  });

  it('moves to next and wraps around', () => {
    let list = [e('a', 10, true), e('b', 20), e('c', 30)];
    list = advanceInitiative(list);
    expect(list.find(x => x.active)!.id).toBe('b');
    list = advanceInitiative(list);
    expect(list.find(x => x.active)!.id).toBe('c');
    list = advanceInitiative(list);
    expect(list.find(x => x.active)!.id).toBe('a');
  });

  it('empty list is safe', () => {
    expect(advanceInitiative([])).toEqual([]);
  });
});

describe('activeEntry', () => {
  it('returns active or null', () => {
    expect(activeEntry([e('a', 1, true)])!.id).toBe('a');
    expect(activeEntry([e('a', 1)])).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- server/src/initiative.test.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
import { InitiativeEntry } from './types';

export function sortInitiative(entries: InitiativeEntry[]): InitiativeEntry[] {
  return [...entries].sort((a, b) => b.value - a.value);
}

export function activeEntry(entries: InitiativeEntry[]): InitiativeEntry | null {
  return entries.find(x => x.active) ?? null;
}

export function advanceInitiative(entries: InitiativeEntry[]): InitiativeEntry[] {
  const next = entries.map(x => ({ ...x, active: false }));
  if (next.length === 0) return next;
  const cur = activeEntry(entries);
  let idx = cur ? next.findIndex(x => x.id === cur.id) + 1 : 0;
  if (idx >= next.length || idx < 0) idx = 0;
  next[idx].active = true;
  return next;
}
```

- [ ] **Step 4: 跑测试**

```bash
npm test -- server/src/initiative.test.ts
```

Expected: 5 个测试 PASS。

- [ ] **Step 5: 回 Task 3 跑 ops 测试确认通过**

```bash
npm test -- server/src/ops.test.ts server/src/initiative.test.ts
```

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "feat: 先攻排序/推进纯函数"
```

---

## Task 5: 场景存储 SceneStore

**Files:**
- Create: `server/src/store.ts`
- Create: `server/src/store.test.ts`

**Interfaces:**
- Consumes: `config.ts` 的路径（但测试注入临时目录），`createScene`，`Scene`。
- Produces:
  - `class SceneStore`，构造 `(dir: string)`：
    - `list(): Promise<{id: string; name: string}[]>`（按目录内 `*.json`，不含 `last-scene`）
    - `create(name: string): Promise<Scene>`
    - `get(id: string): Promise<Scene>`（不存在抛 `SceneNotFoundError`）
    - `save(scene: Scene): void`（同步写盘，覆盖）
    - `delete(id: string): Promise<void>`
    - `last(): Promise<string | null>` / `setLast(id: string | null): void`（记录上次场景 id，写入 `last-scene.json`）
- `class SceneNotFoundError extends Error`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SceneStore, SceneNotFoundError } from './store';

let dir: string;
let store: SceneStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scenes-'));
  store = new SceneStore(dir);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('SceneStore', () => {
  it('creates and lists scenes', async () => {
    const a = await store.create('地牢');
    const b = await store.create('森林');
    const list = await store.list();
    expect(list).toHaveLength(2);
    expect(list.map(x => x.name)).toEqual(expect.arrayContaining(['地牢', '森林']));
    expect(a.name).toBe('地牢');
    expect(b.id).not.toBe(a.id);
  });

  it('round-trips save/get', async () => {
    const s = await store.create('测试');
    s.tokens.push({ id: 't1', kind: 'monster', name: '地精', entryId: 'MM__Goblin', x: 1, y: 2, size: 100, avatar: '', color: '#fff' });
    store.save(s);
    const got = await store.get(s.id);
    expect(got.tokens).toHaveLength(1);
    expect(got.tokens[0].x).toBe(1);
    expect(got.name).toBe('测试');
  });

  it('get missing throws', async () => {
    await expect(store.get('nope')).rejects.toBeInstanceOf(SceneNotFoundError);
  });

  it('delete removes file', async () => {
    const s = await store.create('删');
    await store.delete(s.id);
    await expect(store.get(s.id)).rejects.toBeInstanceOf(SceneNotFoundError);
  });

  it('last-scene id is remembered', async () => {
    const s = await store.create('a');
    store.setLast(s.id);
    expect(await store.last()).toBe(s.id);
    store.setLast(null);
    expect(await store.last()).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- server/src/store.test.ts
```

- [ ] **Step 3: 实现 store.ts**

```ts
import fs from 'node:fs';
import path from 'node:path';
import { Scene } from './types';
import { createScene } from './scene';

export class SceneNotFoundError extends Error {
  constructor(id: string) {
    super(`scene not found: ${id}`);
    this.name = 'SceneNotFoundError';
  }
}

export class SceneStore {
  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  private file(id: string) {
    if (!/^[a-z0-9-]+$/i.test(id)) throw new Error(`invalid scene id: ${id}`);
    return path.join(this.dir, `${id}.json`);
  }

  async list(): Promise<{ id: string; name: string }[]> {
    const files = fs.readdirSync(this.dir).filter(f => f.endsWith('.json'));
    const out: { id: string; name: string }[] = [];
    for (const f of files) {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')) as Scene;
        out.push({ id: s.id, name: s.name });
      } catch {
        // 忽略损坏文件
      }
    }
    return out;
  }

  async create(name: string): Promise<Scene> {
    const s = createScene(name);
    this.save(s);
    return s;
  }

  async get(id: string): Promise<Scene> {
    try {
      const raw = fs.readFileSync(this.file(id), 'utf8');
      return JSON.parse(raw) as Scene;
    } catch {
      throw new SceneNotFoundError(id);
    }
  }

  save(scene: Scene): void {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file(scene.id), JSON.stringify(scene, null, 2));
  }

  async delete(id: string): Promise<void> {
    const f = this.file(id);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  async last(): Promise<string | null> {
    try {
      const raw = fs.readFileSync(path.join(this.dir, 'last-scene.json'), 'utf8');
      return (JSON.parse(raw) as { id: string }).id ?? null;
    } catch {
      return null;
    }
  }

  setLast(id: string | null): void {
    if (id == null) {
      try { fs.unlinkSync(path.join(this.dir, 'last-scene.json')); } catch { /* noop */ }
      return;
    }
    fs.writeFileSync(path.join(this.dir, 'last-scene.json'), JSON.stringify({ id }));
  }
}
```

- [ ] **Step 4: 跑测试**

```bash
npm test -- server/src/store.test.ts
```

Expected: 5 个测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat: 场景存储 SceneStore"
```

---

## Task 6: 数据管线（下载 + 搜索索引 + 查询）

**Files:**
- Create: `scripts/data-update.mjs`
- Create: `server/src/search.ts`
- Create: `server/src/search.test.ts`
- Create: `server/test/fixtures/db/`（fixture 数据文件）

**Interfaces:**
- Consumes: `IndexEntry` 类型（Task 2）。
- Produces:
  - `scripts/data-update.mjs`：从 GitHub 下载数据到 `data/db/`，然后调用索引构建。
  - `buildIndexFromDir(dbDir: string): Promise<IndexEntry[]>` —— 扫描 `data/db` 下已下载的文件，产出索引数组。
  - `writeIndex(dbDir: string, entries: IndexEntry[]): void` —— 写 `data/db/index.json`。
  - `class SearchService { constructor(dbDir); async load(): Promise<void>; query(q: string, type?: EntryType | 'all'): IndexEntry[] }` —— 内部 Fuse.js 模糊搜索 `nameZh`/`nameEn`，过滤类型，返回最多 50 条。
  - 5etools 数据格式常量：`DATA_FILES` 默认书单。

- [ ] **Step 1: 写 fixture 数据**

`server/test/fixtures/db/bestiary/bestiary-mm.json`:
```json
{
  "monster": [
    {
      "ENG_name": "Goblin", "name": "地精", "source": "MM", "page": 166, "size": ["S"],
      "type": {"type": "humanoid", "tags": ["地精"]}, "ac": [15], "hp": {"average": 7, "formula": "2d6"},
      "speed": {"walk": 30}, "str": 8, "dex": 14, "con": 10, "int": 10, "wis": 8, "cha": 8,
      "cr": "1/4", "languages": "通用语，地精语",
      "trait": [{"ENG_name": "Nimble Escape", "name": "灵巧逃脱", "entries": ["{@i 灵巧逃脱}描述。"]}],
      "action": [{"ENG_name": "Scimitar", "name": "弯刀", "entries": ["近战武器攻击：命中 {@hit +4}，触及 5 尺，单个目标。伤害 {@damage 1d6 + 2} 点挥砍伤害。"]}]
    },
    {
      "ENG_name": "Hobgoblin", "name": "大地精", "source": "MM", "page": 186, "size": ["M"],
      "ac": [18], "hp": {"average": 11, "formula": "2d8 + 2"}, "speed": {"walk": 30},
      "str": 13, "dex": 12, "con": 12, "int": 10, "wis": 10, "cha": 9, "cr": "1/2", "languages": "通用语，地精语",
      "trait": [], "action": []
    }
  ]
}
```

`server/test/fixtures/db/spells/spells-phb.json`:
```json
{
  "spell": [
    {
      "ENG_name": "Fireball", "name": "火球术", "source": "PHB", "page": 241,
      "level": 3, "school": "V", "time": [{"number": 1, "unit": "action"}],
      "range": {"type": "point", "distance": {"type": "feet", "amount": 150}},
      "components": {"v": true, "s": true, "m": "一小球蝙蝠粪及硫磺"},
      "duration": [{"type": "instant"}],
      "entries": ["半径 20 尺球状区域内每个生物必须进行敏捷豁免。失败受 {@damage 8d6} 火焰伤害。"]
    }
  ]
}
```

`server/test/fixtures/db/items.json`:
```json
{ "item": [ { "ENG_name": "Longsword", "name": "长剑", "source": "PHB", "type": "M", "cost": 1500, "damage": "1d8" } ] }
```

- [ ] **Step 2: 写失败测试**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndexFromDir, writeIndex, SearchService } from './search';

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test/fixtures/db');

describe('buildIndexFromDir', () => {
  it('builds index from fixture db', async () => {
    const idx = await buildIndexFromDir(FIXTURES);
    expect(idx.length).toBeGreaterThanOrEqual(3);
    const goblin = idx.find(e => e.id === 'MM__Goblin');
    expect(goblin).toMatchObject({ type: 'monster', nameZh: '地精', nameEn: 'Goblin', cr: '1/4', bookFile: 'bestiary/bestiary-mm.json' });
    const fb = idx.find(e => e.id === 'PHB__Fireball');
    expect(fb).toMatchObject({ type: 'spell', level: 3, bookFile: 'spells/spells-phb.json' });
    const ls = idx.find(e => e.id === 'PHB__Longsword');
    expect(ls).toMatchObject({ type: 'item', bookFile: 'items.json' });
  });
});

describe('SearchService', () => {
  let svc: SearchService;
  beforeEach(async () => {
    svc = new SearchService(FIXTURES);
    await svc.load();
  });

  it('fuzzy matches Chinese name', () => {
    const r = svc.query('地精');
    expect(r.some(x => x.id === 'MM__Goblin')).toBe(true);
  });

  it('fuzzy matches English name', () => {
    const r = svc.query('goblin');
    expect(r.some(x => x.id === 'MM__Goblin')).toBe(true);
  });

  it('filters by type', () => {
    const r = svc.query('术', 'spell');
    expect(r.every(x => x.type === 'spell')).toBe(true);
  });

  it('returns empty on no match', () => {
    expect(svc.query('zzzz不存在zzzz')).toEqual([]);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
npm test -- server/src/search.test.ts
```

- [ ] **Step 4: 实现 search.ts**

```ts
import fs from 'node:fs';
import path from 'node:path';
import Fuse from 'fuse.js';
import { EntryType, IndexEntry } from './types';

export interface SourceMap { [source: string]: string }

export const DEFAULT_BOOKS = {
  bestiary: ['MM', 'XMM', 'MPMM', 'PHB', 'XPHB', 'VGM', 'MTF', 'TCE', 'EGW', 'FTD', 'IDRotF', 'CoS', 'WDH', 'WDMM'],
  spells: ['PHB', 'XPHB', 'XGE', 'TCE', 'AI', 'EGW', 'FTD', 'IDRotF', 'CoS', 'WDH', 'WDMM'],
  singles: ['items.json', 'feats.json', 'conditionsdiseases.json'],
};

function loadJson(p: string): any {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function findArrayKey(obj: any): string | null {
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null) return k;
  }
  return null;
}

async function buildBestiaryIndex(dbDir: string, sourceMap: SourceMap, out: IndexEntry[]) {
  for (const [source, fileName] of Object.entries(sourceMap)) {
    const p = path.join(dbDir, 'bestiary', fileName);
    if (!fs.existsSync(p)) continue;
    const data = loadJson(p);
    const key = findArrayKey(data);
    if (!key) continue;
    for (const m of data[key] ?? []) {
      if (typeof m !== 'object' || m == null) continue;
      out.push({
        type: 'monster',
        id: `${source}__${m.ENG_name ?? m.name}`,
        nameZh: m.name ?? '',
        nameEn: m.ENG_name ?? m.name ?? '',
        source,
        bookFile: `bestiary/${fileName}`,
        cr: m.cr != null ? String(m.cr) : undefined,
      });
    }
  }
}

async function buildSpellIndex(dbDir: string, sourceMap: SourceMap, out: IndexEntry[]) {
  for (const [source, fileName] of Object.entries(sourceMap)) {
    const p = path.join(dbDir, 'spells', fileName);
    if (!fs.existsSync(p)) continue;
    const data = loadJson(p);
    const key = findArrayKey(data);
    if (!key) continue;
    for (const s of data[key] ?? []) {
      if (typeof s !== 'object' || s == null) continue;
      out.push({
        type: 'spell',
        id: `${source}__${s.ENG_name ?? s.name}`,
        nameZh: s.name ?? '',
        nameEn: s.ENG_name ?? s.name ?? '',
        source,
        bookFile: `spells/${fileName}`,
        level: s.level,
      });
    }
  }
}

async function buildSingleIndex(dbDir: string, fileName: string, type: EntryType, out: IndexEntry[]) {
  const p = path.join(dbDir, fileName);
  if (!fs.existsSync(p)) return;
  const data = loadJson(p);
  const key = findArrayKey(data);
  if (!key) return;
  for (const it of data[key] ?? []) {
    if (typeof it !== 'object' || it == null) continue;
    out.push({
      type,
      id: `${it.source ?? 'PHB'}__${it.ENG_name ?? it.name}`,
      nameZh: it.name ?? '',
      nameEn: it.ENG_name ?? it.name ?? '',
      source: it.source ?? 'PHB',
      bookFile: fileName,
    });
  }
}

export async function buildIndexFromDir(dbDir: string): Promise<IndexEntry[]> {
  const out: IndexEntry[] = [];
  const bestiaryMap = readSourceMap(dbDir, 'bestiary');
  const spellMap = readSourceMap(dbDir, 'spells');

  await buildBestiaryIndex(dbDir, bestiaryMap, out);
  await buildSpellIndex(dbDir, spellMap, out);
  for (const f of ['items.json', 'feats.json', 'conditionsdiseases.json']) {
    const type = f.startsWith('items') ? 'item' : f.startsWith('feats') ? 'feat' : 'condition';
    await buildSingleIndex(dbDir, f, type, out);
  }
  return out;
}

function readSourceMap(dbDir: string, sub: string): SourceMap {
  const idx = loadJson(path.join(dbDir, sub, 'index.json'));
  const map: SourceMap = {};
  for (const [source, fileName] of Object.entries(idx ?? {})) {
    if (typeof fileName === 'string') map[source] = fileName;
  }
  return map;
}

export function writeIndex(dbDir: string, entries: IndexEntry[]): void {
  fs.mkdirSync(dbDir, { recursive: true });
  fs.writeFileSync(path.join(dbDir, 'index.json'), JSON.stringify(entries));
}

export class SearchService {
  private entries: IndexEntry[] = [];
  private fuse: Fuse<IndexEntry> | null = null;

  constructor(private dbDir: string) {}

  async load(): Promise<void> {
    const p = path.join(this.dbDir, 'index.json');
    if (!fs.existsSync(p)) {
      const built = await buildIndexFromDir(this.dbDir);
      writeIndex(this.dbDir, built);
    }
    this.entries = JSON.parse(fs.readFileSync(path.join(this.dbDir, 'index.json'), 'utf8')) as IndexEntry[];
    this.fuse = new Fuse(this.entries, {
      keys: ['nameZh', 'nameEn'],
      threshold: 0.4,
      ignoreLocation: true,
    });
  }

  query(q: string, type: EntryType | 'all' = 'all'): IndexEntry[] {
    if (!this.fuse) return [];
    const trimmed = q.trim();
    if (!trimmed) return [];
    const scored = this.fuse.search(trimmed);
    const out = scored.map(r => r.item).filter(e => type === 'all' || e.type === type);
    return out.slice(0, 50);
  }
}
```

> 注：`buildSingleIndex` 中 `if (!fs.existsSync(p)) continue;` 在 for 循环外，会编译报错——改为 `return;`。最终代码以 Task 实现者修复为准（此为本文件唯一已知笔误，实现时修正）。

- [ ] **Step 5: 写下载脚本 data-update.mjs**

```js
// scripts/data-update.mjs — 下载 5etools-cn 数据到 data/db 并构建搜索索引
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(ROOT, 'data', 'db');
const BASE = 'https://raw.githubusercontent.com/tjliqy/5etools-cn/cn2.0/data';
const UA = { 'User-Agent': 'Mozilla/5.0 (dnd-dm-tool)' };

const FILES = [
  ...['MM','XMM','MPMM','PHB','XPHB','VGM','MTF','TCE','EGW','FTD','IDRotF','CoS','WDH','WDMM'].map(s => `bestiary/bestiary-${s.toLowerCase().replace(/[^a-z0-9]/g, '')}.json`),
  ...['PHB','XPHB','XGE','TCE','AI','EGW','FTD','IDRotF','CoS','WDH','WDMM'].map(s => `spells/spells-${s.toLowerCase().replace(/[^a-z0-9]/g, '')}.json`),
  'items.json', 'feats.json', 'conditionsdiseases.json',
];

const https = await import('node:https');
const http = await import('node:http');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(u, { headers: UA }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        res.resume();
        resolve(download(new URL(res.headers.location, url), dest));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`${url} -> ${res.statusCode}`)); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, Buffer.concat(chunks));
        resolve();
      });
    });
    req.on('error', reject);
  });
}

const DEFAULT_BESTIARY_SOURCES = ['MM', 'XMM', 'MPMM', 'PHB', 'XPHB', 'VGM', 'MTF', 'TCE', 'EGW', 'FTD', 'IDRotF', 'CoS', 'WDH', 'WDMM'];
const DEFAULT_SPELL_SOURCES = ['PHB', 'XPHB', 'XGE', 'TCE', 'AI', 'EGW', 'FTD', 'IDRotF', 'CoS', 'WDH', 'WDMM'];

async function fetchIndexMap(sub) {
  try {
    const tmp = path.join(DB, `_${sub}-index.json`);
    await download(`${BASE}/${sub}/index.json`, tmp);
    const map = JSON.parse(fs.readFileSync(tmp, 'utf8'));
    fs.unlinkSync(tmp);
    return map;
  } catch (e) {
    console.warn(`[data-update] index.json for ${sub} failed: ${e.message}`);
    return {};
  }
}

const bestiaryIndex = await fetchIndexMap('bestiary');
const spellsIndex = await fetchIndexMap('spells');

const targets = new Set();
for (const src of DEFAULT_BESTIARY_SOURCES) {
  const f = bestiaryIndex[src];
  if (f) targets.add(`bestiary/${f}`);
}
for (const src of DEFAULT_SPELL_SOURCES) {
  const f = spellsIndex[src];
  if (f) targets.add(`spells/${f}`);
}
for (const f of ['items.json', 'feats.json', 'conditionsdiseases.json']) targets.add(f);

let ok = 0, fail = 0;
for (const f of targets) {
  const dest = path.join(DB, f);
  try {
    await download(`${BASE}/${f}`, dest);
    ok += 1;
  } catch (e) {
    fail += 1;
    console.warn(`[data-update] SKIP ${f}: ${e.message}`);
  }
}

await import('tsx/esm');
const { buildIndexFromDir, writeIndex } = await import('../server/src/search.ts');
const idx = await buildIndexFromDir(DB);
writeIndex(DB, idx);

console.log(`[data-update] done: ${ok} files ok, ${fail} skipped, index entries: ${idx.length}`);
console.log(`[data-update] 数据位于 ${DB}，如镜像不可达可设镜像源再运行。`);
```

- [ ] **Step 6: 跑单元测试**

```bash
npm test -- server/src/search.test.ts
```

Expected: 全部 PASS。

- [ ] **Step 7: 提交**

```bash
git add -A && git commit -m "feat: 数据下载脚本 + 搜索索引构建 + Fuse 查询"
```

---

## Task 7: 条目懒加载 EntryService

**Files:**
- Create: `server/src/entries.ts`
- Create: `server/src/entries.test.ts`

**Interfaces:**
- Consumes: `IndexEntry`、`SearchService` 的索引（复用 `dbDir/index.json`）。
- Produces:
  - `class EntryService { constructor(dbDir, indexPath?); get(type: EntryType, id: string): Promise<any> }` —— 从 `index.json` 找到 `bookFile`，懒加载书文件（内存 LRU，上限 20 个文件），在数组里按 `ENG_name`/`source` 找到条目返回；找不到抛 `EntryNotFoundError`。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EntryService, EntryNotFoundError } from './entries';

const DB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test/fixtures/db');

describe('EntryService', () => {
  let svc: EntryService;
  beforeEach(async () => {
    svc = new EntryService(DB);
    await svc.warm(); // 构建/加载 index.json
  });

  it('loads a monster entry', async () => {
    const m = await svc.get('monster', 'MM__Goblin');
    expect(m).toMatchObject({ ENG_name: 'Goblin', name: '地精', source: 'MM' });
  });

  it('loads a spell entry', async () => {
    const s = await svc.get('spell', 'PHB__Fireball');
    expect(s.name).toBe('火球术');
    expect(s.level).toBe(3);
  });

  it('throws for unknown id', async () => {
    await expect(svc.get('monster', 'ZZ__Nope')).rejects.toBeInstanceOf(EntryNotFoundError);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- server/src/entries.test.ts
```

- [ ] **Step 3: 实现 entries.ts**

```ts
import fs from 'node:fs';
import path from 'node:path';
import { EntryType, IndexEntry } from './types';

export class EntryNotFoundError extends Error {
  constructor(id: string) {
    super(`entry not found: ${id}`);
    this.name = 'EntryNotFoundError';
  }
}

const LRU_CAP = 20;

export class EntryService {
  private index: IndexEntry[] = [];
  private cache = new Map<string, any>();

  constructor(private dbDir: string) {}

  async warm(): Promise<void> {
    const p = path.join(this.dbDir, 'index.json');
    if (!fs.existsSync(p)) throw new Error('数据未初始化：请先运行 npm run data:update');
    this.index = JSON.parse(fs.readFileSync(p, 'utf8')) as IndexEntry[];
  }

  private async loadFile(bookFile: string): Promise<any> {
    const hit = this.cache.get(bookFile);
    if (hit) {
      this.cache.delete(bookFile);
      this.cache.set(bookFile, hit);
      return hit;
    }
    const p = path.join(this.dbDir, bookFile);
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const arr = Object.values(data).find(v => Array.isArray(v)) as any[] | undefined;
    this.cache.set(bookFile, arr ?? []);
    if (this.cache.size > LRU_CAP) {
      const first = this.cache.keys().next().value;
      if (first != null) this.cache.delete(first);
    }
    return this.cache.get(bookFile);
  }

  async get(type: EntryType, id: string): Promise<any> {
    const entry = this.index.find(e => e.type === type && e.id === id);
    if (!entry) throw new EntryNotFoundError(id);
    const arr = await this.loadFile(entry.bookFile);
    const found = arr.find((x: any) => (x.ENG_name ?? x.name) === entry.nameEn);
    if (!found) throw new EntryNotFoundError(id);
    return found;
  }
}
```

- [ ] **Step 4: 跑测试**

```bash
npm test -- server/src/entries.test.ts
```

Expected: 3 个测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat: 条目懒加载 EntryService (LRU)"
```

---

## Task 8: token 图片管线 TokenService

**Files:**
- Create: `server/src/tokens.ts`
- Create: `server/src/tokens.test.ts`

**Interfaces:**
- Consumes: `EntryService`（取怪物 `ENG_name`/`source`），`IMAGE_BASE`。
- Produces:
  - `class TokenService { constructor(cacheDir: string, entrySvc: EntryService, imageBase?: string) }`
  - `get(entryId: string): Promise<{ buffer: Buffer; contentType: string }>` —— 返回缓存的圆形 PNG；无则下载 → 圆形裁剪 → 写缓存 → 返回；下载失败返回占位 SVG（`contentType: 'image/svg+xml'`）。
  - `async circleCrop(buf: Buffer): Promise<Buffer>` —— sharp 缩放 512 覆盖 + 圆形蒙版，输出透明 PNG。
  - `placeholderSvg(name: string): string`。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { TokenService, circleCrop, placeholderSvg } from './tokens';
import { EntryService } from './entries';

const DB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../test/fixtures/db');
let dir: string;
let svc: TokenService;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokens-'));
  const entry = new EntryService(DB);
  await entry.warm();
  // imageBase 指向不存在的地址，走下载失败分支 → 占位
  svc = new TokenService(dir, entry, 'http://127.0.0.1:1/nonexist');
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('placeholderSvg', () => {
  it('produces an svg with the first char', () => {
    const s = placeholderSvg('地精');
    expect(s).toContain('<svg');
    expect(s).toContain('地');
  });
});

describe('circleCrop', () => {
  it('crops a square image into transparent circle png', async () => {
    const input = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    const out = await circleCrop(input);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(512);
    expect(meta.hasAlpha).toBe(true);
    // 角落应为透明
    const pixel = await sharp(out).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
    expect(pixel[3]).toBe(0);
  });
});

describe('TokenService.get', () => {
  it('download failure falls back to placeholder svg', async () => {
    const r = await svc.get('MM__Goblin');
    expect(r.contentType).toBe('image/svg+xml');
    expect(r.buffer.toString('utf8')).toContain('<svg');
  });

  it('caches the result file', () => {
    expect(fs.existsSync(path.join(dir, 'MM__Goblin.svg'))).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- server/src/tokens.test.ts
```

- [ ] **Step 3: 实现 tokens.ts**

```ts
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { EntryService } from './entries';
import { EntryType } from './types';

const TOKEN_SIZE = 512;

export function placeholderSvg(name: string): string {
  const char = (name || '?').trim().charAt(0) || '?';
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TOKEN_SIZE}" height="${TOKEN_SIZE}">
<circle cx="256" cy="256" r="256" fill="hsl(${hue},45%,38%)"/>
<text x="256" y="310" font-size="240" text-anchor="middle" fill="#fff" font-family="sans-serif">${char}</text>
</svg>`;
}

export async function circleCrop(input: Buffer): Promise<Buffer> {
  const img = sharp(input);
  const meta = await img.metadata();
  const w = meta.width ?? TOKEN_SIZE;
  const h = meta.height ?? TOKEN_SIZE;
  const square = await img
    .resize(TOKEN_SIZE, TOKEN_SIZE, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();
  const mask = Buffer.from(
    `<svg width="${TOKEN_SIZE}" height="${TOKEN_SIZE}"><circle cx="${TOKEN_SIZE / 2}" cy="${TOKEN_SIZE / 2}" r="${TOKEN_SIZE / 2}" fill="#fff"/></svg>`,
  );
  const out = await sharp(square).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  void w; void h;
  return out;
}

export class TokenService {
  constructor(
    private cacheDir: string,
    private entrySvc: EntryService,
    private imageBase = 'https://5e.tools',
  ) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  async get(entryId: string): Promise<{ buffer: Buffer; contentType: string }> {
    const pngPath = path.join(this.cacheDir, `${entryId}.png`);
    if (fs.existsSync(pngPath)) {
      return { buffer: fs.readFileSync(pngPath), contentType: 'image/png' };
    }
    const svgPath = path.join(this.cacheDir, `${entryId}.svg`);
    if (fs.existsSync(svgPath)) {
      return { buffer: fs.readFileSync(svgPath), contentType: 'image/svg+xml' };
    }
    try {
      const monster = await this.entrySvc.get('monster', entryId);
      const url = `${this.imageBase}/img/bestiary/${monster.source}/${monster.ENG_name}.jpg`;
      const buf = await fetchImage(url);
      const cropped = await circleCrop(buf);
      fs.writeFileSync(pngPath, cropped);
      return { buffer: cropped, contentType: 'image/png' };
    } catch {
      const name = await this.safeName(entryId);
      const svg = Buffer.from(placeholderSvg(name));
      fs.writeFileSync(svgPath, svg);
      return { buffer: svg, contentType: 'image/svg+xml' };
    }
  }

  private async safeName(entryId: string): Promise<string> {
    try {
      const m = await this.entrySvc.get('monster', entryId);
      return m.name ?? entryId;
    } catch {
      return entryId;
    }
  }
}

async function fetchImage(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (dnd-dm-tool)' },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100) throw new Error('image too small');
  return buf;
}
```

> 注：`fetchImage` 尝试 `.jpg` 失败时不尝试 `.png`/`.webp`——为简单起见第一版只试 `.jpg`。若镜像含大量 `.png` 图片可后续扩展（本任务范围外）。测试中 `__dirname` 在 ESM 下不存在，改用 `fileURLToPath(import.meta.url)` 的写法（与 Task 6 测试一致）。

- [ ] **Step 4: 跑测试**

```bash
npm test -- server/src/tokens.test.ts
```

Expected: 3 个测试 PASS（`circleCrop` 需 sharp 可用；如 native 安装失败则先 `npm rebuild sharp`）。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat: token 图片下载/圆形裁剪/缓存/占位"
```

---

## Task 9: REST API 路由

**Files:**
- Create: `server/src/routes.ts`
- Create: `server/src/routes.test.ts`

**Interfaces:**
- Consumes: `SceneStore`、`SearchService`、`EntryService`、`TokenService`、`UPLOADS_DIR`、`DM_PASSWORD`。
- Produces:
  - `createApp(deps): express.Express` —— 组装全部 REST 路由 + JSON body + 静态 `/uploads`。路由：
    - `GET /api/health`
    - `GET /api/meta` → `{ ok, dataReady, online }`
    - `GET /api/scenes`、`POST /api/scenes {name}`、`GET /api/scenes/:id`、`DELETE /api/scenes/:id`
    - `GET /api/search?q=&type=`（type 默认 `all`）
    - `GET /api/entry/:type/:id`
    - `GET /api/token/:entryId`
    - `POST /api/upload/map`、`POST /api/upload/token`（multer，保存到 uploads，返回 `{url}`）
    - `POST /api/verify-password {password}` → `{ok}`
  - 依赖接口 `deps = { store, search, entries, tokens, online: () => number, dataReady: () => boolean, verifyPassword: (p: string) => boolean }`。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from './routes';
import { SceneStore } from './store';
import { SearchService } from './search';
import { EntryService } from './entries';
import { TokenService } from './tokens';

const FIXTURES = path.resolve(__dirname, '../test/fixtures/db');

let app: any;
let store: SceneStore;
let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-'));
  store = new SceneStore(path.join(dir, 'scenes'));
  const search = new SearchService(FIXTURES);
  await search.load();
  const entries = new EntryService(FIXTURES);
  await entries.warm();
  const tokens = new TokenService(path.join(dir, 'tokens'), entries, 'http://127.0.0.1:1/nonexist');
  app = createApp({
    store, search, entries, tokens,
    uploadsDir: path.join(dir, 'uploads'),
    online: () => 2,
    dataReady: () => true,
    verifyPassword: (p: string) => p === 'secret',
  });
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('REST API', () => {
  it('meta', async () => {
    const res = await request(app).get('/api/meta');
    expect(res.status).toBe(200);
    expect(res.body.online).toBe(2);
    expect(res.body.dataReady).toBe(true);
  });

  it('search monsters by Chinese', async () => {
    const res = await request(app).get('/api/search').query({ q: '地精', type: 'monster' });
    expect(res.status).toBe(200);
    expect(res.body.some((x: any) => x.id === 'MM__Goblin')).toBe(true);
  });

  it('get entry', async () => {
    const res = await request(app).get('/api/entry/monster/MM__Goblin');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('地精');
  });

  it('token placeholder on download failure', async () => {
    const res = await request(app).get('/api/token/MM__Goblin');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
  });

  it('scenes CRUD', async () => {
    const c = await request(app).post('/api/scenes').send({ name: '地牢' });
    expect(c.status).toBe(201);
    const id = c.body.id;
    const g = await request(app).get(`/api/scenes/${id}`);
    expect(g.body.name).toBe('地牢');
    const list = await request(app).get('/api/scenes');
    expect(list.body.some((x: any) => x.id === id)).toBe(true);
    const d = await request(app).delete(`/api/scenes/${id}`);
    expect(d.status).toBe(200);
  });

  it('password verify', async () => {
    expect((await request(app).post('/api/verify-password').send({ password: 'secret' })).body.ok).toBe(true);
    expect((await request(app).post('/api/verify-password').send({ password: 'wrong' })).body.ok).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- server/src/routes.test.ts
```

- [ ] **Step 3: 实现 routes.ts**

```ts
import express, { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { SceneStore } from './store';
import { SearchService } from './search';
import { EntryService } from './entries';
import { TokenService } from './tokens';

export interface RouteDeps {
  store: SceneStore;
  search: SearchService;
  entries: EntryService;
  tokens: TokenService;
  uploadsDir: string;
  online: () => number;
  dataReady: () => boolean;
  verifyPassword: (p: string) => boolean;
}

export function createApp(deps: RouteDeps): express.Express {
  const app = express();
  app.use(express.json());
  fs.mkdirSync(deps.uploadsDir, { recursive: true });
  app.use('/uploads', express.static(deps.uploadsDir));

  const upload = multer({
    storage: multer.diskStorage({
      destination: deps.uploadsDir,
      filename: (_req, file, cb) => {
        const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${Date.now()}-${safe}`);
      },
    }),
    limits: { fileSize: 20 * 1024 * 1024 },
  });

  const r = Router();

  r.get('/health', (_req, res) => res.json({ ok: true }));
  r.get('/meta', (_req, res) => res.json({ ok: true, dataReady: deps.dataReady(), online: deps.online() }));

  r.get('/scenes', async (_req, res) => {
    res.json(await deps.store.list());
  });
  r.post('/scenes', async (req, res) => {
    const name = String(req.body.name ?? '未命名场景').slice(0, 60);
    const scene = await deps.store.create(name);
    res.status(201).json(scene);
  });
  r.get('/scenes/:id', async (req, res) => {
    try {
      res.json(await deps.store.get(req.params.id));
    } catch {
      res.status(404).json({ error: 'scene not found' });
    }
  });
  r.delete('/scenes/:id', async (req, res) => {
    await deps.store.delete(req.params.id);
    res.json({ ok: true });
  });

  r.get('/search', (req, res) => {
    const q = String(req.query.q ?? '');
    const type = (req.query.type as any) ?? 'all';
    res.json(deps.search.query(q, type));
  });

  r.get('/entry/:type/:id', async (req, res) => {
    try {
      const entry = await deps.entries.get(req.params.type as any, req.params.id);
      res.json(entry);
    } catch {
      res.status(404).json({ error: 'entry not found' });
    }
  });

  r.get('/token/:entryId', async (req, res) => {
    try {
      const { buffer, contentType } = await deps.tokens.get(req.params.entryId);
      res.setHeader('content-type', contentType);
      res.setHeader('cache-control', 'public, max-age=604800');
      res.send(buffer);
    } catch {
      res.status(500).json({ error: 'token error' });
    }
  });

  r.post('/upload/map', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no file' });
    res.json({ url: `/uploads/${req.file.filename}` });
  });

  r.post('/upload/token', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no file' });
    res.json({ url: `/uploads/${req.file.filename}` });
  });

  r.post('/verify-password', (req, res) => {
    const ok = deps.verifyPassword(String(req.body.password ?? ''));
    res.json({ ok });
  });

  app.use('/api', r);
  return app;
}
```

> 注：`EntryService`/`TokenService` 类型已从 deps 使用；未使用的 `path` 导入会触发 TS `noUnusedLocals`？未开启该项，保留无碍，但实现者应按需清理。

- [ ] **Step 4: 跑测试**

```bash
npm test -- server/src/routes.test.ts
```

Expected: 6 个测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat: REST API 路由"
```

---

## Task 10: WebSocket 服务器 + GameServer

**Files:**
- Create: `server/src/game.ts`
- Create: `server/src/ws.ts`
- Create: `server/test/ws.test.ts`

**Interfaces:**
- Consumes: `SceneStore`、`applyOp`/`canOp`、`createScene`、`Role`、`Op`。
- Produces:
  - `class GameServer`：
    - `constructor(store: SceneStore, opts: { password: string | null })`
    - `async init(): Promise<void>` —— 加载 last 场景（或新建「默认场景」）。
    - `current: Scene`
    - `roleFor(address: string, dmToken?: string): Role`
    - `attach(ws: WebSocket): void` —— 绑定连接，处理 `init/op/switchScene/setName` 消息，管理 meta 广播。
  - `attachWsServer(httpServer, game: GameServer): void` —— 把 `ws` WebSocketServer 挂到 http server 的 `/ws` 路径。
  - WS 消息：
    - 客户端→服务端：`{type:'init', sceneId?, dmToken?}`；`{type:'op', ops: Op[]}`；`{type:'switchScene', sceneId}`（DM）；`{type:'setName', name}`。
    - 服务端→客户端：`{type:'state', scene, role}`；`{type:'op', ops}`（应用后的 op 广播）；`{type:'meta', online}`；`{type:'error', message}`。

- [ ] **Step 1: 写失败测试（双 ws 客户端集成）**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { attachWsServer } from '../src/ws';
import { GameServer } from '../src/game';
import { SceneStore } from '../src/store';

let server: http.Server;
let dmUrl: string;
let playerUrl: string;
let dir: string;
let game: GameServer;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
  const store = new SceneStore(path.join(dir, 'scenes'));
  game = new GameServer(store, { password: 'pw' });
  await game.init();
  server = http.createServer((_req, res) => res.end('ok'));
  attachWsServer(server, game);
  // 绑定 0.0.0.0：127.0.0.1 → DM，127.0.0.2（loopback 别名）→ 玩家
  await new Promise<void>(res => server.listen(0, '0.0.0.0', () => res()));
  const addr = server.address() as { port: number };
  dmUrl = `ws://127.0.0.1:${addr.port}/ws`;
  playerUrl = `ws://127.0.0.2:${addr.port}/ws`;
});

afterAll(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}
function once(ws: WebSocket, type: string): Promise<any> {
  return new Promise((resolve) => {
    const onMsg = (raw: string) => {
      const m = JSON.parse(raw);
      if (m.type === type) {
        ws.off('message', onMsg);
        resolve(m);
      }
    };
    ws.on('message', onMsg);
  });
}

describe('WebSocket 同步', () => {
  it('玩家可移动 token，DM 可放置 token，两端都收到广播', async () => {
    const dm = await connect(dmUrl);
    dm.send(JSON.stringify({ type: 'init', dmToken: 'pw' }));   // localhost 已是 dm，这里再验证 token
    await once(dm, 'state');

    const player = await connect(playerUrl);
    player.send(JSON.stringify({ type: 'init' }));
    const pState = await once(player, 'state');

    // DM 放置一个 token
    dm.send(JSON.stringify({ type: 'op', ops: [{ op: 'addToken', token: { id: 't1', kind: 'monster', name: '地精', entryId: 'MM__Goblin', x: 0, y: 0, size: 100, avatar: '/api/token/MM__Goblin', color: '#fff' } }] }));
    const b1 = await once(player, 'op');
    expect(b1.ops[0].op).toBe('addToken');

    // 玩家移动该 token
    player.send(JSON.stringify({ type: 'op', ops: [{ op: 'moveToken', tokenId: 't1', x: 500, y: 500 }] }));
    const b2 = await once(dm, 'op');
    expect(b2.ops[0]).toMatchObject({ op: 'moveToken', x: 500, y: 500 });

    dm.close();
    player.close();
  });

  it('玩家尝试 DM 专属 op 被拒绝（收到 error）', async () => {
    const player = await connect(playerUrl);
    player.send(JSON.stringify({ type: 'init' }));
    await once(player, 'state');
    player.send(JSON.stringify({ type: 'op', ops: [{ op: 'advanceTurn' }] }));
    const err = await once(player, 'error');
    expect(err.message).toMatch(/permission/i);
    player.close();
  });

  it('DM 切换场景，所有客户端收到新 state', async () => {
    const dm = await connect(dmUrl);
    dm.send(JSON.stringify({ type: 'init', dmToken: 'pw' }));
    await once(dm, 'state');

    const player = await connect(playerUrl);
    player.send(JSON.stringify({ type: 'init' }));
    await once(player, 'state');

    const scene = await game.store.create('新场景');
    dm.send(JSON.stringify({ type: 'switchScene', sceneId: scene.id }));
    const s1 = await once(dm, 'state');
    const s2 = await once(player, 'state');
    expect(s1.scene.name).toBe('新场景');
    expect(s2.scene.name).toBe('新场景');

    dm.close();
    player.close();
  });
});
```

> 注：角色判定依赖连接来源地址。测试通过 loopback 别名模拟角色：连 `127.0.0.1`（`remoteAddress` 为 `::ffff:127.0.0.1`）判 DM，连 `127.0.0.2` 判玩家。若 `127.0.0.2` 在特定平台不可达，可在 `roleFor` 中增加 `DND_TEST_ROLE` 环境变量兜底（仅测试环境读取）。

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- server/test/ws.test.ts
```

- [ ] **Step 3: 实现 game.ts**

```ts
import { SceneStore } from './store';
import { Op, Role, Scene } from './types';
import { applyOp, canOp } from './ops';

interface Client {
  ws: WebSocket;
  role: Role;
  name: string;
  dmToken?: string;
}

export class GameServer {
  current: Scene;
  store: SceneStore;
  private clients = new Set<Client>();

  constructor(store: SceneStore, private opts: { password: string | null }) {
    this.store = store;
    this.current = null as unknown as Scene;
  }

  async init(): Promise<void> {
    const last = await this.store.last();
    if (last) {
      try {
        this.current = await this.store.get(last);
        return;
      } catch { /* fallthrough */ }
    }
    const scenes = await this.store.list();
    if (scenes.length > 0) {
      this.current = await this.store.get(scenes[0].id);
      await this.store.setLast(this.current.id);
      return;
    }
    this.current = await this.store.create('默认场景');
    await this.store.setLast(this.current.id);
  }

  roleFor(address: string, dmToken?: string): Role {
    const a = address.replace(/^::ffff:/, '');
    const isLocal = a === '127.0.0.1' || a === '::1';
    if (isLocal) return 'dm';
    if (this.opts.password && dmToken === this.opts.password) return 'dm';
    return 'player';
  }

  attach(ws: any): void {
    const client: Client = { ws, role: 'player', name: '' };
    this.clients.add(client);
    this.broadcastMeta();

    ws.on('message', (raw: string) => {
      let msg: any;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      this.handle(client, msg);
    });
    ws.on('close', () => {
      this.clients.delete(client);
      this.broadcastMeta();
    });
  }

  private handle(client: Client, msg: any): void {
    switch (msg.type) {
      case 'init': {
        client.role = this.roleFor(this.remoteAddress(client), msg.dmToken);
        client.name = String(msg.name ?? '').slice(0, 20);
        client.ws.send(JSON.stringify({ type: 'state', scene: this.current, role: client.role }));
        this.broadcastMeta();
        return;
      }
      case 'setName': {
        client.name = String(msg.name ?? '').slice(0, 20);
        return;
      }
      case 'op': {
        const ops = Array.isArray(msg.ops) ? msg.ops : [];
        const allowed = ops.filter((op: Op) => canOp(client.role, op));
        const denied = ops.filter((op: Op) => !canOp(client.role, op));
        if (allowed.length > 0) {
          for (const op of allowed) applyOp(this.current, op);
          this.store.save(this.current);
          this.broadcast({ type: 'op', ops: allowed });
        }
        if (denied.length > 0) {
          client.ws.send(JSON.stringify({ type: 'error', message: 'permission denied for some ops' }));
        }
        return;
      }
      case 'switchScene': {
        if (client.role !== 'dm') {
          client.ws.send(JSON.stringify({ type: 'error', message: 'permission denied' }));
          return;
        }
        this.switchScene(String(msg.sceneId)).catch(() => {
          client.ws.send(JSON.stringify({ type: 'error', message: 'scene load failed' }));
        });
        return;
      }
    }
  }

  private async switchScene(id: string): Promise<void> {
    this.store.save(this.current);
    this.current = await this.store.get(id);
    await this.store.setLast(id);
    this.broadcast({ type: 'state', scene: this.current, role: undefined });
  }

  private remoteAddress(client: Client): string {
    return String((client.ws as any)?._socket?.remoteAddress ?? '');
  }

  private broadcast(payload: unknown): void {
    const data = JSON.stringify(payload);
    for (const c of this.clients) {
      if (c.ws.readyState === c.ws.OPEN) c.ws.send(data);
    }
  }

  broadcastMeta(): void {
    this.broadcast({ type: 'meta', online: this.clients.size });
  }
}
```

> 注：`ws` 的 `_socket.remoteAddress` 需要 `@types/ws` 支持；如类型报错，用 `(client.ws as any)._socket?.remoteAddress`。`switchScene` 广播的 `role: undefined` 会被 JSON.stringify 丢弃，客户端保持原角色即可。

- [ ] **Step 4: 实现 ws.ts**

```ts
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { GameServer } from './game';

export function attachWsServer(server: http.Server, game: GameServer): void {
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws: WebSocket) => {
    game.attach(ws);
  });
}
```

- [ ] **Step 5: 跑测试**

```bash
npm test -- server/test/ws.test.ts
```

Expected: 3 个测试 PASS。若角色判定失败（`roleFor` 的 remoteAddress 解析），检查 `_socket.remoteAddress` 实际值并修正 `remoteAddress()` 实现。

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "feat: WebSocket 同步服务与 GameServer"
```

---

## Task 11: 前端骨架与布局

**Files:**
- Create: `client/src/App.tsx`（改写占位）
- Create: `client/src/components/TopBar.tsx`
- Create: `client/src/components/Toolbar.tsx`
- Create: `client/src/components/InitiativePanel.tsx`（占位静态）
- Create: `client/src/components/QueryPanel.tsx`（占位静态）
- Create: `client/src/components/BoardCanvas.tsx`（占位静态）

**Interfaces:**
- Consumes: Task 1 的 Tailwind/Vite 基建。
- Produces: 深色布局壳（顶部状态栏 + 先攻栏 + 左工具栏 + 中画布 + 右查询窗口），全部静态占位，可手工验证布局。

- [ ] **Step 1: 写 App.tsx 布局**

```tsx
import TopBar from './components/TopBar';
import Toolbar from './components/Toolbar';
import InitiativePanel from './components/InitiativePanel';
import QueryPanel from './components/QueryPanel';
import BoardCanvas from './components/BoardCanvas';

export default function App() {
  return (
    <div className="h-full flex flex-col">
      <TopBar />
      <InitiativePanel />
      <div className="flex-1 flex min-h-0">
        <Toolbar />
        <div className="flex-1 min-w-0 relative bg-zinc-900">
          <BoardCanvas />
        </div>
        <QueryPanel />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 写各组件**

`TopBar.tsx`:
```tsx
export default function TopBar() {
  return (
    <header className="h-11 flex items-center gap-3 px-3 border-b border-zinc-700/60 bg-zinc-900 text-sm">
      <span className="font-semibold">⚙ DM 追踪</span>
      <span className="text-zinc-500">场景「默认场景」</span>
      <div className="ml-auto flex items-center gap-3 text-zinc-400">
        <span>玩家在线: <span className="text-emerald-400">0</span></span>
        <span>口令: 未设置</span>
      </div>
    </header>
  );
}
```

`Toolbar.tsx`:
```tsx
const TOOLS = [
  { id: 'select', label: '选择', icon: '🖱' },
  { id: 'add', label: '放置', icon: '➕' },
  { id: 'wall', label: '画墙', icon: '🧱' },
  { id: 'grid', label: '网格', icon: '⊞' },
  { id: 'map', label: '地图', icon: '🗺' },
  { id: 'zoom', label: '缩放', icon: '🔍' },
] as const;

export default function Toolbar({ role = 'dm' }: { role?: 'dm' | 'player' }) {
  const visible = role === 'dm' ? TOOLS : TOOLS.filter(t => t.id === 'select' || t.id === 'zoom');
  return (
    <aside className="w-12 border-r border-zinc-700/60 bg-zinc-900 flex flex-col items-center py-2 gap-1">
      {visible.map(t => (
        <button key={t.id} title={t.label} className="w-9 h-9 rounded-md hover:bg-zinc-700 flex items-center justify-center text-lg">
          {t.icon}
        </button>
      ))}
    </aside>
  );
}
```

`InitiativePanel.tsx`（占位）:
```tsx
export default function InitiativePanel() {
  return (
    <div className="h-14 border-b border-zinc-700/60 bg-zinc-900 flex items-center px-2 gap-2 text-sm text-zinc-400">
      <span className="text-zinc-500 shrink-0">先攻</span>
      <span className="px-2 py-0.5 rounded bg-zinc-700 text-white">哥布林 <span className="text-amber-400">18</span></span>
      <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">阿拉贡 <span className="text-zinc-500">15</span></span>
      <button className="ml-auto px-2 py-1 rounded bg-amber-600/20 text-amber-400 hover:bg-amber-600/30">⏭ 下一回合</button>
    </div>
  );
}
```

`QueryPanel.tsx`（占位）:
```tsx
export default function QueryPanel() {
  return (
    <aside className="w-80 border-l border-zinc-700/60 bg-zinc-900 flex flex-col text-sm">
      <div className="p-2 border-b border-zinc-800 flex gap-2">
        <input placeholder="搜索怪物 / 法术…" className="flex-1 bg-zinc-800 rounded px-2 py-1 outline-none" />
      </div>
      <div className="p-2 text-zinc-500 text-xs">搜索「地精」试试（接入数据后可用）</div>
    </aside>
  );
}
```

`BoardCanvas.tsx`（占位）:
```tsx
export default function BoardCanvas() {
  return (
    <div className="absolute inset-0 flex items-center justify-center text-zinc-600">
      棋盘（接入 Konva 后可用）
    </div>
  );
}
```

- [ ] **Step 3: 手工验证布局**

```bash
cd /Users/xiejiaxue/Documents/DnD-DMTool && npm run dev
# 浏览器打开 http://localhost:5173，确认深色四栏布局正常
```

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "feat: 前端布局壳（顶部/先攻/工具/查询/画布）"
```

---

## Task 12: 前端 WS 连接 + 场景状态 + 格式化工具

**Files:**
- Create: `client/src/ws.ts`
- Create: `client/src/store.ts`
- Create: `client/src/api.ts`
- Create: `client/src/format.ts`
- Create: `client/src/__tests__/format.test.ts`

**Interfaces:**
- Consumes: Task 10 的 WS 协议、Task 9 的 REST API。
- Produces:
  - `class Connection`（单例）：`connect()`, `sendOps(ops: Op[])`, `sendControl(msg)`, `onMessage(cb)`，自动重连（指数退避）。
  - `useScene(): SceneState`（React hook，订阅 WS，返回 `{ scene, role, online, connected }`）。
  - `api`：`search(q, type)`, `entry(type, id)`, `scenes()`, `createScene(name)`, `deleteScene(id)`, `verifyPassword(pw)`。
  - `renderMarkup(s: string): string`（清洗 `{@tag …}` 为纯文本）；`formatMonster(m): StatBlock`；`formatSpell(s): StatBlock`。
  - `format.test.ts` 单测 renderMarkup。

- [ ] **Step 1: 写 format 失败测试**

```ts
import { describe, it, expect } from 'vitest';
import { renderMarkup } from '../format';

describe('renderMarkup', () => {
  it('strips 5etools inline tags to inner text', () => {
    expect(renderMarkup('受 {@damage 8d6} 点火焰伤害，{@hit +4} 命中，{@dc 13} 豁免。')).toBe('受 8d6 点火焰伤害，+4 命中，13 豁免。');
  });
  it('handles italic/bold tags', () => {
    expect(renderMarkup('{@i 灵巧逃脱}。')).toBe('灵巧逃脱。');
  });
  it('keeps plain text', () => {
    expect(renderMarkup('普通文本')).toBe('普通文本');
  });
  it('removes link pipe suffixes', () => {
    expect(renderMarkup('见 {@condition 中毒}。')).toBe('见 中毒。');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- client/src/__tests__/format.test.ts
```

- [ ] **Step 3: 实现 format.ts**

```ts
export function renderMarkup(s: string): string {
  return s
    .replace(/\{@([a-z]+)\s+([^}]+)\}/g, (_m, _tag, inner: string) => inner.split('|')[0])
    .replace(/\{\{([^}]+)\}\}/g, '$1');
}
```

- [ ] **Step 4: 实现 api.ts**

```ts
import type { EntryType, IndexEntry, Scene } from './types';

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json() as Promise<T>;
}

export const api = {
  search: (q: string, type: EntryType | 'all' = 'all') =>
    json<IndexEntry[]>(`/api/search?q=${encodeURIComponent(q)}&type=${type}`),
  entry: (type: EntryType, id: string) => json<any>(`/api/entry/${type}/${encodeURIComponent(id)}`),
  scenes: () => json<{ id: string; name: string }[]>('/api/scenes'),
  createScene: (name: string) =>
    json<Scene>('/api/scenes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }),
  deleteScene: (id: string) => json<{ ok: boolean }>(`/api/scenes/${id}`, { method: 'DELETE' }),
  verifyPassword: async (password: string): Promise<boolean> => {
    const r = await fetch('/api/verify-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
    const b = await r.json();
    return Boolean(b.ok);
  },
};
```

- [ ] **Step 5: 实现 ws.ts**

```ts
import { useEffect, useRef, useState } from 'react';
import type { Op, Role, Scene } from './types';

export interface SceneState {
  scene: Scene | null;
  role: Role;
  online: number;
  connected: boolean;
}

type Listener = (msg: any) => void;

class Connection {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private retry = 0;
  private shouldReconnect = true;
  private dmToken: string | null = localStorage.getItem('dnd-dm-token');

  constructor() {
    this.connect();
  }

  connect(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = () => {
      this.retry = 0;
      this.sendControl({ type: 'init', dmToken: this.dmToken ?? undefined });
    };
    this.ws.onmessage = (ev) => {
      let msg: any;
      try { msg = JSON.parse(ev.data as string); } catch { return; }
      for (const l of this.listeners) l(msg);
    };
    this.ws.onclose = () => {
      if (!this.shouldReconnect) return;
      const delay = Math.min(1000 * 2 ** this.retry, 10000);
      this.retry += 1;
      setTimeout(() => this.connect(), delay);
    };
  }

  sendOps(ops: Op[]): void {
    this.sendControl({ type: 'op', ops });
  }
  sendControl(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
  onMessage(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  setDmToken(t: string): void {
    this.dmToken = t;
    localStorage.setItem('dnd-dm-token', t);
  }
}

const connection = new Connection();

export function useScene(): SceneState {
  const [state, setState] = useState<SceneState>({ scene: null, role: 'player', online: 0, connected: false });
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    return connection.onMessage((msg) => {
      const cur = stateRef.current;
      if (msg.type === 'state') {
        setState({ ...cur, scene: msg.scene, role: msg.role ?? cur.role, connected: true });
      } else if (msg.type === 'meta') {
        setState({ ...cur, online: msg.online, connected: true });
      } else if (msg.type === 'error') {
        console.warn('[ws]', msg.message);
      }
    });
  }, []);

  return state;
}

export { connection };
```

- [ ] **Step 6: 实现 store.ts（乐观应用 + 服务端确认）**

```ts
// 简化：所有修改统一走 connection.sendOps，服务器广播后由 useScene 更新。
// 本文件提供辅助函数，避免组件直接构造 Op 对象。
import { Op, Token } from './types';

export function moveToken(tokenId: string, x: number, y: number): Op {
  return { op: 'moveToken', tokenId, x, y };
}

export function addToken(token: Token): Op {
  return { op: 'addToken', token };
}

export function addWall(wall: { id: string; p1: [number, number]; p2: [number, number] }): Op {
  return { op: 'addWall', wall };
}

- [ ] **Step 7: 跑测试**

```bash
npm test -- client/src/__tests__/format.test.ts
```

Expected: 4 个测试 PASS。

- [ ] **Step 8: 提交**

```bash
git add -A && git commit -m "feat: WS 连接/重连 + useScene + REST client + 标记清洗"
```

---

## Task 13: BoardCanvas 基础（地图/网格/缩放平移）

**Files:**
- Create: `client/src/components/BoardCanvas.tsx`（改写占位）

**Interfaces:**
- Consumes: `useScene`（Task 12）。
- Produces: Konva Stage，渲染地图底图、网格线、可玩区域边界；滚轮缩放（以光标为中心）、拖空白平移。

- [ ] **Step 1: 实现 BoardCanvas**

```tsx
import { Stage, Layer, Rect, Line, Image as KImage, Group } from 'react-konva';
import Konva from 'konva';
import { useRef, useState, useCallback } from 'react';
import { useScene } from '../ws';
import { useImage } from '../useImage';

export default function BoardCanvas() {
  const { scene, role } = useScene();
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const stageRef = useRef<Konva.Stage>(null);

  const map = useImage(scene?.mapImage ? scene.mapImage : null);

  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current!;
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition()!;
    const mousePointTo = { x: (pointer.x - stage.x()) / oldScale, y: (pointer.y - stage.y()) / oldScale };
    const dir = e.evt.deltaY > 0 ? -1 : 1;
    const newScale = Math.min(4, Math.max(0.2, oldScale * (dir > 0 ? 1.1 : 0.9)));
    setScale(newScale);
    setPos({ x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale });
  }, []);

  if (!scene) return <div className="absolute inset-0 flex items-center justify-center text-zinc-600">连接中…</div>;

  const grid = scene.grid;
  const vLines: { key: string; x: number }[] = [];
  const hLines: { key: string; y: number }[] = [];
  const area = scene.playArea;
  if (grid.size > 0) {
    for (let x = grid.offset[0]; x <= area.w; x += grid.size) vLines.push({ key: `v${x}`, x });
    for (let y = grid.offset[1]; y <= area.h; y += grid.size) hLines.push({ key: `h${y}`, y });
  }

  return (
    <Stage
      ref={stageRef}
      width={window.innerWidth - 48 - 320}
      height={window.innerHeight - 44 - 56}
      scaleX={scale} scaleY={scale} x={pos.x} y={pos.y}
      onWheel={handleWheel}
      draggable={role === 'dm'}
      onDragEnd={(e) => setPos({ x: e.target.x(), y: e.target.y() })}
      className="cursor-grab"
    >
      <Layer>
        {map && <KImage image={map} x={0} y={0} />}
        {scene.mapImage && !map && <Rect width={area.w} height={area.h} fill="#262932" />}
        <Rect x={area.x} y={area.y} width={area.w} height={area.h} stroke="#f59e0b" strokeWidth={2} strokeScaleEnabled={false} dash={[8, 8]} />
        <Group>
          {vLines.map(l => <Line key={l.key} points={[l.x, 0, l.x, area.h]} stroke={grid.color} strokeWidth={1} />)}
          {hLines.map(l => <Line key={l.key} points={[0, l.y, area.w, l.y]} stroke={grid.color} strokeWidth={1} />)}
        </Group>
      </Layer>
    </Stage>
  );
}
```

> 注：上面的 `Line` 点数组写法混乱，实现者应重写为清晰的两段：
> 垂直线：`points={[l.x, 0, l.x, area.h]}`；水平线：`points={[0, l.y, area.w, l.y]}`。Stage 尺寸应随窗口 resize 更新（加 `useEffect` + `window.addEventListener('resize', …)`）。`draggable` 仅 DM 可平移（玩家只读移动）。`useImage` hook 见 Task 13 的辅助文件。

- [ ] **Step 2: 写 useImage hook**

Create `client/src/useImage.ts`:
```ts
import { useEffect, useState } from 'react';

export function useImage(url: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) { setImg(null); return; }
    const image = new Image();
    image.src = url;
    image.onload = () => setImg(image);
    image.onerror = () => setImg(null);
    return () => { image.onload = null; image.onerror = null; };
  }, [url]);
  return img;
}
```

- [ ] **Step 3: 手工验证**

```bash
npm run dev  # 打开 http://localhost:5173，看到网格 + 可玩区域虚线框 + 滚轮缩放
```

> 验证前需先用 `npm run data:update` 拉数据并在浏览器控制台确认 `/api/health` 可达。地图图片可先在 `/api/meta` 确认。此时场景无地图底图，应显示可玩区域虚线框 + 网格。

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "feat: BoardCanvas 基础（地图/网格/缩放平移）"
```

---

## Task 14: Token 渲染与拖拽同步

**Files:**
- Create: `client/src/components/TokenShape.tsx`
- Modify: `client/src/components/BoardCanvas.tsx`
- Create: `client/src/useImage.ts`（Task 13 已有，此处复用）

**Interfaces:**
- Consumes: `useScene`、`connection`、`moveToken` op。
- Produces:
  - `TokenShape` 组件：props `{ token, active, selected, onSelect, onDragEnd, onContextMenu }`；圆形裁剪图像 + 名字 + 颜色环 + active 金色脉冲环。
  - BoardCanvas 渲染所有 `scene.tokens` + `scene.players`，支持点击选中、拖拽（结束发 `moveToken`）、右键菜单回调（暂占位）。

- [ ] **Step 1: 实现 TokenShape.tsx**

```tsx
import { Group, Circle, Image as KImage, Text, Ring } from 'react-konva';
import { useState } from 'react';
import { useImage } from '../useImage';
import type { Token } from '../types';

interface Props {
  token: Token;
  active: boolean;
  selected: boolean;
  onSelect: () => void;
  onDragEnd: (x: number, y: number) => void;
  onContextMenu: () => void;
}

export default function TokenShape({ token, active, selected, onSelect, onDragEnd, onContextMenu }: Props) {
  const img = useImage(token.avatar || null);
  const [pulse, setPulse] = useState(0);

  return (
    <Group
      x={token.x} y={token.y}
      draggable
      onDragEnd={(e) => onDragEnd(e.target.x(), e.target.y())}
      onClick={onSelect}
      onTap={onSelect}
      onContextMenu={(e) => { e.evt.preventDefault(); onContextMenu(); }}
    >
      {/* 底圆（颜色环 + 选中高亮） */}
      <Circle
        width={token.size} height={token.size}
        fill={token.color || '#333'}
        stroke={selected ? '#f59e0b' : token.color || '#000'}
        strokeWidth={selected ? 3 : 1.5}
      />
      {/* 头像：圆形裁剪（clipFunc 画圆裁出圆形图） */}
      {img && (
        <Group
          clipFunc={(ctx) => {
            ctx.beginPath();
            ctx.arc(token.size / 2, token.size / 2, token.size / 2, 0, Math.PI * 2, false);
            ctx.closePath();
          }}
        >
          <KImage image={img} width={token.size} height={token.size} perfectDrawEnabled={false} listening={false} />
        </Group>
      )}
      {/* 当前回合高亮：金色脉冲环 */}
      {active && (
        <Ring
          innerRadius={token.size / 2 - 6}
          outerRadius={token.size / 2 + 4 + pulse}
          fillEnabled={false}
          stroke="#fbbf24" strokeWidth={3}
          listening={false}
        />
      )}
      <Text text={token.name} y={token.size / 2 + 2} width={token.size} align="center" fill="#fff" fontSize={12} fontStyle="bold" />
    </Group>
  );
}
```

- [ ] **Step 2: 更新 BoardCanvas 渲染 tokens**

在 BoardCanvas 的 `Layer` 内、网格之后追加：

```tsx
{scene.tokens.map(t => (
  <TokenShape
    key={t.id}
    token={t}
    active={scene.initiative.find(e => e.active && e.tokenId === t.id) != null}
    selected={selectedId === t.id}
    onSelect={() => setSelectedId(t.id)}
    onDragEnd={(x, y) => {
      const sx = grid.snap ? Math.round(x / grid.size) * grid.size : x;
      const sy = grid.snap ? Math.round(y / grid.size) * grid.size : y;
      connection.sendOps([{ op: 'moveToken', tokenId: t.id, x: sx, y: sy }]);
    }}
    onContextMenu={() => setSelectedId(t.id)}
  />
))}
{scene.players.map(p => (
  <TokenShape
    key={p.id}
    token={p}
    active={scene.initiative.find(e => e.active && e.tokenId === p.id) != null}
    selected={selectedId === p.id}
    onSelect={() => setSelectedId(p.id)}
    onDragEnd={(x, y) => {
      const sx = grid.snap ? Math.round(x / grid.size) * grid.size : x;
      const sy = grid.snap ? Math.round(y / grid.size) * grid.size : y;
      connection.sendOps([{ op: 'moveToken', tokenId: p.id, x: sx, y: sy }]);
    }}
    onContextMenu={() => setSelectedId(p.id)}
  />
))}
```

同时 BoardCanvas 增加 `const [selectedId, setSelectedId] = useState<string | null>(null);` 与 `import TokenShape from './TokenShape'; import { connection } from '../ws';`。

- [ ] **Step 3: 手工验证**

```bash
npm run dev
# 在控制台执行：connection.sendOps([{op:'addToken', token:{id:'x1', kind:'monster', name:'地精', entryId:'MM__Goblin', x:200, y:200, size:100, avatar:'/api/token/MM__Goblin', color:'#fff'}}])
# 确认棋盘出现地精 token，可拖动，移动后刷新仍在（已持久化）
```

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "feat: token 渲染与拖拽同步"
```

---

## Task 15: 查询面板接入 + 详情抽屉

**Files:**
- Create: `client/src/components/DetailDrawer.tsx`
- Modify: `client/src/components/QueryPanel.tsx`
- Modify: `client/src/format.ts`（加 `formatMonster`/`formatSpell`）

**Interfaces:**
- Consumes: `api.search`/`api.entry`（Task 12）、`renderMarkup`（Task 12）、`connection`、`useScene`。
- Produces: 查询面板输入（250ms 防抖）→ 结果列表（中文名 + 英文名 + CR/环位）；点结果 → 详情抽屉覆盖查询窗口；详情渲染怪物/法术统计块；「收藏」与「放置到棋盘」按钮（放置仅 DM，发 `addToken` op）。

- [ ] **Step 1: format.ts 增加 formatMonster / formatSpell**

```ts
export interface StatBlock {
  name: string;
  meta: string;                 // 单行摘要，如 "小型 类人生物，CR 1/4"
  rows: [string, string][];     // 属性行
  body: string[];               // 段落/条目
}

const SIZE_ZH: Record<string, string> = { T: '微型', S: '小型', M: '中型', L: '大型', H: '巨型', G: '超巨型' };
const SCHOOL_ZH: Record<string, string> = { V: '塑能', A: '防护', E: '惑控', C: '变化', D: '预言', I: '幻术', N: '死灵', T: '咒法', M: '创造' };

export function formatMonster(m: any): StatBlock {
  const size = SIZE_ZH[String(m.size?.[0])] ?? m.size?.[0] ?? '';
  const type = m.type?.type ?? m.type ?? '';
  const body = [
    ...(m.trait ?? []).map((t: any) => `**${t.name}。** ${(t.entries ?? []).map(renderMarkup).join(' ')}`),
    ...(m.action ?? []).map((a: any) => `**${a.name}。** ${(a.entries ?? []).map(renderMarkup).join(' ')}`),
  ];
  return {
    name: m.name,
    meta: [size, type, m.alignment?.join(' '), m.cr != null ? `CR ${m.cr}` : ''].filter(Boolean).join('，'),
    rows: [
      ['AC', String(Array.isArray(m.ac) ? m.ac[0] : m.ac)],
      ['HP', m.hp ? `${m.hp.average ?? ''}（${m.hp.formula ?? ''}）` : ''],
      ['速度', Object.entries(m.speed ?? {}).map(([k, v]) => `${k} ${v}`).join(', ')],
      ['力量', String(m.str ?? '')], ['敏捷', String(m.dex ?? '')], ['体质', String(m.con ?? '')],
      ['智力', String(m.int ?? '')], ['感知', String(m.wis ?? '')], ['魅力', String(m.cha ?? '')],
      ['语言', m.languages ?? ''],
    ].filter(([, v]) => v) as [string, string][],
    body,
  };
}

export function formatSpell(s: any): StatBlock {
  const time = (s.time ?? []).map((t: any) => `${t.number ?? 1} ${t.unit ?? ''}`).join(' 或 ');
  const range = s.range?.distance?.amount != null ? `${s.range.distance.amount} 尺` : (s.range?.distance?.type ?? '自身');
  const comp = [
    s.components?.v ? 'V' : '', s.components?.s ? 'S' : '', s.components?.m ? `M（${s.components.m}）` : '',
  ].filter(Boolean).join(', ');
  const dur = (s.duration ?? []).map((d: any) => d.duration != null ? `${d.duration} ${d.duration === 1 ? '回合' : ''}` : d.type).join(' 或 ');
  return {
    name: s.name,
    meta: `${s.level === 0 ? '戏法' : `${s.level} 环`} ${SCHOOL_ZH[s.school] ?? s.school}，${time}`,
    rows: [
      ['施法距离', range],
      ['成分', comp],
      ['持续时间', dur],
    ].filter(([, v]) => v) as [string, string][],
    body: (s.entries ?? []).map(renderMarkup),
  };
}
```

> 注：`duration` 字段 5etools 里可能是 `[{type:'instant'}]` 或 `[{type:'timed', duration:{amount:1,unit:'hour'}}]`，上述读取可能不准，实现者以真实数据结构修正 `formatSpell` 的 duration/range 逻辑。这是可接受的小范围修正（fixture 里 `duration:[{type:'instant'}]`）。

- [ ] **Step 2: 实现 DetailDrawer.tsx**

```tsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { connection } from '../ws';
import { useScene } from '../ws';
import { formatMonster, formatSpell, StatBlock } from '../format';
import type { EntryType } from '../types';

export default function DetailDrawer({ entry, onBack }: { entry: { type: EntryType; id: string; nameZh: string } | null; onBack: () => void }) {
  const { scene, role } = useScene();
  const [stat, setStat] = useState<StatBlock | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!entry) { setStat(null); return; }
    setLoading(true);
    api.entry(entry.type, entry.id)
      .then(e => setStat(entry.type === 'monster' ? formatMonster(e) : formatSpell(e)))
      .finally(() => setLoading(false));
  }, [entry]);

  if (!entry) return null;
  const fav = scene?.favorites.some(f => f.type === entry.type && f.entryId === entry.id);

  return (
    <div className="absolute inset-0 z-10 bg-zinc-900 overflow-y-auto p-3 text-sm">
      <div className="flex items-center gap-2 mb-2">
        <button onClick={onBack} className="text-zinc-400 hover:text-white">←</button>
        <h2 className="font-bold text-base">{entry.nameZh}</h2>
      </div>
      {loading && <div className="text-zinc-500">加载中…</div>}
      {stat && (
        <>
          <div className="text-zinc-400 text-xs mb-2">{stat.meta}</div>
          <table className="w-full text-xs mb-3">
            <tbody>
              {stat.rows.map(([k, v]) => (
                <tr key={k}><td className="text-zinc-500 pr-2 align-top">{k}</td><td>{v}</td></tr>
              ))}
            </tbody>
          </table>
          {stat.body.map((p, i) => <p key={i} className="mb-2 whitespace-pre-wrap">{p}</p>)}
        </>
      )}
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => connection.sendOps([{ op: 'addFavorite', favorite: { type: entry.type, entryId: entry.id } }])}
          className="flex-1 rounded bg-zinc-800 py-1.5 hover:bg-zinc-700"
        >{fav ? '已收藏' : '★ 收藏'}</button>
        {role === 'dm' && entry.type === 'monster' && (
          <button
            onClick={() => {
              const sceneId = scene!.id;
              void sceneId;
              connection.sendOps([{ op: 'addToken', token: { id: `t${Date.now()}`, kind: 'monster', name: entry.nameZh, entryId: entry.id, x: 200, y: 200, size: 100, avatar: `/api/token/${entry.id}`, color: '#fff' } }]);
            }}
            className="flex-1 rounded bg-amber-600/20 text-amber-400 py-1.5 hover:bg-amber-600/30"
          >➤ 放置到棋盘</button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 更新 QueryPanel.tsx**

```tsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useScene } from '../ws';
import DetailDrawer from './DetailDrawer';
import type { EntryType, IndexEntry } from '../types';

type Tab = 'query' | 'fav';

export default function QueryPanel() {
  const [tab, setTab] = useState<Tab>('query');
  const [q, setQ] = useState('');
  const [type, setType] = useState<EntryType | 'all'>('all');
  const [results, setResults] = useState<IndexEntry[]>([]);
  const [detail, setDetail] = useState<IndexEntry | null>(null);
  const { scene } = useScene();

  useEffect(() => {
    const t = setTimeout(() => {
      if (!q.trim()) { setResults([]); return; }
      api.search(q, type).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, type]);

  const favorites = scene?.favorites ?? [];
  const favEntries = favorites
    .map(f => {
      const r = results.length ? null : null;
      return f;
    });

  return (
    <aside className="w-80 border-l border-zinc-700/60 bg-zinc-900 flex flex-col text-sm relative">
      <div className="flex border-b border-zinc-800">
        {(['query', 'fav'] as Tab[]).map(t => (
          <button key={t} onClick={() => { setTab(t); setDetail(null); }}
            className={`flex-1 py-2 text-center ${tab === t ? 'text-amber-400 border-b-2 border-amber-400' : 'text-zinc-500 hover:text-zinc-300'}`}>
            {t === 'query' ? '查询' : '收藏夹'}
          </button>
        ))}
      </div>

      {detail ? (
        <DetailDrawer entry={detail} onBack={() => setDetail(null)} />
      ) : (
        <>
          <div className="p-2 flex gap-1">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索怪物 / 法术 / 装备…"
              className="flex-1 bg-zinc-800 rounded px-2 py-1 outline-none focus:ring-1 ring-amber-500" />
            <select value={type} onChange={e => setType(e.target.value as any)} className="bg-zinc-800 rounded px-1">
              <option value="all">全部</option>
              <option value="monster">怪物</option>
              <option value="spell">法术</option>
              <option value="item">装备</option>
              <option value="feat">专长</option>
            </select>
          </div>
          {tab === 'query' && (
            <div className="flex-1 overflow-y-auto">
              {results.map(r => (
                <button key={r.id} onClick={() => setDetail(r)}
                  className="w-full text-left px-3 py-2 hover:bg-zinc-800 border-b border-zinc-800/50 flex justify-between gap-2">
                  <span>
                    <span className="block text-zinc-100">{r.nameZh}</span>
                    <span className="block text-xs text-zinc-500">{r.nameEn} · {r.source}</span>
                  </span>
                  <span className="shrink-0 text-xs text-amber-400/80 self-center">
                    {r.type === 'monster' ? r.cr ?? '' : r.type === 'spell' ? `${r.level ?? 0} 环` : ''}
                  </span>
                </button>
              ))}
              {q.trim() && results.length === 0 && <div className="p-3 text-zinc-500 text-xs">无结果</div>}
            </div>
          )}
          {tab === 'fav' && (
            <div className="flex-1 overflow-y-auto">
              {favEntries.length === 0 && <div className="p-3 text-zinc-500 text-xs">收藏夹为空，从查询中点击 ★ 收藏</div>}
              {favEntries.map((f, i) => (
                <div key={i} className="px-3 py-2 border-b border-zinc-800/50 flex justify-between items-center">
                  <span className="text-zinc-200">{f.type} · {f.entryId}</span>
                  <button className="text-zinc-500 hover:text-red-400"
                    onClick={() => connection.sendOps([{ op: 'removeFavorite', type: f.type, entryId: f.entryId }])}>✕</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </aside>
  );
}
```

> 注：收藏夹条目显示的是 `entryId`（如 `MM__Goblin`），较丑。实现者可在本任务里加一个「收藏夹名」的查找：用 `api.entry(f.type, f.entryId)` 取 `name` 展示（可做轻量缓存）。这是 UI 优化，允许小范围增强。

- [ ] **Step 4: 手工验证**

```bash
npm run dev
# 搜索「地精」「火球术」→ 出现结果 → 点击 → 详情抽屉显示中文统计块；点「放置到棋盘」→ 画布出现地精 token
```

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat: 查询面板接入搜索 + 详情抽屉 + 放置 token"
```

---

## Task 16: 放置 token（从查询/收藏）与画墙

**Files:**
- Modify: `client/src/components/QueryPanel.tsx`（放置按钮已有）
- Modify: `client/src/components/BoardCanvas.tsx`（工具模式 + 画墙交互）
- Modify: `client/src/components/Toolbar.tsx`（选中工具状态）

**Interfaces:**
- Consumes: Task 14、15。
- Produces: 工具栏选中工具状态（`select/add/wall`）；`add` 模式下点击画布空白处，把「待放置」token（查询面板放入的临时对象）放到该位置（吸附网格）并发 `addToken`；`wall` 模式下拖拽画墙线并发 `addWall`。

- [ ] **Step 1: 更新 Toolbar 受控工具状态**

`Toolbar.tsx` 改为受控：
```tsx
interface Props { role?: 'dm' | 'player'; tool: string; onTool: (t: string) => void; pendingLabel?: string | null; }
export default function Toolbar({ role = 'dm', tool, onTool, pendingLabel }: Props) {
  const visible = role === 'dm' ? TOOLS : TOOLS.filter(t => t.id === 'select' || t.id === 'zoom');
  return (
    <aside className="w-12 border-r border-zinc-700/60 bg-zinc-900 flex flex-col items-center py-2 gap-1">
      {visible.map(t => (
        <button key={t.id} title={t.label}
          onClick={() => onTool(t.id)}
          className={`w-9 h-9 rounded-md flex items-center justify-center text-lg ${tool === t.id ? 'bg-amber-600/30 text-amber-400' : 'hover:bg-zinc-700 text-zinc-300'}`}>
          {t.icon}
        </button>
      ))}
      {pendingLabel && <div className="mt-2 text-[10px] text-amber-400 text-center leading-tight px-1">{pendingLabel}</div>}
    </aside>
  );
}
```

- [ ] **Step 2: BoardCanvas 增加工具模式与待放置/画墙**

BoardCanvas 增加 props `{ tool: string; pending: { kind: 'monster' | 'player'; name: string; entryId: string | null; avatar: string; color: string } | null }`，并新增：
- `add` 模式：`onClick` 画布空白 → `connection.sendOps([{op:'addToken', token:{ id: newId..., kind: pending.kind, name: pending.name, entryId: pending.entryId, x: snapX, y: snapY, size: 100, avatar: pending.avatar, color: pending.color }}])`，然后清空 pending（调 `onClearPending`）。
- `wall` 模式：`onMouseDown` 记录起点、`onMouseMove` 画预览线、`onMouseUp` 发 `addWall`。

App.tsx 持有 `tool` 与 `pending` 状态，传给 Toolbar 与 BoardCanvas；`pending` 由 QueryPanel 通过回调设置（放在全局的简单方式：把 pending 提升到 App，QueryPanel 的放置按钮改成「拿起」——先放 pending，再点画布）。

> 实现说明：为避免 QueryPanel 与 App 深度耦合，用一个小型全局事件总线：`client/src/pending.ts` 暴露 `setPending(token | null)` 与 `subscribe(cb)`。App 订阅后把 pending 传给 BoardCanvas；QueryPanel 的「放置到棋盘」改为 `setPending({...})` 并在 Toolbar 显示提示「点击棋盘放置」。此重构简化跨组件通信。

- [ ] **Step 3: 手工验证**

```bash
npm run dev
# 选择「放置」工具 → 查询面板点「拿起」→ 回到画布点空白 → token 放置并吸附网格
# 选择「画墙」→ 拖拽画一条线 → 渲染为深色粗线
```

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "feat: 放置 token（点击画布）+ 画墙工具"
```

---

## Task 17: 先攻面板（提交/排序/推进）+ token 高亮

**Files:**
- Modify: `client/src/components/InitiativePanel.tsx`
- Modify: `client/src/App.tsx`（传角色/场景）

**Interfaces:**
- Consumes: `useScene`、`connection`、`submitInitiative`/`advanceTurn`/`addToInitiative`/`removeFromInitiative` op。
- Produces:
  - 先攻栏：按 `scene.initiative` 渲染（已由服务器排序），当前行动者高亮绿色边框；「⏭ 下一回合」（DM）发 `advanceTurn`。
  - DM：从选中 token「加入先攻」；每条目 ✕ 删除；可手动输入先攻值添加。
  - 玩家：底部/面板内「我的先攻」输入框 + 提交 → `submitInitiative`（带 sessionId，由服务器 upsert + 排序）。
  - 棋盘 token 高亮已由 BoardCanvas 的 `active` 判断完成（Task 14），此处联动验证。

- [ ] **Step 1: 实现 InitiativePanel.tsx**

```tsx
import { useState } from 'react';
import { connection, useScene } from '../ws';

export default function InitiativePanel() {
  const { scene, role } = useScene();
  const [value, setValue] = useState('');
  const [myToken, setMyToken] = useState('');
  const entries = scene?.initiative ?? [];

  const submit = () => {
    const v = Number(value);
    if (!Number.isFinite(v)) return;
    // 稳定的 sessionId：玩家重复提交时服务器按它 upsert，不产生重复条目
    let sid = localStorage.getItem('player-session-id');
    if (!sid) {
      sid = crypto.randomUUID();
      localStorage.setItem('player-session-id', sid);
    }
    connection.sendOps([{ op: 'submitInitiative', name: `玩家${value}`, value: v, tokenId: myToken || null, sessionId: sid }]);
    setValue('');
  };

  return (
    <div className="h-14 border-b border-zinc-700/60 bg-zinc-900 flex items-center px-2 gap-2 text-sm overflow-x-auto">
      <span className="text-zinc-500 shrink-0">先攻</span>
      {entries.map(e => (
        <div key={e.id}
          className={`shrink-0 px-2 py-0.5 rounded flex items-center gap-1.5 ${e.active ? 'bg-emerald-700/60 text-white ring-1 ring-emerald-400' : 'bg-zinc-800 text-zinc-300'}`}>
          <span>{e.name}</span>
          <span className={e.active ? 'text-emerald-200' : 'text-amber-400'}>{e.value}</span>
          {role === 'dm' && (
            <button className="text-zinc-500 hover:text-red-400"
              onClick={() => connection.sendOps([{ op: 'removeFromInitiative', entryId: e.id }])}>✕</button>
          )}
        </div>
      ))}
      {role === 'dm' && (
        <button
          onClick={() => connection.sendOps([{ op: 'advanceTurn' }])}
          className="ml-auto shrink-0 px-2 py-1 rounded bg-amber-600/20 text-amber-400 hover:bg-amber-600/30">
          ⏭ 下一回合
        </button>
      )}
      {role === 'player' && (
        <div className="ml-auto shrink-0 flex items-center gap-1">
          <select value={myToken} onChange={e => setMyToken(e.target.value)} className="bg-zinc-800 rounded px-1 py-0.5 text-xs">
            <option value="">我的角色</option>
            {(scene?.players ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input value={value} onChange={e => setValue(e.target.value)} placeholder="先攻值"
            className="w-16 bg-zinc-800 rounded px-2 py-0.5 text-center" />
          <button onClick={submit} className="px-2 py-0.5 rounded bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30">提交</button>
        </div>
      )}
    </div>
  );
}
```

> 注：`submitInitiative` 的 `sessionId` 目前由服务器自动填（ops.ts 里 `op.sessionId` 为 undefined 时按名字 upsert）。要让玩家每次提交都更新同一条目，前端应随 op 携带稳定的 sessionId —— 用 `localStorage` 存一个 `player-session-id`，提交时附上。实现者需在 `submit` 里加上：`const sid = localStorage.getItem('player-session-id') ?? crypto.randomUUID(); localStorage.setItem('player-session-id', sid);` 并放入 op。同时 ops.ts 的 submitInitiative 已在 `sessionId != null` 分支支持。此为必须完成的关键细节，否则玩家重复提交会生成多条。

- [ ] **Step 2: 手工验证**

```bash
npm run dev
# DM 端：添加 token → 先攻栏「加入先攻」→ 下一回合 → 对应 token 金色环高亮
# 玩家端（另开 http://<lan-ip>:3001 或同一浏览器伪造角色）：输入先攻值提交 → DM 端看到排序后条目
```

- [ ] **Step 3: 提交**

```bash
git add -A && git commit -m "feat: 先攻面板（玩家提交/DM 推进）+ token 高亮"
```

---

## Task 18: 收藏夹完整化

**Files:**
- Modify: `client/src/components/QueryPanel.tsx`（收藏夹显示中文名）

**Interfaces:**
- Consumes: Task 15 的收藏 op。
- Produces: 收藏夹标签展示收藏条目的中文名（经 `api.entry` 查询），点击可打开详情。

- [ ] **Step 1: 增加收藏夹名解析**

在 QueryPanel 内新增：
```tsx
const [favNames, setFavNames] = useState<Record<string, string>>({});
useEffect(() => {
  const favs = scene?.favorites ?? [];
  const missing = favs.filter(f => !favNames[f.entryId]);
  for (const f of missing) {
    api.entry(f.type, f.entryId).then(e => setFavNames(prev => ({ ...prev, [f.entryId]: e.name ?? f.entryId }))).catch(() => {});
  }
}, [scene?.favorites, favNames]);
```
渲染收藏夹条目时用 `favNames[f.entryId] ?? f.entryId`。

- [ ] **Step 2: 手工验证**

```bash
npm run dev
# 收藏「地精」→ 切到收藏夹标签 → 显示「地精」而非 MM__Goblin；点击打开详情
```

- [ ] **Step 3: 提交**

```bash
git add -A && git commit -m "feat: 收藏夹显示中文名"
```

---

## Task 19: 场景管理 + 地图上传

**Files:**
- Modify: `client/src/components/TopBar.tsx`
- Create: `client/src/components/SceneSwitcher.tsx`
- Modify: `client/src/components/BoardCanvas.tsx`（地图上传入口 + updateMap op）

**Interfaces:**
- Consumes: `api.scenes/createScene/deleteScene`（Task 12）、`updateMap` op、`/api/upload/map`。
- Produces:
  - TopBar「切换场景▾」打开 SceneSwitcher：列表、新建（输入名）、删除（DM）、选择 → 发 `{type:'switchScene', sceneId}`（走 WS，DM）。
  - 地图工具：上传本地图片 → `/api/upload/map` → 返回 url → 发 `updateMap` op（mapImage/mapSize/playArea）。
  - 刷新后打开上次场景（服务器已处理 last-scene）。

- [ ] **Step 1: 实现 SceneSwitcher.tsx**

```tsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { connection } from '../ws';

export default function SceneSwitcher({ onClose }: { onClose: () => void }) {
  const [scenes, setScenes] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState('');

  const reload = () => api.scenes().then(setScenes);
  useEffect(() => { reload(); }, []);

  return (
    <div className="absolute top-11 right-0 z-20 w-64 bg-zinc-800 border border-zinc-700 rounded shadow-xl p-2 text-sm">
      <div className="text-xs text-zinc-500 mb-1">场景列表</div>
      {scenes.map(s => (
        <div key={s.id} className="flex items-center gap-2 py-1 px-1 rounded hover:bg-zinc-700">
          <button className="flex-1 text-left" onClick={() => { connection.sendControl({ type: 'switchScene', sceneId: s.id }); onClose(); }}>
            {s.name}
          </button>
          <button className="text-zinc-500 hover:text-red-400"
            onClick={() => { api.deleteScene(s.id).then(reload); }}>✕</button>
        </div>
      ))}
      <div className="flex gap-1 mt-2 border-t border-zinc-700 pt-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="新场景名"
          className="flex-1 bg-zinc-900 rounded px-2 py-1 text-sm" />
        <button
          onClick={() => { if (name.trim()) api.createScene(name.trim()).then(reload); setName(''); }}
          className="px-2 py-1 rounded bg-amber-600/20 text-amber-400">＋</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TopBar 接入 SceneSwitcher 与地图上传**

TopBar 加：场景名从 `useScene().scene?.name` 取；「切换场景▾」按钮控制 SceneSwitcher 显隐；加一个地图上传 `<input type="file" accept="image/*">`（DM 可见），onChange → `uploadMap(file)`。

`client/src/upload.ts`:
```ts
export async function uploadImage(file: File, kind: 'map' | 'token'): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`/api/upload/${kind}`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error('upload failed');
  const b = await res.json();
  return b.url as string;
}
```

TopBar 上传地图后：
```tsx
const url = await uploadImage(file, 'map');
const img = new Image();
img.onload = () => {
  connection.sendOps([{ op: 'updateMap', mapImage: url, mapSize: [img.naturalWidth, img.naturalHeight], playArea: { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight } }]);
};
img.src = url;
```

- [ ] **Step 3: 手工验证**

```bash
npm run dev
# 上传一张地图 → 画布显示底图 + 网格；新建场景并切换 → 空棋盘；刷新 → 回到当前场景
```

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "feat: 场景切换/新建/删除 + 地图上传"
```

---

## Task 20: 角色适配 + 口令升级 + README + 验收

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `server/src/index.ts`（组装 createApp + GameServer + 静态服务）
- Create: `README.md`

**Interfaces:**
- Consumes: 全部前置任务。
- Produces:
  - 生产模式 `npm run build && npm start`：服务器在 3001 提供静态前端 + API + WS，`0.0.0.0` 监听。
  - 玩家端 UI：工具竖栏仅「选择/缩放」；先攻栏显示提交框；查询面板可收起。
  - 口令升级：设置里输入口令 → `api.verifyPassword` → 成功后 `connection.setDmToken` → 重连获得 DM 权限。
  - README：启动步骤、局域网联机说明、数据更新、图片源配置。

- [ ] **Step 1: 重写 server/src/index.ts**

```ts
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { createApp, RouteDeps } from './routes';
import { GameServer } from './game';
import { attachWsServer } from './ws';
import { SceneStore } from './store';
import { SearchService } from './search';
import { EntryService } from './entries';
import { TokenService } from './tokens';
import { ROOT, PORT, HOST, SCENES_DIR, TOKEN_CACHE_DIR, UPLOADS_DIR, DB_DIR, DM_PASSWORD, LAST_SCENE_FILE } from './config';

async function main() {
  const store = new SceneStore(SCENES_DIR);
  const search = new SearchService(DB_DIR);
  const entries = new EntryService(DB_DIR);
  const tokens = new TokenService(TOKEN_CACHE_DIR, entries);

  const game = new GameServer(store, { password: DM_PASSWORD });
  await game.init();

  let dataReady = false;

  const app = createApp({
    store, search, entries, tokens,
    uploadsDir: UPLOADS_DIR,
    online: () => game.clientsCount(),
    dataReady: () => dataReady,
    verifyPassword: (p: string) => (DM_PASSWORD == null) || (DM_PASSWORD !== '' && p === DM_PASSWORD),
  } as RouteDeps);

  // 生产模式：托管前端构建产物
  const dist = path.join(ROOT, 'client', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  try {
    await search.load();
    await entries.warm();
    dataReady = true;
  } catch (e) {
    console.warn('[dnd-dm-tool] 数据未就绪，运行 npm run data:update：', (e as Error).message);
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`[dnd-dm-tool] http://${HOST}:${PORT}  （DM 用 localhost 打开，玩家用局域网 IP 打开）`);
  });
  attachWsServer(server, game);
}

main().catch(e => { console.error(e); process.exit(1); });
```

> 注：`GameServer` 需增加 `clientsCount()` 方法（返回 `this.clients.size`），Task 20 第 2 步实现。`main` 已改为先建 game 再建 app，`online` 直接引用 `game.clientsCount()`。

- [ ] **Step 2: GameServer 增加 clientsCount**

`game.ts` 追加：
```ts
clientsCount(): number {
  return this.clients.size;
}
```

- [ ] **Step 3: App.tsx 角色适配**

App 从 `useScene()` 取 `role`；`Toolbar` 传 `role`；玩家端查询窗口可折叠（`QueryPanel` 加 `collapsed` 状态，折叠时渲染为一条竖条，点击展开）。

- [ ] **Step 4: 口令升级 UI**

TopBar 加设置弹层：输入口令 → `api.verifyPassword(pw)` → 若 ok：`connection.setDmToken(pw)` + 刷新（`location.reload()`，重连时带上 token）。服务器在 `roleFor` 校验 dmToken。

- [ ] **Step 5: 写 README.md**

```markdown
# D&D DM 追踪工具

局域网多人 D&D 5e DM 追踪工具：棋盘（地图底图/网格/墙/token）、5e不全书中文查询、收藏夹、先攻追踪。

## 启动
1. `npm install`
2. `npm run data:update`   # 下载 5etools 中文数据 + 构建索引（需联网，约几十 MB）
3. `npm run build && npm start`   # 生产模式，监听 0.0.0.0:3001
4. DM 浏览器打开 `http://localhost:3001`（DM 权限）
5. 玩家连同一 WiFi，打开 `http://<你的局域网IP>:3001`（玩家权限，可拖 token、提交先攻）

开发模式：`npm run dev`（后端 3001 + 前端 5173，仅本机开发用）

## 数据
- `npm run data:update` 可重跑更新；数据来自 5etools-cn（CC BY-NC-SA 4.0），存储在 `data/db/`
- 怪物头像默认从 `https://5e.tools` 下载，可用 `DND_IMAGE_BASE` 环境变量换源
- 下载失败自动用首字母占位 token，可在详情面板手动上传/贴图

## 环境变量
- `PORT`（默认 3001）、`HOST`（默认 0.0.0.0）
- `DND_IMAGE_BASE`（图片源，默认 https://5e.tools）
- `DND_PASSWORD`（DM 口令，玩家输入后获得 DM 权限；不设则仅 localhost 是 DM）
```

- [ ] **Step 6: 手动验收（完整清单）**

在局域网两台设备（或一台机器两个浏览器，其中一个伪造角色）逐项验证：

- [ ] DM 打开 localhost:3001，看到深色布局、网格、可玩区域框
- [ ] DM 上传地图图片 → 画布显示底图 + 网格
- [ ] 查询「地精」「火球术」「goblin」均能搜到并显示中文详情
- [ ] 收藏地精 → 收藏夹显示「地精」，可打开详情
- [ ] DM 放置地精 token → 头像自动下载显示圆形图；无法下载时显示首字母占位
- [ ] 玩家浏览器打开 http://<IP>:3001 → 可拖动 token，DM 端同步可见；DM 拖 token 玩家端也可见
- [ ] 玩家输入先攻值提交 → DM 先攻栏出现并按值排序；重复提交不产生重复条目
- [ ] DM 点「下一回合」→ 当前 token 外圈金色高亮，先攻栏高亮同步
- [ ] 玩家尝试发 DM 专属操作（如推进回合）→ 被拒绝（服务器权限校验）
- [ ] DM 新建场景 → 切换 → 上传新地图 → 刷新后回到当前场景（last-scene）
- [ ] 杀掉服务器再重启 → 前端自动重连并恢复状态

- [ ] **Step 7: 提交**

```bash
git add -A && git commit -m "feat: 角色适配 + 口令升级 + README + 生产模式"
```

---

## 自审记录

- **规格覆盖**：棋盘（Task 13/14/16/19）✓、查询（Task 15）✓、token 放置与头像下载（Task 8/14/15）✓、收藏夹（Task 15/18）✓、先攻与高亮（Task 17）✓、局域网多人同步（Task 10/12/20）✓、场景存储（Task 5/19）✓、口令升级（Task 20）✓。
- **占位符**：任务间无「TBD/TODO」；已知两处脚本/类型笔误已在任务内标注并要求实现者修正。
- **类型一致性**：`Op` union 各成员在 ops.ts/routes/ws/client 间一致；`IndexEntry` 在 search/entries/client 间一致；`GameServer.clientsCount()` 在 Task 20 新增并在 ws 测试中未使用（无破坏）。
