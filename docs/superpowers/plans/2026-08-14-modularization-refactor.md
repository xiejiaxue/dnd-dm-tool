# 模块化解耦重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 2026-08-14 设计文档，将 worker/client 现有代码按功能与领域拆分为独立模块，收紧模块边界，零行为变化。

**Architecture:** worker 拆为 入口(index)+router+control-plane(rooms/assets/gateway/audit)+compendium+board(room-do/protocol/persistence/patches/domain)；client 拆为 app/room/features/*/lib/*（lib/ws 三拆、BoardCanvas 五拆）。所有代码为"移动 + 拆分"，HTTP/WS 协议、DB schema、UI 行为不变。

**Tech Stack:** TypeScript 5.5、Cloudflare Workers（Durable Object + D1 + R2）、React 18 + Vite 6 + Konva、Vitest 4。

## Global Constraints

（来自设计文档 `docs/superpowers/specs/2026-08-14-modularization-refactor-design.md`，每个任务都隐式包含本节约束）

1. **零行为变化**：HTTP API、WebSocket 协议、D1/DO schema（`worker/migrations/`）、UI 表现逐字保留
2. **不引入新依赖**；不新增路径别名（import 一律相对路径）
3. **`shared/types.ts` 不拆分**（旧 `server/` 仍被 `npm run test:domain` 编译）
4. **`wrangler.jsonc` 与 `worker/migrations/` 零改动**；`worker/src/index.ts` 必须继续具名导出 `RoomDurableObject` 与 `OnlineCompendiumRateLimitDurableObject`（类名不变）
5. **`server/` 与 `scripts/` 目录不动**
6. 工作区存在**未提交的进行中修改（WIP）**——本计划所有提交只 `git add` 本任务涉及的文件；Task 1 负责基线处理
7. 每个任务以 `npm run check:worker`（worker 任务）或 `npx tsc --noEmit -p tsconfig.json`（client 任务）+ 相应 vitest + 提交结束
8. 约定：本计划中"**原样搬移**"指把源文件指定行号的代码复制到目标文件，不改任何逻辑，仅调整 import 语句
9. 提交信息格式：`refactor: <描述>`，末尾附 `Co-Authored-By: Claude <noreply@anthropic.com>`（所有任务统一，不再重复书写）

---

### Task 1: 基线确认（WIP 处理 + 绿色基线）

**Files:**
- 无代码文件

**Interfaces:**
- Consumes: 无
- Produces: 干净的 git 基线，后续任务基于此开始

- [ ] **Step 1: 查看工作区状态**

```bash
cd /Users/xiejiaxue/developer/dndboard/dnd-dm-tool
git status --short
```
预期：约 24 个文件处于 M 状态（`client/src/App.tsx`、`worker/src/index.ts` 等）——这是用户进行中的功能修改（WIP），**本重构会移动这些文件，WIP 内容会随文件一起落入新路径**。

- [ ] **Step 2: 处理 WIP（用户决策）**

二选一，需要用户明确选择：
- **方案 A（推荐）**：用户先提交 WIP：`git add -A && git commit -m "feat: <用户的 WIP 描述>"`（若 `npm test` 通过后再提交更稳）
- **方案 B**：`git stash push` 暂存 WIP，重构完成后 `git stash pop`（注意：重构移动了文件路径，stash pop 可能产生冲突，需手工解决）

如果用户选择 B，提醒冲突风险；无论 A/B，确认后继续。

- [ ] **Step 3: 建立绿色基线**

```bash
npm test
npm run build
```
预期：全部通过。这是"重构不破坏任何行为"的对照基线。

- [ ] **Step 4: 提交基线（如 Step 2 选了 B 则跳过）**

```bash
git status --short
```
预期：干净（或只剩 WIP 已提交后的空状态）。

---

### Task 2: worker `board/domain/` 拆分（domain.ts 685 行 → 5 个单职责模块）

**Files:**
- Create: `worker/src/board/domain/errors.ts`
- Create: `worker/src/board/domain/ids.ts`
- Create: `worker/src/board/domain/state.ts`
- Create: `worker/src/board/domain/scenes.ts`
- Create: `worker/src/board/domain/ops.ts`
- Delete: `worker/src/domain.ts`
- Modify: `worker/src/repository.ts:2`（import 指向）
- Modify: `worker/test/room-patch.test.ts:1-5`（import 指向）

**Interfaces:**
- Consumes: `shared/types.ts`（原样）
- Produces:
  - `board/domain/errors.ts` → `export class DomainError extends Error { constructor(public readonly code: 'INVALID' | 'FORBIDDEN' | 'NOT_FOUND' | 'CORRUPT_STATE', message: string) }`
  - `board/domain/ids.ts` → `export function newOpaqueId(prefix: string): string`、`export function normalizeName(value: string, fallback: string): string`
  - `board/domain/state.ts` → `export type RoomRole`、`export interface RoomActor`、`export interface PersistedRoomState`、`export interface RoomProjection`、`isRoomModerator(role: RoomRole): boolean`、`legacyRole(role: RoomRole): Role`、`createScene(name: string): Scene`、`createCampaign(name: string, firstSceneId: string): Campaign`、`createInitialRoomState(roomName: string, campaignName: string): PersistedRoomState`、`projectRoomState(state: PersistedRoomState, actor: RoomActor): RoomProjection`、`ensurePlayerToken(state: PersistedRoomState, actor: RoomActor): boolean`、`activeScene(state): Scene`、`activeCampaign(state): Campaign`
  - `board/domain/scenes.ts` → `addScene(state, name): Scene`、`deleteScene(state, sceneId): boolean`、`renameScene(state, sceneId, name): void`、`selectScene(state, sceneId): void`、`setSceneUnlocked(state, sceneId, unlocked): void`
  - `board/domain/ops.ts` → `authorizeOperation(value: unknown, state: PersistedRoomState, actor: RoomActor): Op`、`applyOperation(state: PersistedRoomState, op: Op): void`（含全部操作级校验器私有函数）

- [ ] **Step 1: 创建 errors.ts**

```ts
export class DomainError extends Error {
  constructor(public readonly code: 'INVALID' | 'FORBIDDEN' | 'NOT_FOUND' | 'CORRUPT_STATE', message: string) {
    super(message);
  }
}
```
（源：`worker/src/domain.ts:475-479` 原样搬移）

- [ ] **Step 2: 创建 ids.ts**

```ts
export function newOpaqueId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function normalizeName(value: string, fallback: string): string {
  const normalized = value.trim().slice(0, 120);
  return normalized || fallback;
}
```
（源：domain.ts:69-71、524-527 原样搬移）

- [ ] **Step 3: 创建 state.ts**

内容 = 以下部分原样搬移并合并：
- domain.ts:19-57（`RoomRole`、`RoomActor`、`PersistedRoomState`、`RoomProjection`、`DEFAULT_GRID`、`DEFAULT_PLAY`）
- domain.ts:59-67（`isRoomModerator`、`legacyRole`）
- domain.ts:73-111（`createScene`、`createCampaign`、`createInitialRoomState`）
- domain.ts:113-172（`projectRoomState`、`ensurePlayerToken`）
- domain.ts:428-438（`activeScene`、`activeCampaign`）

import 改为：
```ts
import type { Campaign, GridConfig, PlayArea, PlayerToken, Role, Scene } from '../../../../shared/types';
```
注意：从 `worker/src/board/domain/` 到仓库根的 shared 是 4 层 `../../../../`。

- [ ] **Step 4: 创建 scenes.ts**

```ts
import { DomainError } from './errors';
import { normalizeName } from './ids';
import { activeCampaign } from './state';
import type { PersistedRoomState } from './state';
```
内容 = domain.ts:440-473（`addScene`、`deleteScene`、`renameScene`、`selectScene`、`setSceneUnlocked`）原样搬移。

- [ ] **Step 5: 创建 ops.ts**

```ts
import { DomainError } from './errors';
import { newOpaqueId } from './ids';
import { activeCampaign, activeScene } from './state';
import type { PersistedRoomState } from './state';
import {
  FOG_CELL,
  fogGridSize,
  type EntryType,
  type Favorite,
  type GridConfig,
  type InitiativeEntry,
  type Op,
  type PlayArea,
  type PlayerToken,
  type Token,
  type Wall,
} from '../../../../shared/types';
```
内容 = domain.ts:179-426（`authorizeOperation`、`authorizePlayerOperation`、`applyOperation`）+ 私有函数 481-507、509-681（`ensureFog` 至 `favorite`）原样搬移。文件末尾保留 `void FOG_CELL;`（domain.ts:683-685，防止 tree-shaking 抹掉 fog 格子契约）。

- [ ] **Step 6: 删除 domain.ts 并修正 import**

```bash
rm worker/src/domain.ts
```

`worker/src/repository.ts:2` 改为：
```ts
import { isRoomModerator, type RoomActor, type RoomRole } from '../board/domain/state';
```

`worker/test/room-patch.test.ts:1-5` 改为：
```ts
import { describe, expect, it } from 'vitest';
import { activeScene, createInitialRoomState, type RoomActor } from '../src/board/domain/state';
import { applyOperation, authorizeOperation } from '../src/board/domain/ops';
import { projectPatchOperations } from '../src/room';
```
（`projectPatchOperations` 仍来自 `../src/room`，Task 3 再改）

- [ ] **Step 7: 验证**

```bash
npm run test:worker
npm run check:worker
```
预期：全绿。若有编译错误，检查遗漏的 domain 导出/引用（`grep -rn "from '.*domain'" worker/src worker/test`）。

- [ ] **Step 8: 提交**

```bash
git add -A worker/src worker/test/room-patch.test.ts
git commit -m "refactor(worker): 将 domain.ts 按职责拆分为 board/domain 五模块

state（创建/投影）、ops（授权+应用）、scenes（场景管理）、ids、errors 各单职责，
repository 与测试改指向新路径，逻辑零改动"
```

---

### Task 3: worker `board/` 包拆分（room.ts 714 行 → room-do/protocol/persistence/patches）+ 测试迁移

**Files:**
- Create: `worker/src/board/protocol.ts`
- Create: `worker/src/board/persistence.ts`
- Create: `worker/src/board/patches.ts`
- Create: `worker/src/board/room-do.ts`
- Delete: `worker/src/room.ts`
- Modify: `worker/src/index.ts:26`（DO 导出来源）
- Move: `worker/test/room-patch.test.ts` → `worker/src/board/room-patch.test.ts`
- Move: `worker/test/room.integration.test.ts` → `worker/src/board/room.integration.test.ts`

**Interfaces:**
- Consumes: `board/domain/*`（Task 2 产出）
- Produces:
  - `board/protocol.ts` → 常量 `INTERNAL_REQUEST_HEADER`、`MAX_WS_MESSAGE_BYTES`、`MAX_COMMANDS_PER_MINUTE`；`export interface SocketAttachment extends RoomActor`（含 `version: 1` 等字段）；`actorFromHeaders(headers: Headers): RoomActor`、`socketActor(socket: WebSocket): SocketAttachment | null`、`isRoomRole(value: unknown): value is RoomRole`、`isRecord(value: unknown): value is Record<string, unknown>`、`objectBody(request: Request): Promise<Record<string, unknown>>`、`text(value: unknown, label: string, maximumLength?: number): string`、`clientCommandId(value: unknown): string`
  - `board/persistence.ts` → `type RoomSql = DurableObjectStorage['sql']`；`findCommandReceipt(sql: RoomSql, actorMemberId: string, commandId: string): { revision: number; result_json: string } | undefined`；`writeRoomMutation(sql: RoomSql, write: RoomMutation): void`；`writeInitialRoomState(sql: RoomSql, state: PersistedRoomState, now: number): void`；`createSchema(sql: RoomSql): void`；`loadState(sql: RoomSql): PersistedRoomState | null`
  - `board/patches.ts` → `projectPatchOperations(state: PersistedRoomState, operations: Op[], actor: RoomActor): Op[] | null`（含私有 `projectPlayerToken`）
  - `board/room-do.ts` → `export class RoomDurableObject extends DurableObject<Env>`（公开 API 与现 `worker/src/room.ts` 完全一致）

- [ ] **Step 1: 创建 protocol.ts**

import：
```ts
import { DomainError } from './domain/errors';
import type { RoomActor, RoomRole } from './domain/state';
```
内容 = 以下原样搬移：room.ts:23-25（三个常量）、27-33（`SocketAttachment`）、662-671（`actorFromHeaders`）、673-678（`socketActor`）、680-682（`isRoomRole`）、684-686（`isRecord`）、688-697（`objectBody`）、699-704（`text`）、706-709（`clientCommandId`）。

- [ ] **Step 2: 创建 persistence.ts**

完整代码（SQL 语句与 room.ts 逐字一致）：
```ts
import type { PersistedRoomState } from './domain/state';

type RoomSql = DurableObjectStorage['sql'];

export interface CommandReceipt {
  revision: number;
  result_json: string;
}

export interface RoomMutation {
  revision: number;
  dataJson: string;
  actorMemberId: string;
  commandId: string;
  action: string;
  eventJson: string;
  resultJson: string;
  now: number;
}

export function findCommandReceipt(sql: RoomSql, actorMemberId: string, commandId: string): CommandReceipt | undefined {
  return sql.exec<CommandReceipt>(
    'SELECT revision, result_json FROM room_command_receipts WHERE actor_member_id = ?1 AND command_id = ?2',
    actorMemberId,
    commandId,
  ).toArray()[0];
}

export function writeRoomMutation(sql: RoomSql, write: RoomMutation): void {
  sql.exec(
    `INSERT INTO room_state (singleton, revision, data_json, updated_at)
     VALUES (1, ?1, ?2, ?3)
     ON CONFLICT(singleton) DO UPDATE SET revision = excluded.revision, data_json = excluded.data_json, updated_at = excluded.updated_at`,
    write.revision,
    write.dataJson,
    write.now,
  );
  sql.exec(
    'INSERT INTO room_events (actor_member_id, command_id, action, payload_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5)',
    write.actorMemberId,
    write.commandId,
    write.action,
    write.eventJson,
    write.now,
  );
  sql.exec(
    `INSERT INTO room_command_receipts (actor_member_id, command_id, revision, result_json, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
    write.actorMemberId,
    write.commandId,
    write.revision,
    write.resultJson,
    write.now,
  );
}

export function writeInitialRoomState(sql: RoomSql, state: PersistedRoomState, now: number): void {
  sql.exec(
    'INSERT INTO room_state (singleton, revision, data_json, updated_at) VALUES (1, ?1, ?2, ?3)',
    state.revision,
    JSON.stringify(state),
    now,
  );
  sql.exec(
    'INSERT INTO room_events (actor_member_id, command_id, action, payload_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5)',
    'system',
    'room.initialize',
    'room.initialize',
    JSON.stringify({ revision: state.revision, occurredAt: now }),
    now,
  );
}

export function createSchema(sql: RoomSql): void {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS room_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      revision INTEGER NOT NULL,
      data_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS room_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_member_id TEXT NOT NULL,
      command_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (actor_member_id, command_id)
    )
  `);
  sql.exec(`
    CREATE TABLE IF NOT EXISTS room_command_receipts (
      actor_member_id TEXT NOT NULL,
      command_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      result_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (actor_member_id, command_id)
    )
  `);
}

export function loadState(sql: RoomSql): PersistedRoomState | null {
  const row = sql.exec<{ revision: number; data_json: string }>('SELECT revision, data_json FROM room_state WHERE singleton = 1').toArray()[0];
  if (!row) return null;
  const state = JSON.parse(row.data_json) as PersistedRoomState;
  if (state.schemaVersion !== 1 || typeof state.revision !== 'number') throw new Error('Unsupported room state');
  return state;
}
```
（`room_state`/`room_events`/`room_command_receipts` 三表 SQL 与 room.ts:432-462、412-430、464-470 逐字一致；`StateRow`/`ReceiptRow` 接口被上面的内联类型替代）

- [ ] **Step 3: 创建 patches.ts**

import：
```ts
import type { Op, PlayerToken } from '../../../shared/types';
import { activeScene, isRoomModerator } from './domain/state';
import type { PersistedRoomState, RoomActor } from './domain/state';
```
内容 = room.ts:587-660（`projectPatchOperations`、`projectPlayerToken`）原样搬移。

- [ ] **Step 4: 创建 room-do.ts**

import 段（其余代码原样搬移 room.ts:52-578，即 `RoomDurableObject` 类整体）：
```ts
import { DurableObject } from 'cloudflare:workers';
import type { Campaign, Op, Scene } from '../../../shared/types';
import {
  activeCampaign,
  activeScene,
  createInitialRoomState,
  ensurePlayerToken,
  isRoomModerator,
  projectRoomState,
  type PersistedRoomState,
  type RoomActor,
  type RoomRole,
} from './domain/state';
import { applyOperation, authorizeOperation } from './domain/ops';
import { addScene, deleteScene, renameScene, selectScene, setSceneUnlocked } from './domain/scenes';
import { DomainError } from './domain/errors';
import { createSchema, findCommandReceipt, loadState, writeInitialRoomState, writeRoomMutation } from './persistence';
import {
  actorFromHeaders,
  clientCommandId,
  INTERNAL_REQUEST_HEADER,
  MAX_COMMANDS_PER_MINUTE,
  MAX_WS_MESSAGE_BYTES,
  objectBody,
  socketActor,
  text,
  type SocketAttachment,
} from './protocol';
import { projectPatchOperations } from './patches';
```

类内需要改动的 3 处（其余方法逐字保留）：
1. 构造函数 `loadState()` 调用改为 `loadState(this.ctx.storage.sql)`；`createSchema()` 改为 `createSchema(this.ctx.storage.sql)`
2. `mutate()`（原 room.ts:365-410）改为：
```ts
private mutate<T>(actor: RoomActor, commandId: string, action: string, update: (next: PersistedRoomState) => T): { revision: number; payload: T; duplicate: boolean } {
  const prior = findCommandReceipt(this.ctx.storage.sql, actor.memberId, commandId);
  if (prior) {
    return { revision: prior.revision, payload: JSON.parse(prior.result_json) as T, duplicate: true };
  }

  const current = this.requireState();
  const next = structuredClone(current);
  const payload = update(next);
  next.revision = current.revision + 1;
  const now = Date.now();
  const event = { action, actorMemberId: actor.memberId, revision: next.revision, occurredAt: now };
  this.ctx.storage.transactionSync(() => {
    writeRoomMutation(this.ctx.storage.sql, {
      revision: next.revision,
      dataJson: JSON.stringify(next),
      actorMemberId: actor.memberId,
      commandId,
      action,
      eventJson: JSON.stringify(event),
      resultJson: JSON.stringify(payload),
      now,
    });
  });
  this.state = next;
  return { revision: next.revision, payload, duplicate: false };
}
```
3. `persistInitialState()`（原 room.ts:412-430）删除，`initialize()` 中调用改为：
```ts
const now = Date.now();
this.ctx.storage.transactionSync(() => writeInitialRoomState(this.ctx.storage.sql, next, now));
```

文件末尾保留原 room.ts:711-714 的 `void ({} as Campaign | Scene);`。

- [ ] **Step 5: 删除 room.ts 并修正 index.ts 导出**

```bash
rm worker/src/room.ts
```
`worker/src/index.ts:26` 改为：
```ts
export { RoomDurableObject } from './board/room-do';
```

- [ ] **Step 6: 迁移测试**

```bash
git mv worker/test/room-patch.test.ts worker/src/board/room-patch.test.ts
git mv worker/test/room.integration.test.ts worker/src/board/room.integration.test.ts
```

`worker/src/board/room-patch.test.ts` 的 import 改为：
```ts
import { activeScene, createInitialRoomState, type RoomActor } from './domain/state';
import { applyOperation, authorizeOperation } from './domain/ops';
import { projectPatchOperations } from './patches';
```

`worker/src/board/room.integration.test.ts` 的 import 改为：
```ts
import controlPlaneMigration from '../../migrations/0001_control_plane.sql?raw';
import { callRoom, requireRoomAccess } from '../repository';
```
（`?raw` 迁移路径因文件位置变化必须改；`callRoom`/`requireRoomAccess` 暂保持 `../repository`——`repository.ts` 要到 Task 5 才被拆分为 `control-plane/`，届时改指向 `../control-plane/gateway` 与 `../control-plane/rooms`，见 Task 5 Step 6）

- [ ] **Step 7: 验证**

```bash
npm run test:worker
npm run check:worker
```
预期：全绿（若 import 未改的 repository 引用存在，`check:worker` 会报错，按 Step 6 说明处理）。

- [ ] **Step 8: 提交**

```bash
git add worker/src/board worker/src/index.ts
git commit -m "refactor(worker): 将 room.ts 按职责拆分为 board 包

room-do（DO 编排）、protocol（传输解析）、persistence（SQL）、patches（补丁投影），
测试随码迁移，mutate/initialize 改为调用 persistence 助手，事务语义不变"
```

---

### Task 4: worker `compendium/` 包（本地资料 + 在线回退 + 路由）

**Files:**
- Create: `worker/src/compendium/local.ts`
- Create: `worker/src/compendium/routes.ts`
- Move: `worker/src/online-compendium.ts` → `worker/src/compendium/online.ts`
- Move: `worker/src/online-compendium-data.ts` → `worker/src/compendium/online-data.ts`
- Move: `worker/test/online-compendium-data.test.ts` → `worker/src/compendium/online-data.test.ts`
- Modify: `worker/src/index.ts`（compendium 相关路由改为调用 routes.ts）

**Interfaces:**
- Consumes: `./http`、`./online-data`（内部）、`shared/types`
- Produces:
  - `compendium/local.ts` → `searchCompendium(env: Env, url: URL): Promise<Response>`、`getCompendiumEntry(env: Env, type: string, id: string): Promise<Response>`、`getCompendiumToken(env: Env, id: string): Promise<Response>`（均来自 index.ts 原函数，逻辑逐字）
  - `compendium/routes.ts` → `handleSearchRoute(request: Request, env: Env, url: URL, userId: string): Promise<Response>`（GET /api/search 与 /api/search/online）、`handleEntryRoute(request: Request, ctx: ExecutionContext, env: Env, parts: string[], userId: string): Promise<Response>`（GET /api/entry/:type/:id）、`handleTokenRoute(env: Env, id: string): Promise<Response>`（GET /api/token/:id）
  - `compendium/online.ts` → 原 online-compendium.ts 全部导出（`OnlineCompendiumRateLimitDurableObject`、`consumeOnlineLookupBudget`、`searchOnlineCompendium`、`onlineEntryReference`、`getOnlineCompendiumEntry`）
  - `compendium/online-data.ts` → 原 online-compendium-data.ts 全部导出

- [ ] **Step 1: 移动 online 模块并修正 import**

```bash
git mv worker/src/online-compendium.ts worker/src/compendium/online.ts
git mv worker/src/online-compendium-data.ts worker/src/compendium/online-data.ts
git mv worker/test/online-compendium-data.test.ts worker/src/compendium/online-data.test.ts
```

`worker/src/compendium/online.ts` import 修正：
- `import { HttpError, isRecord, json } from './http';` → `from '../http'`
- `from './online-compendium-data'` → `from './online-data'`
- `from '../../shared/types'` → `from '../../../shared/types'`

`worker/src/compendium/online-data.ts` import 修正：
- `from '../../shared/types'` → `from '../../../shared/types'`

`worker/src/compendium/online-data.test.ts` import 修正：
- `from '../src/online-compendium-data'` → `from './online-data'`

- [ ] **Step 2: 创建 local.ts**

import：
```ts
import { HttpError, isRecord, json } from '../http';
```
内容 = index.ts:29-38（`CompendiumIndexRow`）+ 249-263（`searchCompendium`）+ 265-288（`getCompendiumEntry`）+ 290-297（`getCompendiumToken`）+ 299-312（`asCompendiumIndexRow`）+ 314-316（`isCompendiumType`）+ 318-322（`firstObjectArray`）+ 324-326（`escapeXml`）原样搬移。函数名与签名不变。

- [ ] **Step 3: 创建 routes.ts**

完整代码（逻辑逐字来自 index.ts:82-102 的路由体）：
```ts
import { HttpError, json } from '../http';
import { getCompendiumEntry, getCompendiumToken, searchCompendium } from './local';
import {
  consumeOnlineLookupBudget,
  getOnlineCompendiumEntry,
  onlineEntryReference,
  searchOnlineCompendium,
} from './online';
import { parseOnlineSearchRequest } from './online-data';

/** GET /api/search 与 /api/search/online */
export async function handleSearchRoute(request: Request, env: Env, ctx: ExecutionContext, url: URL, userId: string): Promise<Response> {
  if (url.pathname.endsWith('/online')) {
    let onlineRequest;
    try {
      onlineRequest = parseOnlineSearchRequest(url);
    } catch (error) {
      throw new HttpError(400, 'INVALID_INPUT', error instanceof Error ? error.message : '资料查询无效');
    }
    if (!onlineRequest.query) return json([]);
    await consumeOnlineLookupBudget(env, request, userId);
    return searchOnlineCompendium(ctx, onlineRequest);
  }
  return searchCompendium(env, url);
}

