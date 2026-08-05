# 跑团战役资料库（Campaign + 敌人库）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入「战役（跑团项目）」顶层容器：每个战役含多个场景 + 一套跨场景复用的共享敌人库；现有场景自动归入「默认战役」。

**Architecture:** 方案 A——战役层叠加在现有 SceneStore 之上。新增 `data/campaigns/` 战役存储（每个战役一个 JSON：名称 + 场景 id 列表 + 敌人模板库），场景仍独立存 `data/scenes/`。WS op 分两类：战役 op（`addEnemy`/`removeEnemy`/`switchCampaign`，DM 专属）与现有场景 op；`GameServer` 持有 `currentCampaign` 并在 `state` 消息中携带。

**Tech Stack:** Node.js/Express/ws（不变）、React/Konva/Tailwind（不变）、Vitest。新增 `CampaignStore`（照抄 `SceneStore` 模式）与 `applyCampaignOp` 纯函数。

## Global Constraints

- TypeScript strict；源码 `.ts`/`.tsx`；界面文案一律中文；代码标识符/注释英文。
- 端口：后端 `3001`、Vite `5173`；数据目录 `data/` 全部 gitignore。
- 角色判定：localhost = DM，其余玩家；玩家可口令升级。`canOp`：DM 全部，玩家仅 `moveToken`/`submitInitiative`。
- 一个场景只属于一个战役；`switchScene` 严格限制在当前战役场景内。
- 删除战役**不删场景文件**。
- 敌人模板只存 `entryId` + `nameZh`（头像由 `/api/token/:entryId` 推导）。
- 每任务结束必须 `npm test`（或指定测试）通过并 git commit。

---

## 文件结构

```
shared/types.ts                    加 EnemyTemplate / Campaign / 3 个新 Op
server/src/campaign.ts              createCampaign 工厂
server/src/campaign.test.ts
server/src/campaign-store.ts        CampaignStore + CampaignNotFoundError + assignScene
server/src/campaign-store.test.ts
server/src/campaign-ops.ts          isCampaignOp / applyCampaignOp
server/src/campaign-ops.test.ts
server/src/game.ts                  加 currentCampaign、迁移、op 路由、switchCampaign
server/src/config.ts                加 CAMPAIGNS_DIR
server/src/index.ts                 组装 CampaignStore
server/src/routes.ts                /api/campaigns 路由
server/test/ws.test.ts              战役集成测试
client/src/ws.ts                    SceneState 加 campaign
client/src/api.ts                   加 campaign 方法
client/src/components/QueryPanel.tsx  战役库标签 + 加入战役库按钮
client/src/components/CampaignSwitcher.tsx  新建
client/src/components/TopBar.tsx    战役切换
client/src/components/SceneSwitcher.tsx    按战役过滤 + 新场景归属
docs/superpowers/specs/2026-08-05-campaign-library-design.md  存储小节改为目录扫描（去掉 index.json）
```

---

## Task 1: 共享类型 + Campaign 工厂

**Files:**
- Modify: `shared/types.ts`
- Create: `server/src/campaign.ts`
- Create: `server/src/campaign.test.ts`

**Interfaces:**
- Produces:
  - `interface EnemyTemplate { entryId: string; nameZh: string }`
  - `interface Campaign { id: string; name: string; sceneIds: string[]; enemies: EnemyTemplate[] }`
  - `Op` 新增 `{ op:'addEnemy'; entryId; nameZh }`、`{ op:'removeEnemy'; entryId }`、`{ op:'switchCampaign'; campaignId }`
  - `createCampaign(name: string): Campaign`（id 前缀 `campaign-`）

- [ ] **Step 1: shared/types.ts 加类型**

在 `Scene` interface 之后、`export type Op` 之前插入：

```ts
export interface EnemyTemplate {
  entryId: string;   // 如 'MM__Goblin'
  nameZh: string;    // 如 '地精'
}

export interface Campaign {
  id: string;
  name: string;
  sceneIds: string[];        // 战役内的场景 id，一个场景只属于一个战役
  enemies: EnemyTemplate[];  // 按 entryId 去重，保持加入顺序
}
```

在 `Op` union 中 `| { op: 'updateMapScale'; mapScale: number }` 之后追加：

```ts
  | { op: 'addEnemy'; entryId: string; nameZh: string }
  | { op: 'removeEnemy'; entryId: string }
  | { op: 'switchCampaign'; campaignId: string }
```

- [ ] **Step 2: 写失败测试 `server/src/campaign.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createCampaign } from './campaign';

describe('campaign factory', () => {
  it('creates a campaign with unique id and empty collections', () => {
    const c = createCampaign('地牢冒险');
    expect(c.id).toMatch(/^campaign-/);
    expect(c.name).toBe('地牢冒险');
    expect(c.sceneIds).toEqual([]);
    expect(c.enemies).toEqual([]);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npm test -- server/src/campaign.test.ts`
Expected: FAIL（`./campaign` 不存在）。

- [ ] **Step 4: 实现 `server/src/campaign.ts`**

