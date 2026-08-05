# 玩家端实施计划（玩家自维护 token + 先攻入队）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 玩家首次连接自动获得自己的 token（身份经 sessionId 持久），只维护自己的 token（拖拽/改名/改色/HP），手动输入先攻加入全队队列。方案 A：服务器权威 + sessionId 权限过滤。

**Architecture:** 服务器 `GameServer` 持有每个连接的 `sessionId`；`init` 时 `ensurePlayerToken` 自动在场景创建/复用玩家的 `PlayerToken`；切场景/战役后为所有玩家补建 token。玩家 op 的 `moveToken`/`updatePlayer` 经所有权过滤（仅自己的 sessionId）。客户端发送 sessionId，左侧面板玩家端显示「我的角色（上）+ 敌人（下，可滚动）」，先攻面板自动选中自己的 token，棋盘只允许拖自己的 token。

**Tech Stack:** 不变（Node/Express/ws、React/Konva/Tailwind、TS strict、Vitest）。

## Global Constraints

- TypeScript strict；界面文案一律中文；代码标识符/注释用英文。
- `canOp` 保持角色级纯函数（DM 全部 / 玩家 `moveToken`+`submitInitiative`）；所有权检查在 GameServer 层。
- 玩家 token 自动创建失败不致命；玩家改/拖他人 token 被拒。
- 玩家 token 名「玩家N」递增；颜色取预设色板。
- `npm test` 全绿、`npx tsc --noEmit` 干净、`npm run build` 成功。
- 每任务结束必须测试通过并 git commit。

---

## 文件结构

```
shared/types.ts                       updatePlayer patch 加 hp
server/src/game.ts                    Client.sessionId、ensurePlayerToken、所有权过滤
server/src/game.test.ts               ensurePlayerToken / 所有权过滤单测
server/test/ws.test.ts                玩家集成测试（改现有「玩家可移动 token」用例）
client/src/ws.ts                      getMySessionId()、init 携带 sessionId
client/src/components/InitiativePanel.tsx  玩家端自动选中自己的 token
client/src/components/EnemyList.tsx   玩家端「我的角色」区块（上）+ 敌人（下）
client/src/components/BoardCanvas.tsx 玩家只可拖自己的 token
docs/superpowers/specs/2026-08-05-player-side-design.md  已确认
```

---

## Task 1: updatePlayer 支持 hp

**Files:**
- Modify: `shared/types.ts`
- Modify: `server/src/ops.test.ts`

**Interfaces:**
- Produces: `updatePlayer` op 的 patch 类型含 `hp`。

- [ ] **Step 1: shared/types.ts 改 patch 类型**

```ts
  | { op: 'updatePlayer'; tokenId: string; patch: Partial<Pick<PlayerToken, 'name' | 'color' | 'sessionId' | 'hp'>> }
```

- [ ] **Step 2: ops.test.ts 补用例**

在 `describe('applyOp players')` 内追加：
```ts
  it('updatePlayer applies hp patch', () => {
    const s = freshScene();
    applyOp(s, { op: 'addPlayer', player: { id: 'p1', kind: 'player', name: '阿拉贡', entryId: null, x: 0, y: 0, size: 100, avatar: '', color: '#e53e3e', sessionId: 's1' } });
    applyOp(s, { op: 'updatePlayer', tokenId: 'p1', patch: { hp: { current: 12, max: 12 } } });
    expect(s.players[0].hp).toEqual({ current: 12, max: 12 });
  });
```

- [ ] **Step 3: 跑测试**