/** GET /api/entry/:type/:id —— 在线引用则走在线回退，否则读本地 R2 */
export async function handleEntryRoute(request: Request, ctx: ExecutionContext, env: Env, parts: string[], userId: string): Promise<Response> {
  const onlineReference = onlineEntryReference(parts[2], parts[3]);
  if (onlineReference) {
    await consumeOnlineLookupBudget(env, request, userId);
    return getOnlineCompendiumEntry(ctx, onlineReference);
  }
  return getCompendiumEntry(env, parts[2], parts[3]);
}

/** GET /api/token/:id */
export function handleTokenRoute(env: Env, id: string): Promise<Response> {
  return getCompendiumToken(env, id);
}
```
（`onlineEntryReference`/`getCompendiumEntry` 等调用关系与 index.ts:94-102 逐字一致）

- [ ] **Step 4: 更新 index.ts 路由**

`worker/src/index.ts` 中：
- 删除 import：`consumeOnlineLookupBudget, getOnlineCompendiumEntry, onlineEntryReference, OnlineCompendiumRateLimitDurableObject, searchOnlineCompendium`（来自 './online-compendium'）、`parseOnlineSearchRequest`（来自 './online-compendium-data'）、`asCompendiumIndexRow` 等本模块定义（第 29-38、249-326 行的 compendium 相关函数全部删除）
- 新增 import：
```ts
import { handleEntryRoute, handleSearchRoute, handleTokenRoute } from './compendium/routes';
```
- `export { OnlineCompendiumRateLimitDurableObject };` 改为：
```ts
export { OnlineCompendiumRateLimitDurableObject } from './compendium/online';
```
- 第 82-102 行的路由体替换为：
```ts
  if (parts.length === 2 && parts[1] === 'search' && request.method === 'GET') return handleSearchRoute(request, env, ctx, url, session.userId);
  if (parts.length === 3 && parts[1] === 'search' && parts[2] === 'online' && request.method === 'GET') return handleSearchRoute(request, env, ctx, url, session.userId);
  if (parts.length === 4 && parts[1] === 'entry' && request.method === 'GET') return handleEntryRoute(request, ctx, env, parts, session.userId);
  if (parts.length === 3 && parts[1] === 'token' && request.method === 'GET') return handleTokenRoute(env, parts[2]);