```ts
import { Campaign } from './types';
import { newId } from './scene';

export function createCampaign(name: string): Campaign {
  return {
    id: newId('campaign'),
    name,
    sceneIds: [],
    enemies: [],
  };
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test -- server/src/campaign.test.ts`
Expected: PASS（1 个）。

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "feat: 战役共享类型与 Campaign 工厂"
```

---

## Task 2: CampaignStore

**Files:**
- Create: `server/src/campaign-store.ts`
- Create: `server/src/campaign-store.test.ts`
- Modify: `docs/superpowers/specs/2026-08-05-campaign-library-design.md`（存储小节）

**Interfaces:**
- Consumes: `createCampaign`（Task 1）。
- Produces:
  - `class CampaignStore { constructor(dir: string) }`
    - `list(): Promise<{id:string;name:string}[]>`（扫 `*.json`，无需 index.json）
    - `create(name: string): Promise<Campaign>`
    - `get(id: string): Promise<Campaign>`（不存在抛 `CampaignNotFoundError`）
    - `save(campaign: Campaign): void`
    - `delete(id: string): Promise<void>`
    - `all(): Promise<Campaign[]>`（全部完整战役）
    - `assignScene(campaignId: string, sceneId: string): Promise<void>`（场景移入该战役，并从其他战役移除）
  - `class CampaignNotFoundError extends Error`

- [ ] **Step 1: 更新设计文档存储小节**

将 `docs/superpowers/specs/2026-08-05-campaign-library-design.md` 中 `data/campaigns/index.json` 相关描述改为：`list()` 通过扫描 `data/campaigns/*.json` 得到战役列表，**不需要 index.json**（避免同步问题）。

- [ ] **Step 2: 写失败测试 `server/src/campaign-store.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CampaignStore, CampaignNotFoundError } from './campaign-store';

let dir: string;
let store: CampaignStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaigns-'));
  store = new CampaignStore(dir);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('CampaignStore', () => {
  it('creates and lists campaigns', async () => {
    const a = await store.create('地牢冒险');
    const b = await store.create('沙漠远征');
    const list = await store.list();
    expect(list).toHaveLength(2);
    expect(list.map(x => x.name)).toEqual(expect.arrayContaining(['地牢冒险', '沙漠远征']));
    expect(a.id).not.toBe(b.id);
  });

  it('round-trips save/get', async () => {
    const c = await store.create('测试战役');
    c.enemies.push({ entryId: 'MM__Goblin', nameZh: '地精' });
    store.save(c);
    const got = await store.get(c.id);
    expect(got.enemies).toHaveLength(1);
    expect(got.enemies[0].nameZh).toBe('地精');
  });

  it('get missing throws', async () => {
    await expect(store.get('nope')).rejects.toBeInstanceOf(CampaignNotFoundError);
  });

  it('delete removes file', async () => {
    const c = await store.create('删');
    await store.delete(c.id);
    await expect(store.get(c.id)).rejects.toBeInstanceOf(CampaignNotFoundError);
  });

  it('assignScene moves a scene across campaigns', async () => {
    const a = await store.create('A');
    const b = await store.create('B');
    await store.assignScene(a.id, 'scene-x');
    await store.assignScene(b.id, 'scene-x');
    expect((await store.get(a.id)).sceneIds).toEqual([]);
    expect((await store.get(b.id)).sceneIds).toEqual(['scene-x']);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npm test -- server/src/campaign-store.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 4: 实现 `server/src/campaign-store.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';
import { Campaign } from './types';
import { createCampaign } from './campaign';

export class CampaignNotFoundError extends Error {
  constructor(id: string) {
    super(`campaign not found: ${id}`);
    this.name = 'CampaignNotFoundError';
  }
}

export class CampaignStore {
  constructor(private dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  private file(id: string) {
    if (!/^[a-z0-9-]+$/i.test(id)) throw new Error(`invalid campaign id: ${id}`);
    return path.join(this.dir, `${id}.json`);
  }

  async list(): Promise<{ id: string; name: string }[]> {
    const files = fs.readdirSync(this.dir).filter(f => f.endsWith('.json'));
    const out: { id: string; name: string }[] = [];
    for (const f of files) {
      try {
        const c = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')) as Campaign;
        out.push({ id: c.id, name: c.name });
      } catch { /* 忽略损坏文件 */ }
    }
    return out;
  }

  async all(): Promise<Campaign[]> {
    const out: Campaign[] = [];
    for (const { id } of await this.list()) {
      try { out.push(await this.get(id)); } catch { /* skip */ }
    }
    return out;
  }

  async create(name: string): Promise<Campaign> {
    const c = createCampaign(name);
    this.save(c);
    return c;
  }

  async get(id: string): Promise<Campaign> {
    try {
      return JSON.parse(fs.readFileSync(this.file(id), 'utf8')) as Campaign;
    } catch {
      throw new CampaignNotFoundError(id);
    }
  }

  save(campaign: Campaign): void {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file(campaign.id), JSON.stringify(campaign, null, 2));
  }

  async delete(id: string): Promise<void> {
    const f = this.file(id);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  // Move a scene into this campaign, removing it from every other campaign.
  async assignScene(campaignId: string, sceneId: string): Promise<void> {
    for (const c of await this.all()) {
      if (c.id === campaignId) {
        if (!c.sceneIds.includes(sceneId)) c.sceneIds.push(sceneId);
      } else {
        c.sceneIds = c.sceneIds.filter(id => id !== sceneId);
      }
      this.save(c);
    }
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test -- server/src/campaign-store.test.ts`
Expected: PASS（5 个）。

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "feat: 战役存储 CampaignStore（含场景归属分配）"
```

---

## Task 3: 战役 op 纯函数

**Files:**
- Create: `server/src/campaign-ops.ts`
- Create: `server/src/campaign-ops.test.ts`

**Interfaces:**
- Consumes: `Campaign`/`Op` 类型（Task 1）、`canOp`（现有 ops.ts）。
- Produces:
  - `isCampaignOp(op: Op): boolean`（addEnemy / removeEnemy / switchCampaign）
  - `applyCampaignOp(campaign: Campaign, op: Op): void`（addEnemy 去重 push、removeEnemy filter；switchCampaign 为 no-op）
  - 注意：`canOp` 无需改——新 op 不在 `isPlayerOp` 中，玩家自动被拒。

- [ ] **Step 1: 写失败测试 `server/src/campaign-ops.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { applyCampaignOp, isCampaignOp } from './campaign-ops';
import { createCampaign } from './campaign';
import { canOp } from './ops';
import { Op } from './types';

describe('isCampaignOp', () => {
  it('identifies campaign ops', () => {
    expect(isCampaignOp({ op: 'addEnemy', entryId: 'MM__Goblin', nameZh: '地精' })).toBe(true);
    expect(isCampaignOp({ op: 'removeEnemy', entryId: 'MM__Goblin' })).toBe(true);
    expect(isCampaignOp({ op: 'switchCampaign', campaignId: 'c1' })).toBe(true);
    expect(isCampaignOp({ op: 'moveToken', tokenId: 't1', x: 1, y: 1 })).toBe(false);
  });
});

describe('applyCampaignOp', () => {
  it('addEnemy dedupes by entryId and preserves order', () => {
    const c = createCampaign('t');
    applyCampaignOp(c, { op: 'addEnemy', entryId: 'MM__Goblin', nameZh: '地精' });
    applyCampaignOp(c, { op: 'addEnemy', entryId: 'MM__Goblin', nameZh: '地精' });
    applyCampaignOp(c, { op: 'addEnemy', entryId: 'MM__Hobgoblin', nameZh: '大地精' });
    expect(c.enemies.map(e => e.entryId)).toEqual(['MM__Goblin', 'MM__Hobgoblin']);
  });

  it('removeEnemy removes', () => {
    const c = createCampaign('t');
    applyCampaignOp(c, { op: 'addEnemy', entryId: 'MM__Goblin', nameZh: '地精' });
    applyCampaignOp(c, { op: 'removeEnemy', entryId: 'MM__Goblin' });
    expect(c.enemies).toEqual([]);
  });
});

describe('canOp campaign ops', () => {
  it('dm allowed, player denied', () => {
    const ops: Op[] = [
      { op: 'addEnemy', entryId: 'x', nameZh: 'y' },
      { op: 'removeEnemy', entryId: 'x' },
      { op: 'switchCampaign', campaignId: 'c1' },
    ];
    for (const op of ops) {
      expect(canOp('dm', op)).toBe(true);
      expect(canOp('player', op)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- server/src/campaign-ops.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `server/src/campaign-ops.ts`**

```ts
import { Campaign, Op } from './types';

export function isCampaignOp(op: Op): boolean {
  return op.op === 'addEnemy' || op.op === 'removeEnemy' || op.op === 'switchCampaign';
}

// Applies enemy-library ops to a Campaign. switchCampaign is handled by
// GameServer (it needs the store + current scene), so it's a no-op here.
export function applyCampaignOp(campaign: Campaign, op: Op): void {
  switch (op.op) {
    case 'addEnemy': {
      if (!campaign.enemies.some(e => e.entryId === op.entryId)) {
        campaign.enemies.push({ entryId: op.entryId, nameZh: op.nameZh });
      }
      return;
    }
    case 'removeEnemy': {
      campaign.enemies = campaign.enemies.filter(e => e.entryId !== op.entryId);
      return;
    }
    default:
      return;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- server/src/campaign-ops.test.ts`
Expected: PASS（4 个）。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat: 战役 op 纯函数 isCampaignOp/applyCampaignOp"
```

---

## Task 4: GameServer 集成（迁移 + currentCampaign + op 路由 + switchCampaign）

**Files:**
- Modify: `server/src/game.ts`
- Modify: `server/src/config.ts`（加 `CAMPAIGNS_DIR`）
- Modify: `server/src/index.ts`
- Modify: `server/src/game.test.ts`（构造参数变化）

**Interfaces:**
- Consumes: `CampaignStore`（Task 2）、`applyCampaignOp`/`isCampaignOp`（Task 3）。
- Produces:
  - `new GameServer(store: SceneStore, campaignStore: CampaignStore, opts: { password: string | null })`
  - `GameServer.currentCampaign: Campaign`
  - `init()`：迁移（无战役 → 建「默认战役」收录全部场景）；按当前场景定位其战役
  - 所有 `state` 消息携带 `campaign: Campaign`
  - `handle` 支持 `{type:'op', ops}` 内战役 op 与场景 op 分流、`{type:'switchCampaign', campaignId}`（DM）
  - `switchCampaign(campaignId)`：载入战役，若当前场景不属于该战役则载入其首个场景（没有则新建），持久化 `last-scene`

- [ ] **Step 1: config.ts 加目录**

`server/src/config.ts` 在 `SCENES_DIR` 后加：
```ts
export const CAMPAIGNS_DIR = path.join(DATA_DIR, 'campaigns');
```

- [ ] **Step 2: 更新 game.test.ts 构造调用**

`server/src/game.test.ts` 中所有 `new GameServer(store, { password: ... })` 改为 `new GameServer(store, campaignStore, { password: ... })`，并创建临时 `CampaignStore`（仿照 store 的 temp dir 模式）。若 game.test 没有构造 GameServer，检查 ws.test.ts（Task 6 处理）。跑 `npm test -- server/src/game.test.ts` 确认现状（可能需先临时适配，见 Step 3 的构造签名）。

- [ ] **Step 3: 改 game.ts**

`server/src/game.ts` 修改/新增如下（保留现有 roleFor/attach/init 逻辑，仅调整 init、op 分流、state、switchCampaign）：

新增导入与字段：
```ts
import { CampaignStore } from './campaign-store';
import { Op, Role, Scene, Campaign } from './types';
import { applyCampaignOp, isCampaignOp } from './campaign-ops';

export class GameServer {
  current: Scene;
  store: SceneStore;
  campaignStore: CampaignStore;
  currentCampaign: Campaign;
  private clients = new Set<Client>();

  constructor(store: SceneStore, campaignStore: CampaignStore, private opts: { password: string | null }) {
    this.store = store;
    this.campaignStore = campaignStore;
    this.current = null as unknown as Scene;
    this.currentCampaign = null as unknown as Campaign;
  }
```

`init()` 整体替换：
```ts
  async init(): Promise<void> {
    // 迁移：无战役时自动建「默认战役」收录全部场景
    if ((await this.campaignStore.list()).length === 0) {
      const scenes = await this.store.list();
      const def = await this.campaignStore.create('默认战役');
      for (const s of scenes) await this.campaignStore.assignScene(def.id, s.id);
    }
    // 定位当前场景（last-scene 或首个）
    let sceneId: string | null = await this.store.last();
    if (!sceneId) {
      const scenes = await this.store.list();
      sceneId = scenes.length > 0 ? scenes[0].id : null;
    }
    if (sceneId) {
      try {
        this.current = await this.store.get(sceneId);
        this.currentCampaign = await this.campaignForScene(sceneId);
        return;
      } catch { /* fallthrough */ }
    }
    this.current = await this.store.create('默认场景');
    await this.store.setLast(this.current.id);
    this.currentCampaign = await this.campaignForScene(this.current.id);
  }

  private async campaignForScene(sceneId: string): Promise<Campaign> {
    for (const c of await this.campaignStore.all()) {
      if (c.sceneIds.includes(sceneId)) return c;
    }
    const list = await this.campaignStore.list();
    const target = list.length > 0 ? list[0].id : (await this.campaignStore.create('默认战役')).id;
    await this.campaignStore.assignScene(target, sceneId);
    return this.campaignStore.get(target);
  }
```

`handle` 中 `case 'init'` 的 state 消息改为带 campaign：
```ts
        client.ws.send(JSON.stringify({ type: 'state', scene: this.current, role: client.role, campaign: this.currentCampaign }));
```

`handle` 中 `case 'op'` 整体替换为分流版：
```ts
      case 'op': {
        const ops = Array.isArray(msg.ops) ? msg.ops : [];
        const allowed = ops.filter((op: Op) => canOp(client.role, op));
        const denied = ops.filter((op: Op) => !canOp(client.role, op));
        if (allowed.length > 0) {
          const campaignOps = allowed.filter(isCampaignOp);
          const sceneOps = allowed.filter(op => !isCampaignOp(op));
          if (campaignOps.length > 0) {
            for (const op of campaignOps) applyCampaignOp(this.currentCampaign, op);
            this.campaignStore.save(this.currentCampaign);
          }
          if (sceneOps.length > 0) {
            for (const op of sceneOps) applyOp(this.current, op);
            this.store.save(this.current);
          }
          this.broadcast({ type: 'state', scene: this.current, campaign: this.currentCampaign });
        }
        if (denied.length > 0) {
          client.ws.send(JSON.stringify({ type: 'error', message: 'permission denied for some ops' }));
        }
        return;
      }
```

`handle` 加 `case 'switchCampaign'`：
```ts
      case 'switchCampaign': {
        if (client.role !== 'dm') {
          client.ws.send(JSON.stringify({ type: 'error', message: 'permission denied' }));
          return;
        }
        this.switchCampaign(String(msg.campaignId)).catch(() => {
          client.ws.send(JSON.stringify({ type: 'error', message: 'campaign load failed' }));
        });
        return;
      }
```

`switchScene` 广播带 campaign，并新增 `switchCampaign` 方法：
```ts
  private async switchScene(id: string): Promise<void> {
    this.store.save(this.current);
    this.current = await this.store.get(id);
    await this.store.setLast(id);
    this.broadcast({ type: 'state', scene: this.current, campaign: this.currentCampaign });
  }

  private async switchCampaign(id: string): Promise<void> {
    this.store.save(this.current);
    const campaign = await this.campaignStore.get(id);
    this.currentCampaign = campaign;
    let scene = this.current;
    if (!campaign.sceneIds.includes(this.current.id)) {
      scene = campaign.sceneIds.length > 0
        ? await this.store.get(campaign.sceneIds[0])
        : await this.store.create('未命名场景');
      if (!campaign.sceneIds.includes(scene.id)) {
        campaign.sceneIds.push(scene.id);
        this.campaignStore.save(campaign);
      }
    }
    this.current = scene;
    await this.store.setLast(this.current.id);
    this.broadcast({ type: 'state', scene: this.current, campaign: this.currentCampaign });
  }
```

- [ ] **Step 4: 改 server/src/index.ts 组装 CampaignStore**

`server/src/index.ts`：
```ts
import { CampaignStore } from './campaign-store';
import { CAMPAIGNS_DIR } from './config';
...
  const store = new SceneStore(SCENES_DIR);
  const campaignStore = new CampaignStore(CAMPAIGNS_DIR);
  ...
  const game = new GameServer(store, campaignStore, { password: DM_PASSWORD });
```

- [ ] **Step 5: 跑测试**

Run: `npm test -- server/src/game.test.ts server/src/campaign-ops.test.ts server/src/campaign-store.test.ts server/src/campaign.test.ts`
Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "feat: GameServer 集成战役（迁移 + op 分流 + switchCampaign）"
```

---

## Task 5: REST 战役路由

**Files:**
- Modify: `server/src/routes.ts`
- Modify: `server/src/routes.test.ts`

**Interfaces:**
- Consumes: `CampaignStore`（Task 2）。
- Produces:
  - `RouteDeps` 加 `campaigns: CampaignStore`
  - 路由：
    - `GET /api/campaigns` → 列表
    - `POST /api/campaigns {name}` → 201 新建
    - `GET /api/campaigns/:id` → 详情 / 404
    - `DELETE /api/campaigns/:id` → `{ok}`
    - `POST /api/campaigns/:id/scenes {sceneId}` → 场景归属到该战役（`assignScene`）→ `{ok}`
- `client/api.ts` 将调用这些路由（Task 7）。

- [ ] **Step 1: routes.ts 加依赖与路由**

`RouteDeps` 加字段：
```ts
  campaigns: CampaignStore;
```
导入 `CampaignStore` 并在 `createApp` 内加路由（放在 `r.post('/verify-password', ...)` 之前）：
```ts
  r.get('/campaigns', async (_req, res) => {
    try { res.json(await deps.campaigns.list()); }
    catch { res.status(500).json({ error: 'server error' }); }
  });
  r.post('/campaigns', async (req, res) => {
    try {
      const name = String(req.body.name ?? '未命名战役').slice(0, 60);
      res.status(201).json(await deps.campaigns.create(name));
    } catch { res.status(500).json({ error: 'server error' }); }
  });
  r.get('/campaigns/:id', async (req, res) => {
    try { res.json(await deps.campaigns.get(req.params.id)); }
    catch { res.status(404).json({ error: 'campaign not found' }); }
  });
  r.delete('/campaigns/:id', async (req, res) => {
    try { await deps.campaigns.delete(req.params.id); res.json({ ok: true }); }
    catch { res.status(500).json({ error: 'server error' }); }
  });
  r.post('/campaigns/:id/scenes', async (req, res) => {
    try {
      await deps.campaigns.assignScene(req.params.id, String(req.body.sceneId ?? ''));
      res.json({ ok: true });
    } catch { res.status(404).json({ error: 'campaign not found' }); }
  });
```

- [ ] **Step 2: routes.test.ts 补测试**

在 `beforeAll` 创建 `CampaignStore`（temp dir）并加入 `createApp` 的 deps。追加用例：
```ts
  it('campaigns CRUD and scene assignment', async () => {
    const c = await request(app).post('/api/campaigns').send({ name: '地牢冒险' });
    expect(c.status).toBe(201);
    const id = c.body.id;
    const list = await request(app).get('/api/campaigns');
    expect(list.body.some((x: any) => x.id === id)).toBe(true);
    const detail = await request(app).get(`/api/campaigns/${id}`);
    expect(detail.body.name).toBe('地牢冒险');
    const scene = await request(app).post('/api/scenes').send({ name: '第一幕' });
    const assign = await request(app).post(`/api/campaigns/${id}/scenes`).send({ sceneId: scene.body.id });
    expect(assign.status).toBe(200);
    const after = await request(app).get(`/api/campaigns/${id}`);
    expect(after.body.sceneIds).toContain(scene.body.id);
    const missing = await request(app).get('/api/campaigns/nope');
    expect(missing.status).toBe(404);
    const del = await request(app).delete(`/api/campaigns/${id}`);
    expect(del.status).toBe(200);
  });
```

- [ ] **Step 3: 跑测试**

Run: `npm test -- server/src/routes.test.ts`
Expected: PASS（含新用例）。

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "feat: 战役 REST 路由"
```

---

## Task 6: WS 集成测试

**Files:**
- Modify: `server/test/ws.test.ts`

**Interfaces:**
- Consumes: `GameServer` 新签名（Task 4）、`CampaignStore`（Task 2）。

- [ ] **Step 1: 更新 ws.test.ts 构造与新增用例**

`beforeAll` 中创建 `CampaignStore` 并传入 `GameServer`：
```ts
import { CampaignStore } from '../src/campaign-store';
...
  const campaignStore = new CampaignStore(path.join(dir, 'campaigns'));
  game = new GameServer(store, campaignStore, { password: 'pw' });
```

新增用例（追加到 `describe('WebSocket 同步')` 内）：
```ts
  it('DM 加入敌人库，玩家收到含敌人的 state', async () => {
    const dm = await connect(dmUrl);
    dm.send(JSON.stringify({ type: 'init', dmToken: 'pw' }));
    await once(dm, 'state');
    const player = await connect(playerUrl);
    player.send(JSON.stringify({ type: 'init' }));
    await once(player, 'state');

    dm.send(JSON.stringify({ type: 'op', ops: [{ op: 'addEnemy', entryId: 'MM__Goblin', nameZh: '地精' }] }));
    const b = await once(player, 'state');
    expect(b.campaign.enemies.some((e: any) => e.entryId === 'MM__Goblin')).toBe(true);

    dm.close();
    player.close();
  });

  it('玩家尝试加敌人被拒绝', async () => {
    const player = await connect(playerUrl);
    player.send(JSON.stringify({ type: 'init' }));
    await once(player, 'state');
    player.send(JSON.stringify({ type: 'op', ops: [{ op: 'addEnemy', entryId: 'x', nameZh: 'y' }] }));
    const err = await once(player, 'error');
    expect(err.message).toMatch(/permission/i);
    player.close();
  });

  it('DM 切换战役，两端收到新战役与场景', async () => {
    const dm = await connect(dmUrl);
    dm.send(JSON.stringify({ type: 'init', dmToken: 'pw' }));
    await once(dm, 'state');
    const player = await connect(playerUrl);
    player.send(JSON.stringify({ type: 'init' }));
    await once(player, 'state');

    const campaign = await game.campaignStore.create('新战役');
    const scene = await game.store.create('战役场景');
    await game.campaignStore.assignScene(campaign.id, scene.id);

    dm.send(JSON.stringify({ type: 'switchCampaign', campaignId: campaign.id }));
    const s1 = await once(dm, 'state');
    const s2 = await once(player, 'state');
    expect(s1.campaign.name).toBe('新战役');
    expect(s2.scene.name).toBe('战役场景');

    dm.close();
    player.close();
  });
```

- [ ] **Step 2: 跑测试**

Run: `npm test -- server/test/ws.test.ts`
Expected: PASS（含 3 个新用例）。

- [ ] **Step 3: 提交**

```bash
git add -A && git commit -m "test: WS 战役集成测试（加敌人/权限/切战役）"
```

---

## Task 7: 前端连接与战役库 UI

**Files:**
- Modify: `client/src/ws.ts`
- Modify: `client/src/api.ts`
- Modify: `client/src/components/QueryPanel.tsx`

**Interfaces:**
- Consumes: `Campaign` 类型（Task 1）、`CampaignStore` 路由（Task 5）、现有 `connection`/`setPending`。
- Produces:
  - `SceneState` 加 `campaign: Campaign | null`
  - `api.campaigns()` / `createCampaign(name)` / `deleteCampaign(id)` / `assignSceneToCampaign(campaignId, sceneId)`
  - 查询面板新增「战役库」标签：敌人列表（头像+名字，＋一键放入 / ✋拿起 / ✕移出）、场景列表（当前战役场景，点击切换）
  - 查询结果怪物行加「加入战役库」按钮（DM，已在库则显示「已在库」）
  - 抽取 `spawnEnemy(entryId, nameZh)`：在 playArea 中心按网格平铺生成 1 个 token（自动编号）

- [ ] **Step 1: ws.ts 加 campaign**

`client/src/ws.ts`：
```ts
import type { Op, Role, Scene, Campaign } from './types';

export interface SceneState {
  scene: Scene | null;
  role: Role;
  online: number;
  connected: boolean;
  campaign: Campaign | null;
}
```
`Connection.lastState` 与 `useScene` 初始 state 同步加 `campaign: Campaign | null`；`onmessage` 中 `case 'state'` 存 `campaign: msg.campaign ?? null`；`onMessage` 补发与 `useScene` 的 `setState` 都带上 `campaign: msg.campaign ?? cur.campaign`。初始：
```ts
lastState: { scene: Scene; role: Role; campaign: Campaign | null } | null = null;
```

- [ ] **Step 2: api.ts 加战役方法**

`client/src/api.ts` 加：
```ts
import type { EntryType, IndexEntry, Scene, Campaign } from './types';
...
  campaigns: () => json<{ id: string; name: string }[]>('/api/campaigns'),
  createCampaign: (name: string) =>
    json<Campaign>('/api/campaigns', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }),
  deleteCampaign: (id: string) => json<{ ok: boolean }>(`/api/campaigns/${id}`, { method: 'DELETE' }),
  assignSceneToCampaign: (campaignId: string, sceneId: string) =>
    json<{ ok: boolean }>(`/api/campaigns/${campaignId}/scenes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sceneId }) }),