Run: `npm test -- server/src/ops.test.ts` → PASS。
Run: `npx tsc --noEmit` → clean。

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "feat: updatePlayer 支持 hp patch"
```

---

## Task 2: GameServer sessionId + ensurePlayerToken

**Files:**
- Modify: `server/src/game.ts`
- Modify: `server/src/game.test.ts`

**Interfaces:**
- Consumes: `newId`（`./scene`，已导入）、`Client` 结构。
- Produces:
  - `Client.sessionId: string`
  - `init` 消息读取 `msg.sessionId` 存入 Client
  - `ensurePlayerToken(scene: Scene, sessionId: string): boolean`（无则建、返回是否改动）
  - init（player）+ switchScene + switchCampaign 后调用并保存/广播

- [ ] **Step 1: 写失败测试（game.test.ts 追加 describe）**

```ts
import { GameServer } from './game';
import { CampaignStore } from './campaign-store';
import { SceneStore } from './store';
// 已有 imports 保留；追加 createCampaign/Scene 类型若需要

describe('ensurePlayerToken', () => {
  let dir: string;
  let game: GameServer;
  let store: SceneStore;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-'));
    store = new SceneStore(path.join(dir, 'scenes'));
    game = new GameServer(store, new CampaignStore(path.join(dir, 'campaigns')), { password: null });
    await game.init();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('creates a token for a new sessionId with 玩家N name and binds sessionId', () => {
    // init() 自动建了「默认场景」；把当前场景推入当前战役
    (game as any).ensurePlayerToken(game.current, 'sess-a');
    const p = game.current.players.find(x => x.sessionId === 'sess-a');
    expect(p).toBeTruthy();
    expect(p!.name).toMatch(/^玩家\d+$/);
    expect(p!.color).toMatch(/^#/);
  });

  it('reuses the existing token for the same sessionId', () => {
    (game as any).ensurePlayerToken(game.current, 'sess-a');
    (game as any).ensurePlayerToken(game.current, 'sess-a');
    expect(game.current.players.filter(x => x.sessionId === 'sess-a')).toHaveLength(1);
  });

  it('assigns increasing 玩家N names', () => {
    (game as any).ensurePlayerToken(game.current, 'sess-a');
    (game as any).ensurePlayerToken(game.current, 'sess-b');
    const names = game.current.players.map(p => p.name).sort();
    expect(names[0]).toBe('玩家1');
    expect(names[1]).toBe('玩家2');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- server/src/game.test.ts` → FAIL（`ensurePlayerToken` 不存在 / `Client.sessionId` 缺失）。

- [ ] **Step 3: 实现 game.ts**

`Client` interface 加 `sessionId: string`：
```ts
interface Client {
  ws: WebSocket;
  role: Role;
  name: string;
  sessionId: string;
  dmToken?: string;
}
```
`attach` 中初始化 `const client: Client = { ws, role: 'player', name: '', sessionId: '' };`

`handle` `case 'init'` 中保存 sessionId 并在玩家角色时确保 token：
```ts
        client.sessionId = String(msg.sessionId ?? '');
        // ... 现有 roleFor/DND_TEST_ROLE 逻辑不变 ...
        if (client.role === 'player' && client.sessionId && this.ensurePlayerToken(this.current, client.sessionId)) {
          this.store.save(this.current);
          this.broadcast({ type: 'state', scene: this.current, campaign: this.currentCampaign });
        }
        client.ws.send(JSON.stringify({ type: 'state', scene: this.current, role: client.role, campaign: this.currentCampaign }));
```

新增方法（放在 `campaignForScene` 附近）：
```ts
  // Ensure the player's token exists in this scene, creating it if missing.
  // Returns true if the scene's players array was mutated (needs a save).
  private ensurePlayerToken(scene: Scene, sessionId: string): boolean {
    if (scene.players.some(p => p.sessionId === sessionId)) return false;
    let n = 1;
    for (const p of scene.players) {
      const m = /^玩家(\d+)$/.exec(p.name);
      if (m) n = Math.max(n, Number(m[1]) + 1);
    }
    const colors = ['#e53e3e', '#38a169', '#3182ce', '#d69e2e', '#805ad5', '#dd6b20', '#319795', '#d53f8c'];
    scene.players.push({
      id: newId('p'),
      kind: 'player',
      name: `玩家${n}`,
      entryId: null,
      x: 150 + (n * 40) % 600,
      y: 150 + (n * 30) % 400,
      size: 100,
      avatar: '',
      color: colors[n % colors.length],
      sessionId,
    });
    return true;
  }

  // Ensure every connected player has a token in the given scene.
  private async ensureAllPlayerTokens(scene: Scene): Promise<void> {
    let changed = false;
    for (const c of this.clients) {
      if (c.role === 'player' && c.sessionId && this.ensurePlayerToken(scene, c.sessionId)) changed = true;
    }
    if (changed) this.store.save(scene);
  }
```

`switchScene` 末尾（setLast 与 broadcast 之间）加：
```ts
    await this.ensureAllPlayerTokens(this.current);
```
`switchCampaign` 末尾（setLast 与 broadcast 之间）加：
```ts
    await this.ensureAllPlayerTokens(this.current);
```

- [ ] **Step 4: 跑测试**

Run: `npm test -- server/src/game.test.ts` → PASS（含新用例）。
Run: `npm test` → 全绿。
Run: `npx tsc --noEmit` → clean。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat: GameServer 自动创建/复用玩家 token（sessionId）"
```

---

## Task 3: 所有权权限过滤

**Files:**
- Modify: `server/src/game.ts`
- Modify: `server/src/game.test.ts`

**Interfaces:**
- Consumes: `Client.sessionId`（Task 2）。
- Produces:
  - `ownsToken(client: Client, tokenId: string): boolean`
  - `case 'op'` 中玩家 `moveToken`/`updatePlayer` 所有权过滤，未通过进 denied

- [ ] **Step 1: 写失败测试（game.test.ts 追加）**

```ts
describe('player ownership filter', () => {
  // 复用 Task 2 的 temp dir 模式（beforeEach/afterEach）
  it('player can move own token, cannot move a monster', () => {
    const dmClient = { role: 'dm' as Role, sessionId: '' };
    const player = { role: 'player' as Role, sessionId: 'sess-a' };
    // 放一个怪物
    applyOp(game.current, { op: 'addToken', token: { id: 'm1', kind: 'monster', name: '地精', entryId: 'MM__Goblin', x: 0, y: 0, size: 100, avatar: '', color: '#fff' } });
    (game as any).ensurePlayerToken(game.current, 'sess-a');
    const p = game.current.players[0];
    expect((game as any).ownsToken(player, p.id)).toBe(true);
    expect((game as any).ownsToken(player, 'm1')).toBe(false);
    expect((game as any).ownsToken(dmClient, 'm1')).toBe(true);
  });

  it('player cannot updatePlayer on another player token', () => {
    (game as any).ensurePlayerToken(game.current, 'sess-a');
    (game as any).ensurePlayerToken(game.current, 'sess-b');
    const pB = game.current.players.find(x => x.sessionId === 'sess-b')!;
    const playerA = { role: 'player' as Role, sessionId: 'sess-a' };
    expect((game as any).ownsToken(playerA, pB.id)).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- server/src/game.test.ts` → FAIL（`ownsToken` 不存在）。

- [ ] **Step 3: 实现 game.ts**

新增方法：
```ts
  // A player may only move/update their own token; DM owns everything.
  private ownsToken(client: Client, tokenId: string): boolean {
    if (client.role === 'dm') return true;
    const p = this.current.players.find(x => x.id === tokenId);
    return p != null && p.sessionId != null && p.sessionId === client.sessionId;
  }
```

`handle` `case 'op'` 替换为含所有权过滤：
```ts
      case 'op': {
        const ops = Array.isArray(msg.ops) ? msg.ops : [];
        const roleAllowed = ops.filter((op: Op) => canOp(client.role, op));
        // 玩家只能 move/update 自己的 token（所有权过滤）
        const allowed = roleAllowed.filter((op: Op) => {
          if (op.op === 'moveToken') return this.ownsToken(client, op.tokenId);
          if (op.op === 'updatePlayer') return this.ownsToken(client, op.tokenId);
          return true;
        });
        const denied = ops.filter((op: Op) => !canOp(client.role, op) || !allowed.some(o => o === op));
        if (allowed.length > 0) {
          const campaignOps = allowed.filter(isCampaignOp);
          const sceneOps = allowed.filter((op: Op) => !isCampaignOp(op));
          this.opQueue = this.opQueue
            .then(() => this.applyAllowedOps(campaignOps, sceneOps))
            .catch(() => {
              client.ws.send(JSON.stringify({ type: 'error', message: 'op apply failed' }));
            });
        }
        if (denied.length > 0) {
          client.ws.send(JSON.stringify({ type: 'error', message: 'permission denied for some ops' }));
        }
        return;
      }
```

- [ ] **Step 4: 跑测试**

Run: `npm test -- server/src/game.test.ts` → PASS。
Run: `npm test` → 全绿。
Run: `npx tsc --noEmit` → clean。

- [ ] **Step 5: 提交**

```bash
git add -A && git commit -m "feat: 玩家 move/update 仅限自己的 token（所有权过滤）"
```

---

## Task 4: WS 集成测试（改现有用例 + 新增）

**Files:**
- Modify: `server/test/ws.test.ts`

**Interfaces:**
- Consumes: Task 2/3 行为。
- Produces: 玩家自动建 token、拖自己广播、拖怪物被拒、改他人被拒、提交先攻自己的、切场景 token 跟随。

- [ ] **Step 1: 改现有「玩家可移动 token」用例**

现有用例中玩家移动怪物 `t1`——所有权过滤后会**被拒**。改为：玩家带 sessionId init，先自动建自己的 token，再移动**自己的** token。替换该 `it` 块：

```ts
  it('玩家自动创建 token，可移动自己的 token，DM 可放置怪物', async () => {
    const dm = await connect(baseUrl);
    dm.send(JSON.stringify({ type: 'init', role: 'dm', dmToken: 'pw' }));
    await once(dm, 'state');

    const player = await connect(baseUrl);
    player.send(JSON.stringify({ type: 'init', role: 'player', sessionId: 'ps-1' }));
    const pState = await once(player, 'state');
    const my = pState.scene.players.find((x: any) => x.sessionId === 'ps-1');
    expect(my).toBeTruthy();

    // 玩家拖自己的 token → 广播
    player.send(JSON.stringify({ type: 'op', ops: [{ op: 'moveToken', tokenId: my.id, x: 500, y: 500 }] }));
    const b2 = await once(dm, 'state');
    expect(b2.scene.players.find((x: any) => x.id === my.id)).toMatchObject({ x: 500, y: 500 });

    // DM 放置一个怪物
    dm.send(JSON.stringify({ type: 'op', ops: [{ op: 'addToken', token: { id: 't1', kind: 'monster', name: '地精', entryId: 'MM__Goblin', x: 0, y: 0, size: 100, avatar: '/api/token/MM__Goblin', color: '#fff' } }] }));
    await once(player, 'state');

    // 玩家尝试拖怪物 → 被拒
    player.send(JSON.stringify({ type: 'op', ops: [{ op: 'moveToken', tokenId: 't1', x: 100, y: 100 }] }));
    const err = await once(player, 'error');
    expect(err.message).toMatch(/permission/i);

    dm.close();
    player.close();
  });
```

- [ ] **Step 2: 追加用例**

```ts
  it('玩家改他人 token 被拒；提交先攻自动关联自己的 token', async () => {
    const player = await connect(baseUrl);
    player.send(JSON.stringify({ type: 'init', role: 'player', sessionId: 'ps-2' }));
    const st = await once(player, 'state');
    const my = st.scene.players.find((x: any) => x.sessionId === 'ps-2');

    // 尝试改他人的（不存在的）token
    player.send(JSON.stringify({ type: 'op', ops: [{ op: 'updatePlayer', tokenId: 'nobody', patch: { name: 'X' } }] }));
    const err = await once(player, 'error');
    expect(err.message).toMatch(/permission/i);

    // 提交先攻：tokenId 为自己的
    player.send(JSON.stringify({ type: 'op', ops: [{ op: 'submitInitiative', name: my.name, value: 14, tokenId: my.id, sessionId: 'ps-2' }] }));
    const st2 = await once(player, 'state');
    expect(st2.scene.initiative.some((e: any) => e.tokenId === my.id && e.value === 14)).toBe(true);

    player.close();
  });

  it('切场景后玩家 token 跟随到新场景', async () => {
    const dm = await connect(baseUrl);
    dm.send(JSON.stringify({ type: 'init', role: 'dm', dmToken: 'pw' }));
    await once(dm, 'state');
    const player = await connect(baseUrl);
    player.send(JSON.stringify({ type: 'init', role: 'player', sessionId: 'ps-3' }));
    await once(player, 'state');

    const campaign = await game.campaignStore.create('战役B');
    const scene = await game.store.create('场景B');
    await game.campaignStore.assignScene(campaign.id, scene.id);
    dm.send(JSON.stringify({ type: 'switchCampaign', campaignId: campaign.id }));
    const s1 = await once(dm, 'state');
    const s2 = await once(player, 'state');
    expect(s1.scene.players.some((x: any) => x.sessionId === 'ps-3')).toBe(true);
    expect(s2.scene.players.some((x: any) => x.sessionId === 'ps-3')).toBe(true);

    dm.close();
    player.close();
  });
```

- [ ] **Step 3: 跑测试**

Run: `npm test -- server/test/ws.test.ts` → PASS。
Run: `npm test` → 全绿。
Run: `npx tsc --noEmit` → clean。

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "test: 玩家 token 自动创建/所有权/切场景跟随 集成测试"
```

---

## Task 5: 客户端 sessionId + 先攻自动选中自己的 token

**Files:**
- Modify: `client/src/ws.ts`
- Modify: `client/src/components/InitiativePanel.tsx`

**Interfaces:**
- Consumes: `Client.sessionId` 协议（Task 2）。
- Produces:
  - `getMySessionId(): string`（localStorage `player-session-id`，无则生成）
  - init 携带 sessionId
  - InitiativePanel 玩家端自动使用自己的 token

- [ ] **Step 1: ws.ts 加 getMySessionId 并在 init 携带**

`client/src/ws.ts`：
```ts
// Stable per-browser player identity; the server binds the player's token to it.
export function getMySessionId(): string {
  let sid = localStorage.getItem('player-session-id');
  if (!sid) {
    sid = crypto.randomUUID();
    localStorage.setItem('player-session-id', sid);
  }
  return sid;
}
```
`connect()` 的 `onopen` 发送：
```ts
      this.sendControl({ type: 'init', dmToken: this.dmToken ?? undefined, sessionId: getMySessionId() });
```

- [ ] **Step 2: InitiativePanel 玩家端自动选中**

`client/src/components/InitiativePanel.tsx`：
```ts
import { getMySessionId } from '../ws';
...
  const mySessionId = getMySessionId();
  const myToken = scene?.players.find(p => p.sessionId === mySessionId) ?? null;
```
玩家端 `submit` 的 tokenId 改为 `myToken?.id ?? null`：
```ts
    connection.sendOps([{ op: 'submitInitiative', name: myToken?.name ?? `玩家${value}`, value: v, tokenId: myToken?.id ?? null, sessionId: sid }]);
```
玩家端渲染：移除 `<select>` 下拉，改为只读显示自己的名字（或「未认领」）：
```tsx
        <div className="shrink-0 flex items-center gap-1">
          <span className="text-emerald-300 text-xs shrink-0">{myToken ? myToken.name : '未认领角色'}</span>
          <input value={value} onChange={e => setValue(e.target.value)} placeholder="先攻值"
            className="w-16 bg-zinc-800 rounded px-2 py-0.5 text-center" />
          <button onClick={submit} disabled={!myToken}
            className="px-2 py-0.5 rounded bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 disabled:opacity-40">提交</button>
        </div>
```
删除 `myToken` state（原下拉）、`myToken` 相关代码；`submit` 用上面新的。

- [ ] **Step 3: 类型检查 + 构建**

Run: `npx tsc --noEmit` → clean；`npm test` → 全绿；`npm run build` → 成功。

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "feat: 客户端 sessionId + 先攻自动选中自己的 token"
```

---

## Task 6: 左侧面板玩家端「我的角色」

**Files:**
- Modify: `client/src/components/EnemyList.tsx`

**Interfaces:**
- Consumes: `getMySessionId`（Task 5）、`updatePlayer` op。
- Produces: 玩家端顶部「我的角色」区块（改名/改色/HP）+ 下方敌人列表；DM 端不变。

- [ ] **Step 1: EnemyList 玩家端加「我的角色」**

`client/src/components/EnemyList.tsx`：
```ts
import { getMySessionId } from '../ws';
import type { PlayerToken, Token } from '../types';
...
  const mySessionId = getMySessionId();
  const myToken: PlayerToken | undefined = scene?.players.find(p => p.sessionId === mySessionId);
```
新增状态（改色/改名/HP 编辑）：
```ts
  const [editName, setEditName] = useState(false);
  const [nameVal, setNameVal] = useState('');
  const [hpEdit, setHpEdit] = useState(false);
  const [hpCur, setHpCur] = useState('');
  const [hpMax, setHpMax] = useState('');
  const PALETTE = ['#e53e3e', '#38a169', '#3182ce', '#d69e2e', '#805ad5', '#dd6b20', '#319795', '#d53f8c'];
```
面板顶部（`role === 'player' && myToken`）渲染「我的角色」区块，置于敌人列表之前：
```tsx
      {role === 'player' && myToken && (
        <div className="px-2 py-2 border-b border-zinc-800 bg-zinc-800/30">
          <div className="text-xs text-zinc-400 mb-1">我的角色</div>
          <div className="flex items-center gap-1.5">
            {editName ? (
              <input autoFocus value={nameVal} onChange={e => setNameVal(e.target.value)}
                onBlur={() => { if (nameVal.trim()) connection.sendOps([{ op: 'updatePlayer', tokenId: myToken.id, patch: { name: nameVal.trim().slice(0, 20) } }]); setEditName(false); }}
                onKeyDown={e => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }}
                className="flex-1 min-w-0 bg-zinc-900 rounded px-1 py-0.5 text-sm" />
            ) : (
              <button className="flex-1 min-w-0 text-left truncate text-zinc-100"
                onClick={() => { setNameVal(myToken.name); setEditName(true); }}>{myToken.name} ✎</button>
            )}
            <span className="shrink-0 text-[10px] text-zinc-500">HP</span>
            {hpEdit ? (
              <input autoFocus value={hpCur} onChange={e => setHpCur(e.target.value)}
                onBlur={() => { const c = Number(hpCur), m = Number(hpMax); if (Number.isFinite(c) && Number.isFinite(m)) connection.sendOps([{ op: 'updatePlayer', tokenId: myToken.id, patch: { hp: { current: c, max: m } } }]); setHpEdit(false); }}
                onKeyDown={e => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }}
                className="w-8 bg-zinc-900 rounded px-1 py-0.5 text-center text-xs" />
            ) : (
              <button className="shrink-0 text-emerald-400 text-xs" onClick={() => { setHpCur(String(myToken.hp?.current ?? '')); setHpMax(String(myToken.hp?.max ?? '')); setHpEdit(true); }}>
                {myToken.hp ? `${myToken.hp.current}/${myToken.hp.max}` : '—'}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {PALETTE.map(c => (
              <button key={c} onClick={() => connection.sendOps([{ op: 'updatePlayer', tokenId: myToken.id, patch: { color: c } }])}
                className={`w-4 h-4 rounded-full ${myToken.color === c ? 'ring-2 ring-white' : ''}`} style={{ background: c }} />
            ))}
          </div>
        </div>
      )}
```
玩家端敌人列表容器保持 `flex-1 overflow-y-auto`（已有），实现「敌人较长时滑动」。

- [ ] **Step 2: 类型检查 + 构建**

Run: `npx tsc --noEmit` → clean；`npm test` → 全绿；`npm run build` → 成功。

- [ ] **Step 3: 提交**

```bash
git add -A && git commit -m "feat: 玩家端左侧「我的角色」面板（改名/改色/HP）+ 敌人列表"
```

---

## Task 7: 棋盘拖拽门控（玩家仅自己的 token）

**Files:**
- Modify: `client/src/components/BoardCanvas.tsx`

**Interfaces:**
- Consumes: `getMySessionId`（Task 5）。
- Produces: 玩家角色只可拖自己的 token，DM 可拖全部。

- [ ] **Step 1: BoardCanvas 按角色门控 draggable**

`client/src/components/BoardCanvas.tsx`：
```ts
import { getMySessionId } from '../ws';
...
  const mySessionId = getMySessionId();
```
怪物 token 的 `TokenShape` `draggable` 改为：
```tsx
            draggable={role === 'dm' && tool !== 'wall'}
```
玩家 token 的 `TokenShape` `draggable` 改为：
```tsx
            draggable={tool !== 'wall' && (role === 'dm' || p.sessionId === mySessionId)}
```
（怪物段与玩家段两处各自调整。）

- [ ] **Step 2: 类型检查 + 构建**

Run: `npx tsc --noEmit` → clean；`npm test` → 全绿；`npm run build` → 成功。

- [ ] **Step 3: 提交**

```bash
git add -A && git commit -m "feat: 棋盘只允许玩家拖自己的 token"
```

---

## Task 8: 端到端手动验收

**Files:** 无（验证）。

- [ ] **Step 1: 重建并重启**

```bash
npm run build && pkill -f "tsx server/src/index.ts"; sleep 1; nohup npm start > /tmp/dnd-server.log 2>&1 & disown; sleep 3; curl -s http://localhost:3001/api/health
```

- [ ] **Step 2: 验收清单**

- [ ] 玩家浏览器（局域网 IP）打开 → 左侧出现「我的角色」面板（自动创建「玩家1」+ 随机色），棋盘出现其 token
- [ ] 玩家拖自己的 token → 位置变化并广播到 DM 端；拖怪物/其他玩家 token → 拖不动
- [ ] 玩家改名/改色/改 HP → 生效并同步到 DM 端
- [ ] 玩家在先攻栏输入先攻值提交 → 加入全队队列（带自己的 tokenId，可被金色高亮）
- [ ] 玩家刷新页面 → 仍是同一个「玩家1」token（sessionId 持久）
- [ ] DM 切场景 → 玩家 token 自动出现在新场景
- [ ] 玩家端「我的角色」在上、敌人列表在下，敌人多时可滚动

- [ ] **Step 3: 修复发现的问题并提交**

如有问题按 systematic-debugging 处理，修复后 `npm test && git commit`。

---

## 自审记录

- **规格覆盖**：updatePlayer hp（T1）✓、ensurePlayerToken 创建/复用/跟随（T2/T4）✓、所有权过滤（T3）✓、客户端 sessionId（T5）✓、先攻自动选中（T5）✓、我的角色面板（T6）✓、棋盘拖拽门控（T7）✓、验收（T8）✓。
- **类型一致性**：`Client.sessionId` 在 game.ts 内一致；`updatePlayer` patch 的 hp 在 shared/types 与 ops.test 一致；`getMySessionId` 在 ws.ts 定义、InitiativePanel/EnemyList/BoardCanvas 消费。
- **已知测试影响**：现有「玩家可移动 token」用例因所有权过滤需改写（Task 4 Step 1 已含替换代码）。
- **占位符**：无 TBD/TODO；每步含完整代码。
- **明确不做**：玩家头像、玩家删除自己 token、玩家自动掷先攻、DM 玩家管理面板。