```
注意：`/api/search` 与 `/api/search/online` 都走 `handleSearchRoute`（内部按 pathname 判断），或按原逻辑保留两条独立分支调用，二选一，行为一致。

- [ ] **Step 5: 验证**

```bash
npm run test:worker
npm run check:worker
```
预期：全绿（含迁移后的 online-data 测试）。

- [ ] **Step 6: 提交**

```bash
git add worker/src/compendium worker/src/index.ts
git commit -m "refactor(worker): 将资料查询拆分为 compendium 功能包

local（R2 本地）/online（在线回退+限流 DO）/online-data（解析）/routes（HTTP 处理），
index.ts 相应路由改为委托调用，逻辑零改动"
```

---

### Task 5: worker `control-plane/` 包（repository.ts 按域拆分 + 审计/素材路由）

**Files:**
- Create: `worker/src/control-plane/rooms.ts`
- Create: `worker/src/control-plane/assets.ts`
- Create: `worker/src/control-plane/gateway.ts`
- Create: `worker/src/control-plane/audit.ts`
- Delete: `worker/src/repository.ts`
- Modify: `worker/src/index.ts`（import 与路由体）
- Modify: `worker/src/board/room.integration.test.ts`（Task 3 遗留的 import）

**Interfaces:**
- Consumes: `./auth`、`../board/domain/state`、`./http`、`./rooms`（类型）
- Produces:
  - `control-plane/rooms.ts` → `interface RoomAccess extends RoomActor`（字段不变）、`interface RoomSummary`、`requireRoomAccess(env, userId, roomSlug): Promise<RoomAccess>`、`requireRoomModerator(access): void`、`listRooms(env, userId): Promise<RoomSummary[]>`、`createRoom(env, session, input): Promise<RoomAccess>`、`createRoomInvite(env, access, input): Promise<{ inviteUrl: string; expiresAt: number }>`、`redeemRoomInvite(env, session, token): Promise<{ roomSlug: string }>`、`roomSummary(access: RoomAccess): { id; slug; name; role; status; campaignName; updatedAt }`（私有）
  - `control-plane/assets.ts` → `createAsset(env, access, file, kindValue): Promise<{ id; url }>`、`getAsset(env, access, assetId)`、`handleAssetsUploadRoute(request, env, access): Promise<Response>`、`handleAssetReadRoute(env, access, assetId): Promise<Response>`、`handleMapUploadRoute(request, env, access): Promise<Response>`（含私有 `looksLikeImage`、`imageDimension`）
  - `control-plane/gateway.ts` → `internalRoomHeaders(access): Headers`、`initializeRoom(env, access): Promise<void>`、`callRoom(env, access, method, path, payload?): Promise<Response>`、`forwardRoomWebSocket(env, access, request): Promise<Response>`
  - `control-plane/audit.ts` → `writeAudit(env, access, action, targetType, targetId): Promise<void>`、`writeInviteAudit(env, userId, roomSlug): Promise<void>`

- [ ] **Step 1: 创建 rooms.ts**

import：
```ts
import { randomToken, sha256Hex, type Session } from '../auth';
import { isRoomModerator, type RoomActor, type RoomRole } from '../board/domain/state';
import { HttpError, nonEmptyText } from '../http';
```
内容 = repository.ts:5-24（类型）、26-39（`RoomAccessRow`）、55-115（`requireRoomAccess`/`requireRoomModerator`/`listRooms`）、117-172（`createRoom`）、174-248（`createRoomInvite`/`redeemRoomInvite`）、347-378（`isRoomRole`/`isInviteRole`/`boundedInteger`/`allocateRoomSlug`/`slugify`）原样搬移 + index.ts:225-235（`roomSummary`，作为私有函数）搬移。

- [ ] **Step 2: 创建 gateway.ts**

```ts
import { HttpError } from '../http';
import type { RoomAccess } from './rooms';
```
内容 = repository.ts:303-345（`internalRoomHeaders`/`initializeRoom`/`callRoom`/`forwardRoomWebSocket`）原样搬移。

- [ ] **Step 3: 创建 assets.ts**

import：
```ts
import { HttpError, json } from '../http';
import { callRoom } from './gateway';
import type { RoomAccess } from './rooms';
```
内容 =
- repository.ts:41-46（`AssetRow`）、250-301（`createAsset`/`getAsset`）、380-388（`looksLikeImage`）原样搬移
- index.ts:241-247（`imageDimension`）原样搬移为私有函数
- 新增三个路由处理函数（逻辑逐字来自 index.ts 对应路由体）：

```ts
/** POST /api/rooms/:slug/assets —— 上传 token/头像素材 */
export async function handleAssetsUploadRoute(request: Request, env: Env, access: RoomAccess): Promise<Response> {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > 11 * 1024 * 1024) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', '图片必须小于 10 MiB');
  }
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'INVALID_INPUT', '需要上传图片文件');
  const asset = await createAsset(env, access, file, form.get('kind'));
  return json(asset, { status: 201 });
}

/** GET /api/rooms/:slug/assets/:assetId —— 读取素材 */
export async function handleAssetReadRoute(env: Env, access: RoomAccess, assetId: string): Promise<Response> {
  const asset = await getAsset(env, access, assetId);
  const headers = new Headers({
    'content-type': asset.metadata.content_type,
    'content-length': String(asset.metadata.byte_size),
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'content-disposition': 'inline',
  });
  return new Response(asset.object.body, { headers });
}

/** POST /api/rooms/:slug/map —— 上传地图并更新当前场景 */
export async function handleMapUploadRoute(request: Request, env: Env, access: RoomAccess): Promise<Response> {
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > 11 * 1024 * 1024) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', '图片必须小于 10 MiB');
  }
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'INVALID_INPUT', '需要上传地图图片');
  const width = imageDimension(form.get('width'), '地图宽度');
  const height = imageDimension(form.get('height'), '地图高度');
  const asset = await createAsset(env, access, file, 'map');
  const updated = await callRoom(env, access, 'POST', '/ops', {
    id: crypto.randomUUID(),
    ops: [{
      op: 'updateMap',
      mapImage: asset.url,
      mapSize: [width, height],
      playArea: { x: 0, y: 0, w: width, h: height },
    }],
  });
  if (!updated.ok) return updated;
  return json(asset, { status: 201 });
}
```
（三个函数不含审计写入——审计由 router 在调用后负责，见 Task 6）

- [ ] **Step 4: 创建 audit.ts**

```ts
import type { RoomAccess } from './rooms';
```
内容 = index.ts:328-338（`writeAudit`）+ 340-351（`writeInviteAudit`）原样搬移。

- [ ] **Step 5: 更新 index.ts 并删除 repository.ts**

```bash
rm worker/src/repository.ts
```
`worker/src/index.ts` 的 import（第 12-24 行）替换为：
```ts
import { handleAssetReadRoute, handleAssetsUploadRoute, handleMapUploadRoute } from './control-plane/assets';
import { writeAudit, writeInviteAudit } from './control-plane/audit';
import { callRoom, forwardRoomWebSocket, initializeRoom } from './control-plane/gateway';
import { createRoom, createRoomInvite, listRooms, redeemRoomInvite, requireRoomAccess, roomSummary, type RoomAccess } from './control-plane/rooms';
```
路由体替换：
- `/api/invites/redeem` 分支：`redeemRoomInvite` 调用与审计不变（来源改为 control-plane/rooms 与 audit）
- `/api/rooms` GET/POST：`listRooms`/`createRoom`/`initializeRoom`（gateway）/`writeAudit`（audit）不变
- `routeRoomApi` 中：`forwardRoomWebSocket`（gateway）；`createRoomInvite`（rooms）+ `writeAudit`；`assets` POST → `handleAssetsUploadRoute(request, env, access)`；`assets/:id` GET → `handleAssetReadRoute(env, access, rest[1])`；`map` POST → `handleMapUploadRoute(request, env, access)`；`callRoom`（gateway）其余不变
- 删除本文件内 `writeAudit`/`writeInviteAudit`/`roomSummary`/`imageDimension` 函数定义

- [ ] **Step 6: 修正 room.integration.test.ts 遗留 import**

`worker/src/board/room.integration.test.ts`：
```ts
import { callRoom } from '../control-plane/gateway';
import { requireRoomAccess } from '../control-plane/rooms';
```

- [ ] **Step 7: 验证**

```bash
npm run test:worker
npm run check:worker
```

- [ ] **Step 8: 提交**

```bash
git add worker/src/control-plane worker/src/index.ts worker/src/board/room.integration.test.ts
git commit -m "refactor(worker): 将 repository.ts 按域拆分为 control-plane 包