```

- [ ] **Step 3: QueryPanel 加「战役库」标签**

`client/src/components/QueryPanel.tsx`：

`type Tab` 改为 `'query' | 'camp' | 'fav'`；`const { scene, role, campaign } = useScene();`。

新增 `spawnEnemy` 与「加入战役库」处理（放在现有 `addMonsterToScene` 附近，复用其中心平铺逻辑）：
```tsx
  const spawnEnemy = (entryId: string, nameZh: string) => {
    if (!scene) return;
    const area = scene.playArea;
    const i = scene.tokens.filter(t => t.entryId === entryId).length;
    const x = area.x + area.w / 2 + (i % 4 - 1) * 100;
    const y = area.y + area.h / 2 + (Math.floor(i / 4) - 1) * 100;
    connection.sendOps([{
      op: 'addToken',
      token: {
        id: `t${Date.now()}-${i}`, kind: 'monster', name: nameZh, entryId,
        x, y, size: 100, avatar: `/api/token/${entryId}`, color: '#fff',
      },
    }]);
  };
  // 把现有 addMonsterToScene 改为调用 spawnEnemy 以消除重复
  const isInLibrary = (entryId: string) => (campaign?.enemies ?? []).some(e => e.entryId === entryId);
```

敌人列表需要头像（`/api/token/<entryId>`）与场景名（`api.scenes()` 拉取 id→name 映射，过滤 `campaign.sceneIds`）。新增 state：
```tsx
  const [sceneNames, setSceneNames] = useState<Record<string, string>>({});
  useEffect(() => {
    api.scenes().then(list => setSceneNames(Object.fromEntries(list.map(s => [s.id, s.name])))).catch(() => {});
  }, []);