rooms（成员/房间/邀请）、assets（素材存储+路由）、gateway（DO 网关）、audit（审计），
index.ts 路由体改为委托调用，逻辑零改动"
```

---

### Task 6: worker `router.ts` + 入口瘦身 + 测试收尾

**Files:**
- Create: `worker/src/router.ts`
- Modify: `worker/src/index.ts`（重写为薄入口）
- Modify: `worker/src/auth.ts`（并入 `expiredSessionCookie`）
- Move: `worker/test/public-config.test.ts` → `worker/src/public-config.test.ts`
- Move: `worker/test/raw.d.ts` → `worker/src/raw.d.ts`
- Modify: `vitest.worker.config.ts`（include 通配符）
- Modify: `tsconfig.worker.json`（include 去掉 worker/test）
- Delete: `worker/test/`（目录）

**Interfaces:**
- Consumes: `./auth`、`./http`、`./public-config`、`./compendium/routes`、`./control-plane/*`
- Produces:
  - `router.ts` → `routeApi(request: Request, env: Env, ctx: ExecutionContext, sessionContext: SessionContext, url: URL): Promise<Response>`（含私有 `routeRoomApi`、`optionalText`）
  - `index.ts` → `default export worker: ExportedHandler<Env>` + `export { RoomDurableObject } from './board/room-do'` + `export { OnlineCompendiumRateLimitDurableObject } from './compendium/online'`

- [ ] **Step 1: 创建 router.ts**

完整代码：
```ts
import { expiredSessionCookie, revokeCurrentSession, type SessionContext } from './auth';
import { HttpError, json, nonEmptyText, readJsonObject, requireSameOrigin, routeParts } from './http';
import { handleEntryRoute, handleSearchRoute, handleTokenRoute } from './compendium/routes';
import { handleAssetReadRoute, handleAssetsUploadRoute, handleMapUploadRoute } from './control-plane/assets';
import { writeAudit, writeInviteAudit } from './control-plane/audit';
import { callRoom, forwardRoomWebSocket, initializeRoom } from './control-plane/gateway';
import { createRoom, createRoomInvite, listRooms, redeemRoomInvite, requireRoomAccess, roomSummary, type RoomAccess } from './control-plane/rooms';

export async function routeApi(request: Request, env: Env, ctx: ExecutionContext, sessionContext: SessionContext, url: URL): Promise<Response> {
  const { session } = sessionContext;
  const parts = routeParts(url.pathname);

  if (parts.length === 2 && parts[1] === 'me' && request.method === 'GET') {
    return json({ id: session.userId, displayName: session.displayName, isAnonymous: true });
  }
  if (parts.length === 3 && parts[1] === 'auth' && parts[2] === 'logout' && request.method === 'POST') {
    await revokeCurrentSession(env, session);
    return json({ ok: true }, { headers: { 'set-cookie': expiredSessionCookie(request) } });
  }
  if (parts.length === 2 && parts[1] === 'search' && request.method === 'GET') return handleSearchRoute(request, env, ctx, url, session.userId);
  if (parts.length === 3 && parts[1] === 'search' && parts[2] === 'online' && request.method === 'GET') return handleSearchRoute(request, env, ctx, url, session.userId);
  if (parts.length === 4 && parts[1] === 'entry' && request.method === 'GET') return handleEntryRoute(request, ctx, env, parts, session.userId);
  if (parts.length === 3 && parts[1] === 'token' && request.method === 'GET') return handleTokenRoute(env, parts[2]);

  if (parts.length === 2 && parts[1] === 'invites' && request.method === 'POST') {
    // This is intentionally not a valid route; keep invite redemption below
    // explicit so a malformed path cannot accidentally consume a credential.
    throw new HttpError(404, 'NOT_FOUND', '找不到邀请操作');
  }
  if (parts.length === 3 && parts[1] === 'invites' && parts[2] === 'redeem' && request.method === 'POST') {
    const body = await readJsonObject(request);
    const token = nonEmptyText(body.token, '邀请令牌', 300);
    const redeemed = await redeemRoomInvite(env, session, token);
    ctx.waitUntil(writeInviteAudit(env, session.userId, redeemed.roomSlug));
    return json(redeemed);
  }

  if (parts.length === 2 && parts[1] === 'rooms') {
    if (request.method === 'GET') return json({ rooms: await listRooms(env, session.userId) });
    if (request.method === 'POST') {
      const body = await readJsonObject(request);
      const access = await createRoom(env, session, { roomName: nonEmptyText(body.roomName, '房间名称'), campaignName: optionalText(body.campaignName, '战役名称') });
      await initializeRoom(env, access);
      ctx.waitUntil(writeAudit(env, access, 'room.create', 'room', access.roomId));
      return json({ room: roomSummary(access) }, { status: 201 });
    }
  }

  if (parts.length >= 3 && parts[1] === 'rooms') {
    const roomSlug = parts[2];
    const access = await requireRoomAccess(env, session.userId, roomSlug);
    return routeRoomApi(request, env, ctx, access, parts.slice(3));
  }

  throw new HttpError(404, 'NOT_FOUND', '找不到接口');
}

async function routeRoomApi(request: Request, env: Env, ctx: ExecutionContext, access: RoomAccess, rest: string[]): Promise<Response> {
  if (rest.length === 0 && request.method === 'GET') {
    const response = await callRoom(env, access, 'GET', '/bootstrap');
    if (!response.ok) return response;
    const payload = await response.json() as { state?: unknown; membership?: unknown };
    return json({
      room: roomSummary(access),
      membership: { role: access.role, roomRole: access.role, canManage: access.role === 'host' || access.role === 'dm' || access.role === 'assistant_dm' },
      state: payload.state,
    });
  }
  if (rest.length === 1 && rest[0] === 'ws' && request.method === 'GET') {
    requireSameOrigin(request);
    return forwardRoomWebSocket(env, access, request);
  }
  if (rest.length === 1 && rest[0] === 'invites' && request.method === 'POST') {
    const body = await readJsonObject(request);
    const invite = await createRoomInvite(env, access, { role: body.role, maxUses: body.maxUses });
    ctx.waitUntil(writeAudit(env, access, 'invite.create', 'room', access.roomId));
    return json(invite, { status: 201 });
  }
  if (rest.length === 1 && rest[0] === 'assets') {
    if (request.method === 'POST') {
      const response = await handleAssetsUploadRoute(request, env, access);
      if (response.status === 201) {
        // 审计读取 id 必须用 clone().json()：response body 只能消费一次。
        const asset = await response.clone().json() as { id: string };
        ctx.waitUntil(writeAudit(env, access, 'asset.upload', 'asset', asset.id));
      }
      return response;
    }
  }
  if (rest.length === 1 && rest[0] === 'map' && request.method === 'POST') {
    const response = await handleMapUploadRoute(request, env, access);
    if (response.status === 201) {
      const asset = await response.clone().json() as { id: string };
      ctx.waitUntil(writeAudit(env, access, 'map.update', 'asset', asset.id));
    }
    return response;
  }
  if (rest.length === 2 && rest[0] === 'assets' && request.method === 'GET') {
    return handleAssetReadRoute(env, access, rest[1]);
  }
  if (rest[0] === 'scenes') {
    if (rest.length === 1 && (request.method === 'GET' || request.method === 'POST')) {
      return callRoom(env, access, request.method, '/scenes', request.method === 'POST' ? await readJsonObject(request) : undefined);
    }
    if (rest.length === 2 && (request.method === 'GET' || request.method === 'DELETE')) {
      return callRoom(env, access, request.method, `/scenes/${encodeURIComponent(rest[1])}`);
    }
  }
  if (rest[0] === 'campaigns') {
    if (rest.length === 1 && request.method === 'GET') return callRoom(env, access, 'GET', '/campaigns');
    if (rest.length === 3 && rest[2] === 'scenes' && request.method === 'POST') {
      const body = await readJsonObject(request);
      return callRoom(env, access, 'POST', '/campaigns/assign-scene', { ...body, campaignId: rest[1] });
    }
  }
  throw new HttpError(404, 'NOT_FOUND', '找不到房间接口');
}

function optionalText(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : nonEmptyText(value, label);
}
```
（`requireSameOrigin` 已在 import 中；assets/map 分支的审计用 `response.clone().json()` 读取 asset id——response body 只能消费一次，与现 index.ts:158-171、172-195 的语义一致）

- [ ] **Step 2: auth.ts 并入 expiredSessionCookie**

`worker/src/auth.ts` 文件末尾追加（原样搬移 index.ts:353-356）：
```ts
export function expiredSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === 'https:';
  return `${secure ? '__Host-dnd-session' : 'dnd_session'}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}
```

- [ ] **Step 3: 重写 index.ts 为薄入口**

`worker/src/index.ts` 完整内容：
```ts
import { getOrCreateSession, type SessionContext } from './auth';
import { errorResponse, json, requestId, requireSameOrigin, withSetCookie } from './http';
import { getPublicSiteConfig } from './public-config';
import { routeApi } from './router';

export { RoomDurableObject } from './board/room-do';
export { OnlineCompendiumRateLimitDurableObject } from './compendium/online';

const worker: ExportedHandler<Env> = {
  async fetch(request, env, ctx): Promise<Response> {
    const id = requestId(request);
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      // Static Assets handles non-API paths (including /r/:slug SPA routes).
      // This branch is a defensive fallback for a worker-first route override.
      return new Response('Not found', { status: 404 });
    }

    let sessionContext: SessionContext | undefined;
    try {
      if (url.pathname === '/api/health') return json({ ok: true, runtime: 'cloudflare-worker' });
      // This endpoint must not create an anonymous session merely to render a
      // legal footer.  It contains only explicitly configured public strings.
      if (url.pathname === '/api/public-config' && request.method === 'GET') {
        return json(getPublicSiteConfig(env), { headers: { 'cache-control': 'no-store' } });
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) requireSameOrigin(request);
      sessionContext = await getOrCreateSession(env, request);
      const response = await routeApi(request, env, ctx, sessionContext, url);
      console.log(JSON.stringify({ event: 'api_request', requestId: id, method: request.method, path: url.pathname, status: response.status }));
      return withSetCookie(response, sessionContext.setCookie);
    } catch (error) {
      return withSetCookie(errorResponse(error, id), sessionContext?.setCookie);
    }
  },
};

export default worker;
```

- [ ] **Step 4: 迁移剩余测试并更新配置**

```bash
git mv worker/test/public-config.test.ts worker/src/public-config.test.ts
git mv worker/test/raw.d.ts worker/src/raw.d.ts
rmdir worker/test
```
`worker/src/public-config.test.ts` import：`from '../src/public-config'` → `from './public-config'`

`vitest.worker.config.ts`：`include: ['worker/test/**/*.test.ts']` → `include: ['worker/src/**/*.test.ts']`

`tsconfig.worker.json`：`"include": ["worker/src/**/*.ts", "worker/test/**/*.ts", "shared/**/*.ts"]` → `"include": ["worker/src/**/*.ts", "shared/**/*.ts"]`（保留用户 WIP 中把 shared/types.ts 放宽为 shared/** 的改动）

- [ ] **Step 5: 验证**

```bash
npm run test:worker
npm run check:worker
grep -rn "worker/test" --include="*.ts" --include="*.json" . | grep -v node_modules
```
预期：测试全绿；grep 无残留引用。

- [ ] **Step 6: 提交**

```bash
git add worker/src/router.ts worker/src/index.ts worker/src/auth.ts vitest.worker.config.ts tsconfig.worker.json worker/src/public-config.test.ts worker/src/raw.d.ts
git commit -m "refactor(worker): 路由拆为 router.ts，index.ts 瘦身为薄入口

入口只保留 fetch 包装、会话/错误/Set-Cookie 与 DO 具名导出；
测试通配符改为 worker/src/**，删除空 worker/test 目录"
```

---

### Task 7: client `lib/` 建立 + ws.ts 三拆

**Files:**
- Move: `client/src/api.ts` → `client/src/lib/api.ts`
- Move: `client/src/routing.ts` → `client/src/lib/routing.ts`
- Move: `client/src/optimistic.ts` → `client/src/lib/optimistic.ts`
- Move: `client/src/pending.ts` → `client/src/lib/pending.ts`
- Move: `client/src/tokenPlacement.ts` → `client/src/lib/tokenPlacement.ts`
- Move: `client/src/upload.ts` → `client/src/lib/upload.ts`
- Move: `client/src/useImage.ts` → `client/src/lib/useImage.ts`
- Move: `client/src/types.ts` → `client/src/lib/types.ts`（内容改为 `export * from '../../../shared/types';`）
- Create: `client/src/lib/ws/decode.ts`、`transport.ts`、`store.ts`、`connection.ts`、`useScene.ts`
- Delete: `client/src/ws.ts`
- Move: `client/src/__tests__/api.test.ts` → `client/src/lib/api.test.ts`、`optimistic.test.ts` → `lib/`、`routing.test.ts` → `lib/`、`token-placement.test.ts` → `lib/`、`ws.test.ts` → `lib/ws/`
- Modify: 全部现有组件/入口的 import（`../ws` → `../lib/ws`、`../api` → `../lib/api` 等）

**Interfaces:**
- Consumes: `shared/types`（经 `lib/types.ts` 垫片）
- Produces（lib/ws 包公开 API，由 `connection.ts` 与 `useScene.ts` 导出，行为与现 `ws.ts` 完全一致）：
  - `lib/ws/connection.ts` → `export const connection: Connection`（`sendOps(ops: Op[]): void`、`previewOps(ops: Op[]): () => void`、`sendControl(msg: unknown): void`、`connect(roomSlug: string): void`、`disconnect(): void`、`onMessage(cb: Listener): () => void`、`get roomSlug(): string | null`、`lastState`、`lastOnline`、`connected`、`viewer`）
  - `lib/ws/useScene.ts` → `export function useScene(): SceneState`、`export function getMySessionId(): string`
  - `lib/ws/decode.ts` → `export type RoomViewRole = Role | 'spectator'`、`export interface Viewer`、`asViewer(value: unknown): Viewer | null`、`uiRole(value: unknown): RoomViewRole`、`rawRole(value: unknown): string`、`asOps(value: unknown): Op[] | null`、`commandId(): string`

- [ ] **Step 1: 移动 lib 基础模块**

```bash
git mv client/src/api.ts client/src/lib/api.ts
git mv client/src/routing.ts client/src/lib/routing.ts
git mv client/src/optimistic.ts client/src/lib/optimistic.ts
git mv client/src/pending.ts client/src/lib/pending.ts
git mv client/src/tokenPlacement.ts client/src/lib/tokenPlacement.ts
git mv client/src/upload.ts client/src/lib/upload.ts
git mv client/src/useImage.ts client/src/lib/useImage.ts
git mv client/src/types.ts client/src/lib/types.ts
git mv client/src/format.ts client/src/lib/format.ts
```
`lib/types.ts` 内容改为：
```ts
export * from '../../../shared/types';
```
各模块内部 import 修正（同一目录内相对路径不变，无需改动）：`lib/api.ts` 的 `./types` ✓；`lib/optimistic.ts` 的 `./types` ✓；`lib/tokenPlacement.ts` 的 `./types` ✓；`lib/upload.ts` 的 `./api` ✓；`lib/format.ts` 的 `./types` ✓。
（`format.ts` 先经 lib 过渡，Task 8 随 DetailDrawer 一起落入 `features/compendium/`）

- [ ] **Step 2: 创建 lib/ws/decode.ts**

完整代码（来自 ws.ts:6-13、62-91 原样搬移 + RoomViewRole）：
```ts
import type { Op, Role } from '../types';

/** 房间视图角色：DM 端显示角色与底层 roomRole 分离。 */
export type RoomViewRole = Role | 'spectator';

/** Identity comes from the same-origin HttpOnly session used for WebSocket auth. */
export interface Viewer {
  userId: string;
  roomMemberId?: string;
  roomRole?: string;
  displayName?: string;
}

export function asViewer(value: unknown): Viewer | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (typeof source.userId !== 'string') return null;
  return {
    userId: source.userId,
    ...(typeof source.roomMemberId === 'string' ? { roomMemberId: source.roomMemberId } : {}),
    ...(typeof source.roomRole === 'string' ? { roomRole: source.roomRole } : {}),
    ...(typeof source.displayName === 'string' ? { displayName: source.displayName } : {}),
  };
}

export function uiRole(value: unknown): RoomViewRole {
  if (value === 'dm' || value === 'owner' || value === 'co_dm' || value === 'host' || value === 'assistant_dm') return 'dm';
  return value === 'spectator' ? 'spectator' : 'player';
}

export function rawRole(value: unknown): string {
  return typeof value === 'string' ? value : 'player';
}

export function asOps(value: unknown): Op[] | null {
  return Array.isArray(value) && value.every((item) => item && typeof item === 'object' && typeof (item as { op?: unknown }).op === 'string')
    ? value as Op[]
    : null;
}

export function commandId(): string {
  return typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `command-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
```

- [ ] **Step 3: 创建 lib/ws/transport.ts**

职责：WebSocket 生命周期 + 重连退避 + 原始帧收发 + 消息解析。**不含**任何业务状态。

```ts
import type { Campaign, Scene } from '../types';
import { asViewer, asOps, uiRole, rawRole, type RoomViewRole, type Viewer } from './decode';

export interface SocketMessage {
  type: string;
  scene?: Scene;
  role?: unknown;
  roomRole?: unknown;
  campaign?: Campaign | null;
  viewer?: unknown;
  revision?: unknown;
  online?: unknown;
  message?: unknown;
  commandId?: unknown;
  ops?: unknown;
}

export type TransportStatus = { state: 'connected' } | { state: 'disconnected' };

/**
 * Owns only the socket: connection lifecycle, reconnect backoff, raw frame
 * send and JSON parsing. It knows nothing about room commands or snapshots.
 */
export class SocketTransport {
  private socket: WebSocket | null = null;
  private retry = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private roomSlug: string | null = null;
  onMessage: ((message: SocketMessage) => void) | null = null;
  onStatus: ((status: TransportStatus) => void) | null = null;

  connect(roomSlug: string): void {
    this.roomSlug = roomSlug;
    const generation = ++this.generation;
    this.open(generation);
  }

  disconnect(): void {
    ++this.generation;
    this.roomSlug = null;
    this.stopSocket();
  }

  sendRaw(message: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  private stopSocket(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const old = this.socket;
    this.socket = null;
    if (old && (old.readyState === WebSocket.OPEN || old.readyState === WebSocket.CONNECTING)) old.close();
  }

  private open(generation: number): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${encodeURIComponent(this.roomSlug ?? '')}/ws`);
    this.socket = ws;

    ws.onopen = () => {
      if (generation !== this.generation || this.socket !== ws) return;
      this.retry = 0;
      // A legacy server ignores this harmlessly; the current room actor uses
      // it only after sending the initial full state.
      this.sendRaw({ type: 'capabilities', patches: 1 });
      this.onStatus?.({ state: 'connected' });
    };
    ws.onmessage = (event) => {
      if (generation !== this.generation || this.socket !== ws) return;
      const msg = this.parse(event.data);
      if (msg) this.onMessage?.(msg);
    };
    ws.onclose = () => {
      if (generation !== this.generation || this.socket !== ws) return;
      this.socket = null;
      this.onStatus?.({ state: 'disconnected' });
      if (!this.roomSlug) return;
      const delay = Math.min(1000 * 2 ** this.retry, 10_000);
      this.retry += 1;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (generation === this.generation && this.roomSlug) this.open(generation);
      }, delay);
    };
  }

  private parse(data: unknown): SocketMessage | null {
    if (typeof data !== 'string') return null;
    try {
      const parsed = JSON.parse(data) as unknown;
      if (!parsed || typeof parsed !== 'object' || typeof (parsed as { type?: unknown }).type !== 'string') return null;
      return parsed as SocketMessage;
    } catch {
      return null;
    }
  }
}
```
⚠️ 行为差异说明：原 ws.ts 的 `connect()` 在**相同 slug 且 socket 打开时直接返回**，在相同 slug 但 socket 已关时**重启 socket**；原 `open()` 的 onopen 只发 capabilities，待确认命令的重发由 Connection 处理。`SocketTransport.connect()` 每次调用都强制开新 socket——**Connection 负责在 connect 前判断**（见 Step 5 的 connection.ts，逻辑与原 ws.ts:126-140 一致）。

- [ ] **Step 4: 创建 lib/ws/store.ts**

职责：权威快照 + 待确认命令队列 + 本地预览 + 乐观重放。**不含** socket。

```ts
import { applyOptimisticOps } from '../optimistic';
import type { Campaign, Op, Scene } from '../types';
import { asOps, asViewer, rawRole, uiRole, type RoomViewRole, type Viewer } from './decode';

export interface SceneState {
  scene: Scene | null;
  role: RoomViewRole;
  roomRole: string;
  viewer: Viewer | null;
  revision: number | null;
  online: number;
  connected: boolean;
  campaign: Campaign | null;
}

export type RoomSnapshot = {
  scene: Scene;
  role: RoomViewRole;
  roomRole: string;
  campaign: Campaign | null;
  viewer: Viewer | null;
  revision: number | null;
};

export type SnapshotMessage = {
  type: 'state';
  scene: Scene;
  role: RoomViewRole;
  roomRole: string;
  campaign: Campaign | null;
  viewer: Viewer | null;
  revision: number | null;
};

export interface PendingCommand {
  id: string;
  ops: Op[];
  acknowledgedRevision?: number;
}

interface LocalPreview {
  id: string;
  ops: Op[];
}

interface StoreDeps {
  onSnapshot: (message: SnapshotMessage) => void;
  requestResync: () => void;
}

/** 权威房间状态 + 乐观重放。所有变更都通过 deps.onSnapshot 通知外部。 */
export class RoomStore {
  private authoritative: RoomSnapshot | null = null;
  private pending: PendingCommand[] = [];
  private previews: LocalPreview[] = [];
  private _lastState: RoomSnapshot | null = null;
  private _viewer: Viewer | null = null;
  private _lastOnline = 0;
  private _connected = false;
  private readonly deps: StoreDeps;

  constructor(deps: StoreDeps) {
    this.deps = deps;
  }

  get lastState(): RoomSnapshot | null { return this._lastState; }
  get viewer(): Viewer | null { return this._viewer; }
  get lastOnline(): number { return this._lastOnline; }
  get connected(): boolean { return this._connected; }
  get pendingCommands(): readonly PendingCommand[] { return this.pending; }

  clear(): void {
    this.authoritative = null;
    this._lastState = null;
    this.pending = [];
    this.previews = [];
    this._lastOnline = 0;
    this._connected = false;
    this._viewer = null;
  }

  markConnected(online: number): void {
    this._lastOnline = online;
    this._connected = true;
  }

  markDisconnected(): void {
    this._connected = false;
  }

  acceptState(message: { scene?: Scene; role?: unknown; roomRole?: unknown; campaign?: Campaign | null; viewer?: unknown; revision?: unknown }): void {
    if (!message.scene) return;
    const viewer = asViewer(message.viewer);
    const effectiveRole = viewer?.roomRole ?? message.roomRole ?? message.role;
    const next: RoomSnapshot = {
      scene: message.scene,
      role: uiRole(effectiveRole),
      roomRole: rawRole(effectiveRole),
      campaign: message.campaign ?? null,
      viewer,
      revision: typeof message.revision === 'number' ? message.revision : null,
    };
    this.authoritative = next;
    this._connected = true;
    this.dropConfirmed(next.revision);
    this.rebuildVisible();
  }

  acceptPatch(message: { revision?: unknown; ops?: unknown }): void {
    const revision = typeof message.revision === 'number' ? message.revision : null;
    const operations = asOps(message.ops);
    if (!this.authoritative || revision === null || operations === null || this.authoritative.revision === null
      || revision !== this.authoritative.revision + 1) {
      this.deps.requestResync();
      return;
    }
    const applied = applyOptimisticOps({ scene: this.authoritative.scene, campaign: this.authoritative.campaign }, operations);
    if (!applied) {
      this.deps.requestResync();
      return;
    }
    this.authoritative = { ...this.authoritative, ...applied, revision };
    this._connected = true;
    this.dropConfirmed(revision);
    this.rebuildVisible();
  }

  acceptAck(message: { commandId?: unknown; revision?: unknown }): void {
    if (typeof message.commandId !== 'string' || typeof message.revision !== 'number') return;
    const pending = this.pending.find((command) => command.id === message.commandId);
    if (!pending) return;
    pending.acknowledgedRevision = message.revision;
    if (this.dropConfirmed(this.authoritative?.revision ?? null)) this.rebuildVisible();
  }

  rejectCommand(message: { commandId?: unknown }): void {
    if (typeof message.commandId !== 'string') return;
    const before = this.pending.length;
    this.pending = this.pending.filter((command) => command.id !== message.commandId);
    if (this.pending.length !== before) this.rebuildVisible();
  }

  /** 登记待确认命令并立即乐观显示。 */
  pushCommand(id: string, ops: Op[]): void {
    this.pending.push({ id, ops });
    this.rebuildVisible();
  }

  /** 叠加一个本地预览（如上传中的 object URL），返回移除函数。 */
  pushPreview(id: string, ops: Op[]): () => void {
    const preview: LocalPreview = { id, ops };
    this.previews.push(preview);
    this.rebuildVisible();
    return () => {
      const before = this.previews.length;
      this.previews = this.previews.filter((entry) => entry.id !== preview.id);
      if (this.previews.length !== before) this.rebuildVisible();
    };
  }

  private dropConfirmed(revision: number | null): boolean {
    if (revision === null) return false;
    const before = this.pending.length;
    this.pending = this.pending.filter((command) => command.acknowledgedRevision === undefined || command.acknowledgedRevision > revision);
    return this.pending.length !== before;
  }

  private rebuildVisible(): void {
    if (!this.authoritative) return;
    let projection: { scene: Scene; campaign: Campaign | null } = { scene: this.authoritative.scene, campaign: this.authoritative.campaign };
    for (const command of this.pending) {
      const next = applyOptimisticOps(projection, command.ops);
      if (next) projection = next;
    }
    for (const preview of this.previews) {
      const next = applyOptimisticOps(projection, preview.ops);
      if (next) projection = next;
    }
    this._lastState = { ...this.authoritative, ...projection };
    this._viewer = this._lastState.viewer;
    this.deps.onSnapshot({
      type: 'state',
      scene: this._lastState.scene,
      role: this._lastState.role,
      roomRole: this._lastState.roomRole,
      campaign: this._lastState.campaign,
      viewer: this._lastState.viewer,
      revision: this._lastState.revision,
    });
  }
}
```
（`SceneState` 类型由 useScene.ts 复用；`SnapshotMessage` 形状与现 ws.ts emit 的 `{ type: 'state', ... }` 一致）

- [ ] **Step 5: 创建 lib/ws/connection.ts**

完整代码（编排 transport + store；公开 API 与现 ws.ts:377 的 `connection` 单例一致。行为等价说明：原 ws.ts 在「相同 slug 且 socket 已关闭」时会重开 socket——`SocketTransport.connect()` 每次调用都会 `++generation` 并重开，所以新 `Connection.connect` 只需在「相同 slug 且已打开」时直接 return；「断开/换房间」统一走 `store.clear()` + `emit({ type: 'reset' })`，与原 clearSnapshot 一致）：
```ts
import type { Op } from '../types';
import { SocketTransport, type SocketMessage, type TransportStatus } from './transport';
import { RoomStore } from './store';
import { commandId, type Viewer } from './decode';

export type Listener = (msg: SocketMessage) => void;

class Connection {
  private readonly transport = new SocketTransport();
  private readonly store: RoomStore;
  private listeners = new Set<Listener>();
  private activeRoomSlug: string | null = null;

  constructor() {
    this.store = new RoomStore({
      onSnapshot: (snapshot) => this.emit(snapshot),
      requestResync: () => this.transport.sendRaw({ type: 'resync' }),
    });
    this.transport.onMessage = (msg) => this.handleMessage(msg);
    this.transport.onStatus = (status) => this.handleStatus(status);
  }

  get roomSlug(): string | null {
    return this.activeRoomSlug;
  }

  get lastState() { return this.store.lastState; }
  get lastOnline() { return this.store.lastOnline; }
  get connected() { return this.store.connected; }
  get viewer(): Viewer | null { return this.store.viewer; }

  connect(roomSlug: string): void {
    const normalised = roomSlug.trim();
    if (!normalised) throw new Error('room slug is required');
    if (normalised === this.activeRoomSlug && this.transport.isOpen) return;
    if (normalised !== this.activeRoomSlug) {
      this.transport.disconnect();
      this.store.clear();
      this.emit({ type: 'reset' });
    }
    this.activeRoomSlug = normalised;
    this.transport.connect(normalised);
  }

  disconnect(): void {
    this.activeRoomSlug = null;
    this.transport.disconnect();
    this.store.clear();
    this.emit({ type: 'reset' });
  }

  /** Send and immediately predict a durable, server-authorized board command. */
  sendOps(ops: Op[]): void {
    if (!ops.length) return;
    const id = commandId();
    this.store.pushCommand(id, ops);
    this.transport.sendRaw({ type: 'op', id, ops });
  }

  /**
   * Overlay a local object URL while a map/avatar file uploads. It never leaves
   * this browser and is explicitly removed by the caller before the durable
   * R2 URL is sent to the room.
   */
  previewOps(ops: Op[]): () => void {
    return this.store.pushPreview(commandId(), ops);
  }

  /** Raw room controls (scene switching, legacy commands) remain authoritative. */
  sendControl(msg: unknown): void {
    this.transport.sendRaw(msg);
  }

  onMessage(cb: Listener): () => void {
    this.listeners.add(cb);
    if (this.store.lastState) {
      const state = this.store.lastState;
      cb({ type: 'state', scene: state.scene, role: state.role, roomRole: state.roomRole, campaign: state.campaign, viewer: state.viewer, revision: state.revision });
    }
    if (this.store.connected) cb({ type: 'meta', online: this.store.lastOnline });
    return () => this.listeners.delete(cb);
  }

  private handleStatus(status: TransportStatus): void {
    if (status.state === 'connected') {
      this.store.markConnected(this.store.lastOnline);
      // 重连后重发尚未确认的命令（等价原 onopen 中的 pending 重放）。
      for (const pending of this.store.pendingCommands) {
        if (pending.acknowledgedRevision === undefined) this.transport.sendRaw({ type: 'op', id: pending.id, ops: pending.ops });
      }
    } else {
      this.store.markDisconnected();
      this.emit({ type: 'disconnected' });
    }
  }