```

标签渲染：把顶部两个 tab 改为三个，并在查询/收藏分支后新增 `camp` 分支：
```tsx
        {(['query', 'camp', 'fav'] as Tab[]).map(t => (
          <button key={t} onClick={() => { setTab(t); setDetail(null); }}
            className={`flex-1 py-2 text-center ${tab === t ? 'text-amber-400 border-b-2 border-amber-400' : 'text-zinc-500 hover:text-zinc-300'}`}>
            {t === 'query' ? '查询' : t === 'camp' ? '战役库' : '收藏夹'}
          </button>
        ))}
```

战役库分支（放在 `{tab === 'fav' && (...)}` 之后、`</>` 内）：
```tsx
          {tab === 'camp' && (
            <div className="flex-1 overflow-y-auto">
              <div className="px-3 py-1.5 text-xs text-zinc-500 bg-zinc-800/40">敌人 ({campaign?.enemies.length ?? 0})</div>
              {(campaign?.enemies ?? []).map(e => (
                <div key={e.entryId} className="flex items-center gap-2 px-2 py-1.5 border-b border-zinc-800/50 hover:bg-zinc-800/50">
                  <img src={`/api/token/${e.entryId}`} alt="" className="w-6 h-6 rounded-full bg-zinc-700 shrink-0" />
                  <span className="flex-1 truncate text-zinc-200">{e.nameZh}</span>
                  <button onClick={() => spawnEnemy(e.entryId, e.nameZh)} title="一键放入当前场景"
                    className="shrink-0 px-1.5 py-0.5 rounded bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 text-xs">＋</button>
                  <button onClick={() => setPending({ kind: 'monster', name: e.nameZh, entryId: e.entryId, avatar: `/api/token/${e.entryId}`, color: '#fff' })}
                    title="拿起放置" className="shrink-0 px-1.5 py-0.5 rounded hover:bg-zinc-700 text-zinc-300 text-xs">✋</button>
                  {role === 'dm' && (
                    <button onClick={() => connection.sendOps([{ op: 'removeEnemy', entryId: e.entryId }])}
                      title="移出战役库" className="shrink-0 px-1.5 py-0.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-red-400 text-xs">✕</button>
                  )}
                </div>
              ))}
              {(campaign?.enemies.length ?? 0) === 0 && <div className="p-3 text-zinc-500 text-xs">战役库为空，搜索怪物后点「加入战役库」</div>}
              <div className="px-3 py-1.5 text-xs text-zinc-500 bg-zinc-800/40 mt-2">场景 ({campaign?.sceneIds.length ?? 0})</div>
              {(campaign?.sceneIds ?? []).map(sid => (
                <button key={sid} onClick={() => connection.sendControl({ type: 'switchScene', sceneId: sid })}
                  className="w-full text-left px-3 py-1.5 border-b border-zinc-800/50 hover:bg-zinc-800 text-zinc-200">
                  {sceneNames[sid] ?? sid}
                </button>
              ))}
            </div>
          )}