  private handleMessage(msg: SocketMessage): void {
    if (msg.type === 'state' && msg.scene) {
      this.store.acceptState(msg);
      return;
    }
    if (msg.type === 'patch') {
      this.store.acceptPatch(msg);
      return;
    }
    if (msg.type === 'ack') {
      this.store.acceptAck(msg);
      return;
    }
    if (msg.type === 'meta') {
      this.store.markConnected(typeof msg.online === 'number' ? msg.online : 0);
    } else if (msg.type === 'error') {
      this.store.rejectCommand(msg);
    }
    this.emit(msg);
  }

  private emit(msg: SocketMessage): void {
    for (const listener of this.listeners) listener(msg);
  }
}

const connection = new Connection();

export { connection };
```

- [ ] **Step 6: 创建 lib/ws/useScene.ts**

完整代码（原 ws.ts:379-423 的 `useScene` hook 原样搬移，import 改指向）：
```ts
import { useEffect, useState } from 'react';
import { connection } from './connection';
import { asViewer, rawRole, uiRole } from './decode';
import type { SceneState } from './store';

/** Returns the server-owned identity key used by existing token components. */
export function getMySessionId(): string {
  return connection.viewer?.userId ?? '';
}

export function useScene(): SceneState {
  const [state, setState] = useState<SceneState>(() => ({
    scene: connection.lastState?.scene ?? null,
    role: connection.lastState?.role ?? 'player',
    roomRole: connection.lastState?.roomRole ?? 'player',
    viewer: connection.lastState?.viewer ?? null,
    revision: connection.lastState?.revision ?? null,
    online: connection.lastOnline,
    connected: connection.connected,
    campaign: connection.lastState?.campaign ?? null,
  }));
  useEffect(() => connection.onMessage((msg) => {
    if (msg.type === 'state' && msg.scene) {
      const viewer = asViewer(msg.viewer);
      const effectiveRole = viewer?.roomRole ?? msg.roomRole ?? msg.role;
      setState(current => ({
        ...current,
        scene: msg.scene,
        role: uiRole(effectiveRole),
        roomRole: rawRole(effectiveRole),
        viewer,
        revision: typeof msg.revision === 'number' ? msg.revision : null,
        campaign: msg.campaign ?? null,
        connected: true,
      }));
    } else if (msg.type === 'meta') {
      setState(current => ({ ...current, online: typeof msg.online === 'number' ? msg.online : 0, connected: true }));
    } else if (msg.type === 'reset' || msg.type === 'disconnected') {
      setState({
        scene: null,
        role: 'player',
        roomRole: 'player',
        viewer: null,
        revision: null,
        online: 0,
        connected: false,
        campaign: null,
      });
    } else if (msg.type === 'error') {
      console.warn('[ws]', typeof msg.message === 'string' ? msg.message : 'Room WebSocket error');
    }
  }), []);

  return state;
}
```

- [ ] **Step 7: 创建 lib/ws/index.ts（包公开 API）**

```ts
export { connection } from './connection';
export { useScene, getMySessionId } from './useScene';
export type { SceneState, RoomSnapshot, PendingCommand } from './store';
export type { Viewer, RoomViewRole } from './decode';
```

- [ ] **Step 8: 删除旧 ws.ts 并更新全部引用**

```bash
rm client/src/ws.ts
```
批量替换（用 `perl -pi -e` 或编辑器全局替换，**逐文件确认**）：
- `from '../ws'` → `from '../lib/ws'`（components/、features/map-upload/ 下所有文件）
- `from './ws'` → `from './lib/ws'`（client/src 根目录文件：App.tsx、RoomTable.tsx）
- `from '../api'` → `from '../lib/api'`（components/、features/map-upload/）
- `from './api'` → `from './lib/api'`（client/src 根目录：App.tsx、Lobby.tsx）
- `from '../types'` → `from '../lib/types'`（components/、features/map-upload/、__tests__）
- `from './types'` → `from './lib/types'`（client/src 根目录：App.tsx 无、Lobby.tsx 无；ws 相关已在 Step 2-6 处理）
- `from '../optimistic'` → `from '../lib/optimistic'`（无——optimistic 只被 ws.ts 使用，已拆入 store.ts）
- `from '../pending'` → `from '../lib/pending'`（components/QueryPanel.tsx、DetailDrawer.tsx）
- `from '../routing'` → `from '../lib/routing'`（App.tsx、Lobby.tsx）
- `from '../upload'` → `from '../lib/upload'`（components/EnemyList.tsx、BackupTransfer.tsx）
- `from '../useImage'` → `from '../lib/useImage'`（components/TokenShape.tsx、BoardCanvas.tsx）
- `from '../format'` → `from '../lib/format'`（components/DetailDrawer.tsx）——format.ts 已在 Step 1 移入 lib/；Task 8 将随 DetailDrawer 一起落入 features/compendium/（届时改为 `./format`）
- `from '../tokenPlacement'` → `from '../lib/tokenPlacement'`（components/QueryPanel.tsx）

- [ ] **Step 9: 迁移 lib 相关测试**

```bash
git mv client/src/__tests__/api.test.ts client/src/lib/api.test.ts
git mv client/src/__tests__/optimistic.test.ts client/src/lib/optimistic.test.ts
git mv client/src/__tests__/routing.test.ts client/src/lib/routing.test.ts
git mv client/src/__tests__/token-placement.test.ts client/src/lib/token-placement.test.ts
git mv client/src/__tests__/format.test.ts client/src/lib/format.test.ts
git mv client/src/__tests__/ws.test.ts client/src/lib/ws/ws.test.ts
```
各测试 import 修正：
- `lib/api.test.ts`：检查是否引用 `../api`（若引用改为 `./api`；若仅用 vitest 全局则不动）
- `lib/optimistic.test.ts`：`from '../optimistic'` → `from './optimistic'`；`from '../types'` → `from './types'`
- `lib/routing.test.ts`：`from '../routing'` → `from './routing'`
- `lib/token-placement.test.ts`：`from '../tokenPlacement'` → `from './tokenPlacement'`
- `lib/format.test.ts`：`from '../format'` → `from './format'`
- `lib/ws/ws.test.ts`：视其内容（若引用 `../ws` 改为 `./index` 或 `./connection`；若测试的是解析/重连行为，改为引用 `./transport`/`./store` 对应符号）

- [ ] **Step 10: 验证**

```bash
npx tsc --noEmit -p tsconfig.json
npm run build:client
npm run test:domain
```
预期：全绿。`tsc` 会列出所有遗漏的 import 路径，逐个修正后重跑。

- [ ] **Step 11: 提交**

```bash
git add client/src/lib client/src/ws.ts
git commit -m "refactor(client): 建立 lib/ 基础设施，ws.ts 三拆为传输/store/编排/hook

lib/ws 拆为 transport（socket 生命周期）、store（权威快照+乐观重放）、
connection（编排）、useScene（hook），公开 API 不变，全部组件仅改 import"
```

---

### Task 8: client 功能包迁移 + BoardCanvas 拆分

**Files:**
- Move（app/）：`client/src/App.tsx` → `client/src/app/App.tsx`、`client/src/Lobby.tsx` → `client/src/app/Lobby.tsx`、`client/src/components/FilingFooter.tsx` → `client/src/app/FilingFooter.tsx`
- Move（room/）：`client/src/RoomTable.tsx` → `client/src/room/RoomTable.tsx`、`client/src/components/TopBar.tsx` → `client/src/room/TopBar.tsx`、`client/src/components/Toolbar.tsx` → `client/src/room/Toolbar.tsx`、`client/src/components/InvitePlayerButton.tsx` → `client/src/room/InvitePlayerButton.tsx`
- Move（features/）：`components/BoardCanvas.tsx` → `features/board/BoardCanvas.tsx`（并拆分）、`components/TokenShape.tsx` → `features/board/TokenShape.tsx`、`components/SceneSwitcher.tsx` → `features/scenes/SceneSwitcher.tsx`、`components/InitiativePanel.tsx` → `features/initiative/InitiativePanel.tsx`、`components/EnemyList.tsx` → `features/enemies/EnemyList.tsx`（并抽 OwnCharacterCard）、`components/QueryPanel.tsx` → `features/compendium/QueryPanel.tsx`、`components/DetailDrawer.tsx` → `features/compendium/DetailDrawer.tsx`、`components/BackupTransfer.tsx` → `features/backup/BackupTransfer.tsx`、`client/src/backup.ts` → `features/backup/backup.ts`、`client/src/lib/format.ts` → `features/compendium/format.ts`
- Create: `features/board/useBoardView.ts`、`useWallTool.ts`、`useFogEraser.ts`、`useMapCalibration.ts`、`fog.ts`、`FogOverlay.tsx`、`features/enemies/OwnCharacterCard.tsx`
- Move: `client/src/__tests__/backup.test.ts` → `features/backup/`、`format.test.ts` → `features/compendium/`、`map-upload.test.ts` → `features/map-upload/`
- Modify: `client/src/main.tsx`（`./App` → `./app/App`）
- Delete: `client/src/components/`（目录）、`client/src/App.tsx` 等旧位置（由 git mv 完成）
- Modify: `client/src/features/map-upload/MapUploadProvider.tsx`（import）

**Interfaces:**
- Consumes: `lib/*`（Task 7 产出）
- Produces:
  - `features/board/useBoardView.ts` → `useBoardView(stageRef: React.RefObject<Konva.Stage>): { scale; pos; setPos; zoomAt(pointer, factor); zoomCenter(factor); resetView(); handleWheel(e); cancelPendingFrame() }`
  - `features/board/useWallTool.ts` → `useWallTool(snap: (v: number, axis: 0 | 1) => number): { wallPreview; beginWall(p); extendWall(p); finishWall(): { start: [number, number]; end: [number, number] } | null; cancelWall() }`
  - `features/board/useFogEraser.ts` → `useFogEraser(scene: Scene | null, brushSize: number): { pressEraser(wx, wy); dragEraser(wx, wy); releaseEraser() }`
  - `features/board/useMapCalibration.ts` → `useMapCalibration(authoritative: number | undefined): { displayedMapScale; adjustMapScale(factor); setMapScale(value) }`
  - `features/board/fog.ts` → `FOG_COLOR`、`fogCellAt(scene: Scene, wx: number, wy: number): number`
  - `features/board/FogOverlay.tsx` → `<FogOverlay scene={scene} role={role} />`
  - `features/enemies/OwnCharacterCard.tsx` → `<OwnCharacterCard myToken={PlayerToken} />`

- [ ] **Step 1: 创建 features/board 的纯逻辑模块**

**fog.ts**（完整代码，逻辑逐字来自 BoardCanvas.tsx:12 与 135-142）：
```ts
import { FOG_CELL, fogGridSize, type Scene } from '../../lib/types';

// Fog overlay color by role: the DM sees a translucent amber veil (they can see
// through it), players see near-opaque dark so unrevealed areas hide the map.
export const FOG_COLOR = { dm: 'rgba(245,158,11,0.35)', player: '#0f1115', spectator: '#0f1115' } as const;

/** Map a world point to its fog cell index (0..cols*rows-1), or -1 if outside.
 * The grid spans the whole rendered map (mapSize * mapScale), not just the
 * play area, so fog covers the entire board. */
export function fogCellAt(scene: Scene, wx: number, wy: number): number {
  const { cols, rows } = fogGridSize(scene);
  const cx = Math.floor(wx / FOG_CELL);
  const cy = Math.floor(wy / FOG_CELL);
  if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return -1;
  return cy * cols + cx;
}
```

**useBoardView.ts**（完整代码；逻辑逐字来自 BoardCanvas.tsx:30-34、179-249）：
```ts
import { useCallback, useRef, useState } from 'react';
import type Konva from 'konva';

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;

export function useBoardView(stageRef: React.RefObject<Konva.Stage>) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  // Wheel devices can emit far more events than the display refresh rate.
  // Coalescing them keeps a large Konva layer from rebuilding for every tick.
  const pendingViewRef = useRef<{ scale: number; pos: { x: number; y: number } } | null>(null);
  const viewFrameRef = useRef<number | null>(null);

  const scheduleView = useCallback((nextScale: number, nextPos: { x: number; y: number }) => {
    pendingViewRef.current = { scale: nextScale, pos: nextPos };
    if (viewFrameRef.current !== null) return;
    viewFrameRef.current = requestAnimationFrame(() => {
      const next = pendingViewRef.current;
      pendingViewRef.current = null;
      viewFrameRef.current = null;
      if (!next) return;
      setScale(next.scale);
      setPos(next.pos);
    });
  }, []);

  // Zoom by a factor around a pointer position (container coordinates), keeping
  // the world point under the cursor fixed — the standard "free zoom" behavior.
  const zoomAt = useCallback((pointer: { x: number; y: number }, factor: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const pending = pendingViewRef.current;
    const oldScale = pending?.scale ?? stage.scaleX();
    const oldPos = pending?.pos ?? { x: stage.x(), y: stage.y() };
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, oldScale * factor));
    if (newScale === oldScale) return;
    const mousePointTo = { x: (pointer.x - oldPos.x) / oldScale, y: (pointer.y - oldPos.y) / oldScale };
    scheduleView(newScale, { x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale });
  }, [scheduleView]);

  // Zoom around the visible canvas centre (used by the +/- buttons).
  const zoomCenter = useCallback((factor: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    zoomAt({ x: stage.width() / 2, y: stage.height() / 2 }, factor);
  }, [zoomAt]);

  const resetView = useCallback(() => {
    scheduleView(1, { x: 0, y: 0 });
  }, [scheduleView]);

  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return;
    const dir = e.evt.deltaY > 0 ? -1 : 1;
    zoomAt(pointer, dir > 0 ? 1.1 : 0.9);
  }, [zoomAt]);

  const cancelPendingFrame = useCallback(() => {
    if (viewFrameRef.current !== null) cancelAnimationFrame(viewFrameRef.current);
  }, []);

  return { scale, pos, setPos, zoomAt, zoomCenter, resetView, handleWheel, cancelPendingFrame };
}
```

**useWallTool.ts**（完整代码；逻辑逐字来自 BoardCanvas.tsx:44-45、78-85、264-317）：
```ts
import { useCallback, useEffect, useRef, useState } from 'react';

export function useWallTool(snap: (v: number, axis: 0 | 1) => number) {
  const wallStart = useRef<[number, number] | null>(null);
  const wallEnd = useRef<{ x: number; y: number } | null>(null);
  // Live preview line while dragging the wall tool: [x1, y1, x2, y2].
  const [wallPreview, setWallPreview] = useState<[number, number, number, number] | null>(null);

  const beginWall = useCallback((p: { x: number; y: number }) => {
    wallStart.current = [snap(p.x, 0), snap(p.y, 1)];
    wallEnd.current = p;
    setWallPreview([wallStart.current[0], wallStart.current[1], wallStart.current[0], wallStart.current[1]]);
  }, [snap]);

  const extendWall = useCallback((p: { x: number; y: number }) => {
    if (!wallStart.current) return;
    wallEnd.current = p;
    setWallPreview([wallStart.current[0], wallStart.current[1], p.x, p.y]);
  }, []);

  /** Returns the snapped start/end pair and resets the tool state; null if no wall started. */
  const finishWall = useCallback((): { start: [number, number]; end: [number, number] } | null => {
    const start = wallStart.current;
    if (!start) return null;
    const end: [number, number] = wallEnd.current
      ? [snap(wallEnd.current.x, 0), snap(wallEnd.current.y, 1)]
      : start;
    wallStart.current = null;
    wallEnd.current = null;
    setWallPreview(null);
    return { start, end };
  }, [snap]);

  const cancelWall = useCallback(() => {
    wallStart.current = null;
    wallEnd.current = null;
    setWallPreview(null);
  }, []);

  return { wallPreview, beginWall, extendWall, finishWall, cancelWall };
}
```

**useFogEraser.ts**（完整代码；逻辑逐字来自 BoardCanvas.tsx:49-51、87-96、148-177、254-283、312-317）：
```ts
import { useCallback, useEffect, useRef } from 'react';
import { connection } from '../../lib/ws';
import type { Scene } from '../../lib/types';
import { fogCellAt } from './fog';