```

查询结果行内，在「＋ 添加」按钮后加「加入战役库」（仅 DM 怪物）：
```tsx
                  {role === 'dm' && r.type === 'monster' && (
                    <button
                      onClick={() => connection.sendOps([{ op: 'addEnemy', entryId: r.id, nameZh: r.nameZh }])}
                      title="加入战役库"
                      className={`shrink-0 mr-1 px-1.5 py-0.5 rounded text-xs ${isInLibrary(r.id) ? 'text-zinc-600' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
                      disabled={isInLibrary(r.id)}
                    >{isInLibrary(r.id) ? '已在库' : '入库'}</button>
                  )}
```
并确保 `setPending` 已导入（现有已导入）。

- [ ] **Step 4: 跑测试与类型检查**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean，全部测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat: 查询面板战役库标签（一键/拿起/移出 + 加入战役库）"
```

---

## Task 8: 战役切换 + 场景过滤 + 新场景归属

**Files:**
- Create: `client/src/components/CampaignSwitcher.tsx`
- Modify: `client/src/components/TopBar.tsx`
- Modify: `client/src/components/SceneSwitcher.tsx`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `api` 战役方法（Task 7）、`useScene().campaign`（Task 7）、`connection`。
- Produces:
  - `CampaignSwitcher` 弹层：战役列表 + 新建 + 删除 + 切换（`sendControl({type:'switchCampaign'})`）
  - TopBar 战役名显示 + 切换入口
  - `SceneSwitcher` 只列当前战役场景；新建场景后 `assignSceneToCampaign` 归属当前战役

- [ ] **Step 1: 实现 `client/src/components/CampaignSwitcher.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { connection } from '../ws';

export default function CampaignSwitcher({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState('');
  const reload = () => api.campaigns().then(setList);
  useEffect(() => { reload(); }, []);

  return (
    <div className="absolute top-11 left-0 z-20 w-64 bg-zinc-800 border border-zinc-700 rounded shadow-xl p-2 text-sm">
      <div className="text-xs text-zinc-500 mb-1">战役列表</div>
      {list.map(c => (
        <div key={c.id} className="flex items-center gap-2 py-1 px-1 rounded hover:bg-zinc-700">
          <button className="flex-1 text-left" onClick={() => { connection.sendControl({ type: 'switchCampaign', campaignId: c.id }); onClose(); }}>
            {c.name}
          </button>
          <button className="text-zinc-500 hover:text-red-400" title="删除战役（不删场景）"
            onClick={() => { api.deleteCampaign(c.id).then(reload); }}>✕</button>
        </div>
      ))}
      <div className="flex gap-1 mt-2 border-t border-zinc-700 pt-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="新战役名"
          className="flex-1 bg-zinc-900 rounded px-2 py-1 text-sm" />
        <button onClick={() => { if (name.trim()) api.createCampaign(name.trim()).then(reload); setName(''); }}
          className="px-2 py-1 rounded bg-amber-600/20 text-amber-400">＋</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TopBar 加战役名与切换入口**

`client/src/components/TopBar.tsx`：
```tsx
import { useScene, connection } from '../ws';
import CampaignSwitcher from './CampaignSwitcher';
...
  const { scene, role, online, campaign } = useScene();
  const [campaignOpen, setCampaignOpen] = useState(false);
```
场景名旁显示战役名（DM 显示切换按钮；玩家只读显示）：
```tsx
      <span className="text-zinc-500 truncate">战役「{campaign?.name ?? '…'}」 / 场景「{scene?.name ?? '连接中…'}」</span>
```
在右侧按钮区（DM）加：
```tsx
        {isDm && (
          <button onClick={() => { setCampaignOpen(o => !o); setSwitcherOpen(false); }}
            className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300">战役▾</button>
        )}
```
在现有 SceneSwitcher 弹层后加：
```tsx
      {campaignOpen && <CampaignSwitcher onClose={() => setCampaignOpen(false)} />}
```

- [ ] **Step 3: SceneSwitcher 过滤当前战役场景 + 新场景归属**

`client/src/components/SceneSwitcher.tsx`：从 `useScene` 取 `campaign`，仅渲染 `campaign.sceneIds` 内的场景；新建后调用 `assignSceneToCampaign`：
```tsx
import { useScene } from '../ws';
...
  const { campaign } = useScene();
  const visible = scenes.filter(s => (campaign?.sceneIds ?? []).includes(s.id));
  // 渲染用 visible 替代 scenes
  ...
  onClick={() => {
    if (name.trim()) {
      api.createScene(name.trim()).then(async s => {
        if (campaign) await api.assignSceneToCampaign(campaign.id, s.id);
        reload();
      });
    }
    setName('');
  }}
```

- [ ] **Step 4: 类型检查与全量测试**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean，全部测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat: 战役切换器 + 场景按战役过滤/归属"
```

---

## Task 9: 端到端手动验收

**Files:** 无（验证）。

- [ ] **Step 1: 重建并重启**

```bash
npm run build && pkill -f "tsx server/src/index.ts"; sleep 1; nohup npm start > /tmp/dnd-server.log 2>&1 & disown; sleep 3; curl -s http://localhost:3001/api/health
```

- [ ] **Step 2: 验收清单**

- [ ] 启动后自动建「默认战役」，现有场景（默认场景）在其中；TopBar 显示「战役『默认战役』 / 场景『…』」
- [ ] 查询「地精」→ 点「入库」→ 查询面板「战役库」标签出现地精（头像+名字）
- [ ] 战役库点「＋」→ 当前场景中心生成地精 token（自动编号）；点「✋」→ 拿起 → 点画布放置
- [ ] 战役库「✕」→ 敌人移出库
- [ ] 新建场景 → 出现在「战役库」场景列表与场景切换器；切换到它
- [ ] TopBar「战役▾」→ 新建「沙漠远征」→ 切换 → 载入该战役首个场景（或新建空场景）
- [ ] 玩家端刷新后能看到当前战役名与场景，战役库只读（无 ✕/入库）
- [ ] 玩家尝试发 `addEnemy` → 控制台收到 permission 错误

- [ ] **Step 3: 修复发现的问题并提交**

如有问题按 systematic-debugging 处理，修复后 `npm test && git commit`。

---

## 自审记录

- **规格覆盖**：战役模型（T1）✓、存储迁移（T2/T4）✓、op 与权限（T3）✓、GameServer 集成（T4）✓、REST（T5）✓、WS 集成测试（T6）✓、战役库 UI 与入库（T7）✓、战役切换与场景归属（T8）✓、验收（T9）✓。
- **类型一致性**：`Campaign`/`EnemyTemplate` 在 shared/types、campaign-store、campaign-ops、game、routes、client 间一致；`GameServer` 构造签名 `(store, campaignStore, opts)` 在 game.ts/index.ts/ws.test.ts 同步；`SceneState.campaign` 在 ws.ts/QueryPanel/TopBar/SceneSwitcher 一致。
- **占位符**：无 TBD/TODO；每个步骤含完整代码或精确指令。
- **已知取舍**：战役列表用目录扫描（去 index.json，避免同步问题，已同步设计文档）；`switchCampaign` 走 GameServer 而非 `applyCampaignOp`（需 store/场景）；删除战役不删场景，未归属场景由下次 `init` 的迁移逻辑重新处理。