export function useFogEraser(scene: Scene | null, brushSize: number) {
  // Eraser: batch of fog cells to reveal, drained by a throttled timer so rapid
  // drag strokes coalesce into a single setFog op. eraserDown gates reveals to
  // actual drag strokes (mouse pressed), not mere hovering.
  const eraserBatchRef = useRef<number[]>([]);
  const eraserTimer = useRef<number | null>(null);
  const eraserDown = useRef(false);

  // Collect cells under the brush (radius in fog cells) and queue a throttled
  // setFog send. Scenes without a fog array yet are treated as fully obscured
  // (fogLen = full grid), and the server's ensureFog lazily initializes fog on
  // the first send — so the eraser works on old scenes too.
  const revealAt = useCallback((wx: number, wy: number) => {
    const center = fogCellAt(scene ?? { playArea: { x: 0, y: 0, w: 0, h: 0 }, mapImage: null, mapSize: [0, 0] } as Scene, wx, wy);
    if (center < 0 || !scene) return;
    const { cols, rows } = fogGridSize(scene);
    const fogLen = scene.fog?.length ?? cols * rows;
    const centerCol = center % cols;
    const centerRow = Math.floor(center / cols);
    const r = brushSize;
    for (let dr = -r; dr <= r; dr++) {
      for (let dc = -r; dc <= r; dc++) {
        const row = centerRow + dr;
        const col = centerCol + dc;
        // Stay inside the fog grid — skipping out-of-range avoids wrapping a
        // brush stroke around the play-area border into an unrelated row.
        if (row < 0 || row >= rows || col < 0 || col >= cols) continue;
        const idx = row * cols + col;
        if (idx >= 0 && idx < fogLen && !(scene.fog?.[idx])) {
          eraserBatchRef.current.push(idx);
        }
      }
    }
    if (eraserTimer.current == null) {
      eraserTimer.current = window.setTimeout(() => {
        const cells = [...new Set(eraserBatchRef.current)];
        eraserBatchRef.current = [];
        eraserTimer.current = null;
        if (cells.length) connection.sendOps([{ op: 'setFog', cells, revealed: true }]);
      }, 120);
    }
  }, [scene, brushSize]);

  const pressEraser = useCallback((wx: number, wy: number) => {
    eraserDown.current = true;
    revealAt(wx, wy);
  }, [revealAt]);

  const dragEraser = useCallback((wx: number, wy: number) => {
    if (eraserDown.current) revealAt(wx, wy);
  }, [revealAt]);

  const releaseEraser = useCallback(() => {
    eraserDown.current = false;
  }, []);

  // Release the eraser press even if the pointer is released outside the Stage
  // (mirrors the wall tool's window mouseup pattern).
  useEffect(() => {
    const onUp = () => releaseEraser();
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, [releaseEraser]);

  // Leaving erase mode drops the queued eraser batch, pending send timer, and
  // the press flag.
  useEffect(() => {
    if (brushSize < 0) {
      if (eraserTimer.current) clearTimeout(eraserTimer.current);
      eraserTimer.current = null;
      eraserBatchRef.current = [];
      eraserDown.current = false;
    }
  }, [brushSize]);

  // On unmount, make sure no throttled setFog send is left pending.
  useEffect(() => () => {
    if (eraserTimer.current) clearTimeout(eraserTimer.current);
  }, []);

  return { pressEraser, dragEraser, releaseEraser };
}
```
⚠️ 原代码的"离开擦除模式清空"effect 以 `tool !== 'erase'` 为条件（BoardCanvas.tsx:87-96）。本 hook 以 `brushSize < 0` 为哨兵并不准确——**改为由调用方传入 `active: boolean`（= tool === 'erase'），cleanup effect 依赖 `active`**：
```ts
export function useFogEraser(scene: Scene | null, brushSize: number, active: boolean) {
  ...
  useEffect(() => {
    if (!active) {
      if (eraserTimer.current) clearTimeout(eraserTimer.current);
      eraserTimer.current = null;
      eraserBatchRef.current = [];
      eraserDown.current = false;
    }
  }, [active]);
  ...
}
```
且 `revealAt` 中 `fogCellAt` 的调用应为 `fogCellAt(scene, wx, wy)`，开头 `if (!scene) return;` 保护后直接使用（不要造占位 Scene）：
```ts
  const revealAt = useCallback((wx: number, wy: number) => {
    if (!scene) return;
    const center = fogCellAt(scene, wx, wy);
    if (center < 0) return;
    ...
  }, [scene, brushSize]);
```
`fogGridSize` 需从 `../../lib/types` import。

**useMapCalibration.ts**（完整代码；逻辑逐字来自 BoardCanvas.tsx:38-39、108-114、220-241）：
```ts
import { useCallback, useEffect, useRef, useState } from 'react';

export function useMapCalibration(authoritative: number | undefined) {
  // Consecutive map-calibration clicks must compose locally instead of waiting
  // for a server snapshot to update the callback's closure.
  const [localMapScale, setLocalMapScale] = useState<number | null>(null);
  const localMapScaleRef = useRef<number | null>(null);

  const displayedMapScale = localMapScale ?? authoritative ?? 1;

  useEffect(() => {
    const local = localMapScaleRef.current;
    if (local === null || Math.abs(local - (authoritative ?? 1)) > 0.0001) return;
    localMapScaleRef.current = null;
    setLocalMapScale(null);
  }, [authoritative]);

  // Map-image calibration: scale the map (NOT the tokens/grid) so a hand-drawn
  // map's cells line up with the grid. Sent as an op so it persists per scene.
  const adjustMapScale = useCallback((factor: number) => {
    const cur = localMapScaleRef.current ?? authoritative ?? 1;
    const next = Math.min(8, Math.max(0.1, Math.round(cur * factor * 100) / 100));
    if (next !== cur) {
      localMapScaleRef.current = next;
      setLocalMapScale(next);
      connection.sendOps([{ op: 'updateMapScale', mapScale: next }]);
    }
  }, [authoritative]);

  const setMapScale = useCallback((value: number) => {
    const clamped = Math.min(8, Math.max(0.1, value));
    if (clamped !== (localMapScaleRef.current ?? authoritative ?? 1)) {
      localMapScaleRef.current = clamped;
      setLocalMapScale(clamped);
      connection.sendOps([{ op: 'updateMapScale', mapScale: clamped }]);
    }
  }, [authoritative]);

  return { displayedMapScale, adjustMapScale, setMapScale };
}
```
⚠️ `connection` 需 import：`import { connection } from '../../lib/ws';`

**FogOverlay.tsx**（完整代码；逻辑逐字来自 BoardCanvas.tsx:380-394）：
```tsx
import { memo } from 'react';
import { Group, Rect } from 'react-konva';
import { FOG_CELL, fogGridSize, type Scene } from '../../lib/types';
import { FOG_COLOR } from './fog';
import type { RoomViewRole } from '../../lib/ws';

export const FogOverlay = memo(function FogOverlay({ scene, role }: { scene: Scene; role: RoomViewRole }) {
  const fog = scene.fog;
  const { cols, rows } = fogGridSize(scene);
  const color = FOG_COLOR[role];
  const allCovered = !fog || fog.every(x => !x);
  if (allCovered) {
    return <Rect x={0} y={0} width={cols * FOG_CELL} height={rows * FOG_CELL} fill={color} listening={false} />;
  }
  const cells: { key: string; x: number; y: number }[] = [];
  for (let i = 0; i < cols * rows; i++) {
    if (!fog[i]) cells.push({ key: `f${i}`, x: (i % cols) * FOG_CELL, y: Math.floor(i / cols) * FOG_CELL });
  }
  return <Group listening={false}>{cells.map(c => <Rect key={c.key} x={c.x} y={c.y} width={FOG_CELL} height={FOG_CELL} fill={color} />)}</Group>;
});
```
（原 BoardCanvas 的 `fogOverlay` useMemo 依赖 `[scene?.fog, scene?.mapImage, scene?.mapSize, scene?.mapScale, scene?.playArea, role]`——`memo` + 稳定的 `scene` 引用等价；若需严格等价，把依赖数组改为 `memo` 后传 `scene` 不变，行为一致）

- [ ] **Step 2: 重写 features/board/BoardCanvas.tsx（组合版）**

import 段：
```tsx
import { Stage, Layer, Rect, Line, Image as KImage } from 'react-konva';
import Konva from 'konva';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { connection, getMySessionId, useScene } from '../../lib/ws';
import { useImage } from '../../lib/useImage';
import type { PendingToken } from '../../lib/pending';
import TokenShape from './TokenShape';
import { FogOverlay } from './FogOverlay';
import { useBoardView } from './useBoardView';
import { useWallTool } from './useWallTool';
import { useFogEraser } from './useFogEraser';
import { useMapCalibration } from './useMapCalibration';
```
保留原 Props 接口（tool/pending/onClearPending/selectedId/onSelect/queryOpen/brushSize）。

组件体 = 原 BoardCanvas.tsx 的以下部分重组：
- `useScene()`、`getMySessionId()`（28-29 行原样）
- `stageRef`、`boardRef`、`stageSize`（43、52、40 行原样）
- `const { scale, pos, setPos, zoomAt, zoomCenter, resetView, handleWheel, cancelPendingFrame } = useBoardView(stageRef);`
- `const { wallPreview, beginWall, extendWall, finishWall, cancelWall } = useWallTool(snap);`
- `const { pressEraser, dragEraser, releaseEraser } = useFogEraser(scene, brushSize, tool === 'erase');`
- `const { displayedMapScale, adjustMapScale, setMapScale } = useMapCalibration(scene?.mapScale);`
- 尺寸测量 effect（61-76 原样）
- 工具切换清理 effect（79-85 原样，`setWallPreview(null)` 部分由 `cancelWall()` 替代）+ 擦除清理（87-96 已入 hook）+ 卸载清理（99-104，`cancelPendingFrame()` 替代 viewFrame 清理，eraserTimer 清理已在 hook 内）
- `map = useImage(...)`（106）、`worldPos`（117-121）、`snap`（124-130）原样
- 鼠标处理器：
```tsx
  const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool === 'erase' && role === 'dm') {
      const p = worldPos();
      if (p) pressEraser(p.x, p.y);
      return;
    }
    if (tool !== 'wall' || !scene || e.target !== stageRef.current) return;
    const p = worldPos();
    if (!p) return;
    beginWall(p);
  }, [tool, role, scene, worldPos, pressEraser, beginWall]);

  const handleMouseMove = useCallback(() => {
    if (tool === 'erase' && role === 'dm') {
      const p = worldPos();
      if (p) dragEraser(p.x, p.y);
      return;
    }
    if (tool !== 'wall') return;
    const p = worldPos();
    if (!p) return;
    extendWall(p);
  }, [tool, role, worldPos, dragEraser, extendWall]);

  const finishWallAndSend = useCallback(() => {
    if (tool !== 'wall') return;
    const wall = finishWall();
    if (wall && scene && (wall.end[0] !== wall.start[0] || wall.end[1] !== wall.start[1])) {
      connection.sendOps([{ op: 'addWall', wall: { id: `w${Date.now()}`, p1: wall.start, p2: wall.end } }]);
    }
  }, [tool, finishWall, scene]);

  const finishWallRef = useRef(finishWallAndSend);
  finishWallRef.current = finishWallAndSend;
  useEffect(() => {
    if (tool !== 'wall') return;
    const onUp = () => finishWallRef.current();
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, [tool]);
```
- `handleClick`（321-351 原样）、`handleDelete`（354-362 原样）、删除键 effect（365-376 原样）
- 渲染：Stage 各属性不变；`fogOverlay` 替换为 `<FogOverlay scene={scene} role={role} />`；迷雾控制组（518-526）、地图校准组（527-535）、缩放控制组（508-513）、选中弹层（487-506）全部原样（其中 `displayedMapScale`/`adjustMapScale`/`setMapScale`/`zoomCenter`/`resetView` 来自 hooks 返回值）

- [ ] **Step 3: 移动其余组件并修正 import（移动表）**

执行 `git mv`（源 → 目标），每个文件按表改 import：

| 文件 | import 修正 |
| --- | --- |
| `components/TokenShape.tsx` → `features/board/TokenShape.tsx` | `../useImage` → `../../lib/useImage`；`../types` → `../../lib/types` |
| `components/SceneSwitcher.tsx` → `features/scenes/SceneSwitcher.tsx` | `../api` → `../../lib/api`；`../ws` → `../../lib/ws` |
| `components/InitiativePanel.tsx` → `features/initiative/InitiativePanel.tsx` | `../ws` → `../../lib/ws`；`../types` → `../../lib/types` |
| `components/EnemyList.tsx` → `features/enemies/EnemyList.tsx` | `../ws` → `../../lib/ws`；`../upload` → `../../lib/upload`；`./DetailDrawer` → `../compendium/DetailDrawer`；`../types` → `../../lib/types` |
| `components/QueryPanel.tsx` → `features/compendium/QueryPanel.tsx` | `../api` → `../../lib/api`；`../ws` → `../../lib/ws`；`../pending` → `../../lib/pending`；`../tokenPlacement` → `../../lib/tokenPlacement`；`./DetailDrawer` → `./DetailDrawer`（不变）；`../types` → `../../lib/types` |
| `components/DetailDrawer.tsx` → `features/compendium/DetailDrawer.tsx` | `../api` → `../../lib/api`；`../ws` → `../../lib/ws`；`../lib/format` → `./format`；`../pending` → `../../lib/pending`；`../types` → `../../lib/types` |
| `client/src/backup.ts` → `features/backup/backup.ts` | `./types` → `../../lib/types` |
| `components/BackupTransfer.tsx` → `features/backup/BackupTransfer.tsx` | `../backup` → `./backup`；`../api` → `../../lib/api`；`../upload` → `../../lib/upload`；`../ws` → `../../lib/ws`；`../types` → `../../lib/types` |
| `components/TopBar.tsx` → `room/TopBar.tsx` | `../ws` → `../lib/ws`；`../features/map-upload/MapUploadButton` → `../features/map-upload/MapUploadButton`（不变）；`./BackupTransfer` → `../features/backup/BackupTransfer`；`./InvitePlayerButton` → `./InvitePlayerButton`（不变）；`./SceneSwitcher` → `../features/scenes/SceneSwitcher` |
| `components/Toolbar.tsx` → `room/Toolbar.tsx` | `../features/map-upload/MapUploadButton` → `../features/map-upload/MapUploadButton`（不变） |
| `components/InvitePlayerButton.tsx` → `room/InvitePlayerButton.tsx` | `../api` → `../lib/api` |
| `components/FilingFooter.tsx` → `app/FilingFooter.tsx` | `../api` → `../lib/api` |
| `client/src/RoomTable.tsx` → `room/RoomTable.tsx` | `./api` → `../lib/api`；`./components/BoardCanvas` → `../features/board/BoardCanvas`；`./components/EnemyList` → `../features/enemies/EnemyList`；`./components/InitiativePanel` → `../features/initiative/InitiativePanel`；`./components/QueryPanel` → `../features/compendium/QueryPanel`；`./components/Toolbar` → `./Toolbar`；`./components/TopBar` → `./TopBar`；`./features/map-upload/MapUploadProvider` → `../features/map-upload/MapUploadProvider`；`./pending` → `../lib/pending`；`./ws` → `../lib/ws` |
| `client/src/App.tsx` → `app/App.tsx` | `./Lobby` → `./Lobby`（不变）；`./api` → `../lib/api`；`./components/FilingFooter` → `./FilingFooter`；`./RoomTable` → `../room/RoomTable`；`./ws` → `../lib/ws`；`./routing` → `../lib/routing` |
| `client/src/Lobby.tsx` → `app/Lobby.tsx` | `./api` → `../lib/api`；`./routing` → `../lib/routing` |
| `client/src/main.tsx`（修改） | `./App` → `./app/App` |
| `features/map-upload/MapUploadProvider.tsx`（修改） | `../../api` → `../../lib/api`；`../../ws` → `../../lib/ws` |

⚠️ 注意 `QueryPanel.tsx` 与 `EnemyList.tsx` 都 import `DetailDrawer`——QueryPanel 在 compendium/ 同目录（`./DetailDrawer`）；EnemyList 在 enemies/ 指向 `../compendium/DetailDrawer`（**这是唯一的功能包间 import**，语义真实：敌人详情 = 资料条目展示。若要在严格意义上消除，可把 DetailDrawer 移到 `lib/`——但它在功能上属于 compendium，保留该单向依赖并在代码注释中说明）。

- [ ] **Step 4: 抽取 OwnCharacterCard**

创建 `features/enemies/OwnCharacterCard.tsx`：
- Props：`{ myToken: PlayerToken }`
- 内容 = EnemyList.tsx:29-75（avatar 状态与 `onAvatarPicked`）+ 119-173（"我的角色"卡片 JSX）原样搬移，import 改为：
```tsx
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { connection } from '../../lib/ws';
import { uploadImage } from '../../lib/upload';
import type { PlayerToken } from '../../lib/types';
```
（`myToken` 改为 prop；组件内部不再自行查找）

`features/enemies/EnemyList.tsx` 修改：
- 删除 avatar 相关状态/逻辑（原 29-75）与玩家卡片 JSX（原 119-173）
- `const myToken` 查找保留（原 27-28），渲染处：
```tsx
{role === 'player' && myToken && <OwnCharacterCard myToken={myToken} />}
```
- import 增加：`import OwnCharacterCard from './OwnCharacterCard';`
- 保留 `PALETTE` 常量（随卡片移动）与 `getMySessionId` 的 import（EnemyList 仍用于查找 myToken）

- [ ] **Step 5: 迁移剩余测试 + 删除死代码**

```bash
git mv client/src/__tests__/backup.test.ts client/src/features/backup/backup.test.ts
git mv client/src/__tests__/map-upload.test.ts client/src/features/map-upload/map-upload.test.ts
git mv client/src/lib/format.test.ts client/src/features/compendium/format.test.ts
rmdir client/src/__tests__ 2>/dev/null || true
rm client/src/store.ts
```
import 修正：
- `features/backup/backup.test.ts`：`from '../backup'` → `from './backup'`；`from '../types'` → `from '../../lib/types'`
- `features/compendium/format.test.ts`：`from './format'` → 无需改动（format.ts 同在 features/compendium/）
- `features/map-upload/map-upload.test.ts`：`from '../features/map-upload/validation'` → `from './validation'`

`rm client/src/store.ts` 前提：`grep -rn "from '.*store'" client/src` 无命中（Task 7 前已确认 store.ts 的 moveToken/addToken/addWall 无任何使用方）。若实现时发现引用，改为 `git mv` 到 `lib/` 保留并修正 import。

- [ ] **Step 6: 验证**

```bash
npx tsc --noEmit -p tsconfig.json
npm run build:client
npm run test:domain
```
预期：全绿。`tsc` 报出的路径错误逐个修正。

- [ ] **Step 7: 提交**

```bash
git add -A client/src
git commit -m "refactor(client): 组件按功能归位 app/room/features，BoardCanvas 拆为工具 hook

BoardCanvas 拆为 useBoardView/useWallTool/useFogEraser/useMapCalibration/FogOverlay，
EnemyList 抽出 OwnCharacterCard，删除无引用的 store.ts 死代码，
功能包间仅保留 enemies→compendium(DetailDrawer) 单向依赖"
```

---

### Task 9: 全量验证 + 文档 + 收尾

**Files:**
- Modify: `docs/cloudflare-architecture.md`（目录说明一段）
- 无其他代码文件

**Interfaces:**
- Consumes: 全部任务产物
- Produces: 重构完成的验收证据

- [ ] **Step 1: 全量测试与构建**

```bash
npm test
npm run build
npx tsc --noEmit -p tsconfig.json
```
预期：全绿。与 Task 1 基线对比，测试数量一致。

- [ ] **Step 2: 无残留引用检查**

```bash
grep -rn "from '\.\./ws'\|from '\./ws'\|worker/test\|client/src/components" --include="*.ts" --include="*.tsx" client/src worker/src vitest.worker.config.ts tsconfig.worker.json | grep -v node_modules
```
预期：无输出。

- [ ] **Step 3: 目录结构终检**

```bash
find worker/src client/src -type f | sort
```
预期：与设计文档 §3/§4 结构一致；`worker/test/`、`client/src/components/`、`client/src/__tests__/` 不存在；根目录只保留 `main.tsx`、`index.css`（及 index.html 若存在）。

- [ ] **Step 4: dev 冒烟（人工清单）**

```bash
npm run dev
```
访问 `http://localhost:5173`，逐项验证（与重构前行为一致）：
1. 创建房间 → 进入桌面
2. 查询面板搜「地精」→ 添加 token 到场景；战役库「入库」
3. 选择/移动/删除 token；画墙；擦除迷雾（DM）；一键清空/添加遮罩
4. 先攻：玩家提交、DM 添加、下一回合
5. 切换/新建/重命名/锁定场景；玩家端战役库只读预览
6. 邀请玩家 → 新标签页打开邀请链接兑换
7. 上传地图（含超大文件被拒的提示）；上传头像
8. 备份导出 → 导入为新场景
9. 刷新页面（WebSocket 重连 + 乐观命令重放）；断网重连

- [ ] **Step 5: diff 复核**

```bash
git diff --stat HEAD~8..HEAD
git log --oneline HEAD~8..HEAD
```
预期：8 个重构提交（Task 2-9），diff 均为移动 + 拆分。抽查任意大文件 diff（如 `git show <commit> --stat`），确认无逻辑改动。

- [ ] **Step 6: 更新架构文档**

`docs/cloudflare-architecture.md` 的「目标与边界」末尾追加一段：
```markdown
仓库布局（2026-08 重构后）：`worker/src/` 按边界拆分为
`router.ts`（纯路由）、`control-plane/`（D1 数据访问：rooms/assets/gateway/audit）、
`compendium/`（本地+在线资料查询）、`board/`（Room DO：room-do/protocol/persistence/patches/domain）；
`client/src/` 按功能拆分为 `app/`（路由与大厅）、`room/`（房间壳）、
`features/`（board/scenes/initiative/enemies/compendium/backup/map-upload）、
`lib/`（ws 传输与状态、api 客户端、乐观重放等基础设施）。
HTTP/WS 协议与部署配置不变。
```

- [ ] **Step 7: 最终提交**

```bash
git add docs/cloudflare-architecture.md
git commit -m "docs: 更新 cloudflare-architecture.md 目录布局说明（模块化解耦重构后）"
```

---

## Self-Review 记录（写作时已核对）

1. **Spec 覆盖**：
   - §3 worker 结构 → Task 2-6 全覆盖（含入口具名导出、router 薄层、audit 独立、mutate 编排留类内）
   - §4 client 结构 → Task 7-8 全覆盖（ws 三拆 + decode 辅助模块、BoardCanvas 五拆、OwnCharacterCard、pending/tokenPlacement 归 lib、store.ts 死代码删除见下）
   - §6 测试迁移 → Task 3/4/5/6/7/8 随码迁移，vitest.worker include 在 Task 6 修改
   - §7 验证标准 → Task 1 基线 + Task 9 全量验证 + diff 复核
   - §8 文档 → Task 9 Step 6
   - `client/src/store.ts` 死代码：设计中已确认无引用 → Task 8 Step 5 显式删除（带 grep 前提与保底策略）
   - `format.ts` 过渡：Task 7 经 lib/ 迁移，Task 8 与 DetailDrawer 一同落入 features/compendium/（每次移动后编译保持绿色）
2. **占位符扫描**：无 TBD/TODO；所有新代码完整给出；搬移指令均带精确源行号
3. **类型一致性**：`handleSearchRoute(request, env, ctx, url, userId)` 在 Task 4 定义、Task 6 调用，参数一致；`useFogEraser(scene, brushSize, active)` 在 Task 8 Step 1 定义、Step 2 调用一致；`finishWall()` 返回 `{start, end} | null` 与 BoardCanvas 消费一致；`RoomStore`/`SocketTransport`/`Connection` 的公开方法在 Task 7 Step 3-5 定义并互相调用一致；`SocketTransport.isOpen` 在 Step 3 定义、Step 5 的 Connection 使用
