# D&D 5e 角色卡插件 v2

角色卡以 `dnd5e-character-sheet` 扩展存在，核心应用只负责挂载扩展页面和委托命名空间 API。角色卡类型、校验、规则来源和 Actor 转换逻辑都位于 `shared/plugins/dnd5e-character-sheet/`；前端页面位于 `client/src/plugins/dnd5e-character-sheet/`；Worker 接口位于 `worker/src/plugins/dnd5e-character-sheet/`。

## 使用边界

- 首页的 `/characters` 是个人空间，不依赖房间。用户可以创建、修改或删除自己的角色卡。
- 房间身份是局部身份。同一用户在 A 房间可以是 DM，在 B 房间可以是玩家。
- 只有当前房间角色为 `player` 时，角色目录才会列出个人角色卡并允许导入；`host`、`dm`、`assistant_dm` 和 `spectator` 都由 Worker 拒绝。
- 导入会创建一份房间 Actor 快照并自动认领。导入后个人卡与房间 Actor 不做隐式双向同步，避免个人修改覆盖 DM 已经裁定的团内状态。

## 规则来源

角色卡保存规则引用，不复制规则书正文。`scripts/build-character-rules.mjs` 从本地的 5etools-cn 结构化数据生成 `data/db/character-options.json`，包括种族、职业、子职业、背景、专长、法术和物品索引，并合并 5etools 的法术—职业映射。索引同时包含属性加值、生命骰、豁免/技能熟练、职业装备、升级特性、法术说明和物品数据，供独立规则引擎自动计算。数据更新脚本会合并中文字段和上游 schema，然后自动重建该索引。

```bash
npm run data:update             # 下载并合并资料，同时生成角色选项索引
npm run data:character-rules    # 只用已有 data/db 重建角色选项索引
npm run data:character-rules:local # 重建并写入 wrangler dev 使用的本地 R2
```

规则包由角色卡自己记录。PHB 2014 是当前 Actor 数据模型的固定基础，其他来源通过勾选启用；关闭来源时，属于该来源的种族、职业、子职业、专长、法术和物品引用会一并清理。

魔邓肯与艾伯伦按出版物独立启用：`MPMM` 提供《魔邓肯巨献：多元宇宙怪物》的修订可玩种族，并在全局资料库提供对应怪物；`ERLW` 提供《艾伯伦：从终末战争中崛起》的种族、背景、龙纹专长、物品和怪物；`EFA` 提供《艾伯伦：奇械锻炉》的新版奇械师、子职业、专长、物品、法术和怪物。角色卡勾选只控制角色构筑选项，不会删除全局资料库中的 DM 查询资料。

## 数据模型与实时计算

- 属性使用 27 点购点，基础值限定为 8–15；种族或背景的固定/可选加值和少量自定义修正单独保存。
- `rules-engine.ts` 根据等级和规则引用统一派生最终属性、调整值、熟练加值、豁免、18 项技能、被动值、AC、速度、最大 HP、生命骰、施法 DC/攻击、法术位、特性和负重。客户端预览与 Worker 持久化共用同一实现。
- 角色卡中的当前 HP、临时 HP、死亡豁免、激励、已消耗生命骰/法术位和状态是实时游玩状态；规则派生值不会由表单重复保存。
- 物品、货币、背景叙事、人格/理想/羁绊/缺点、组织、专长与已知/准备法术均是角色自己的数据。规则物品和自定义物品可以并存。
- v1 角色卡在读取时迁移为 v2。旧卡的最终属性和手工战斗数值会转换为兼容覆盖，避免迁移后数值突变。

字段范围参考了用户提供的《龍與地下城自動角色卡5E v4.8.5》：其身份、属性/豁免/技能、战斗资源、装备负重、角色扮演字段和分级法术表被归并为上述结构，但没有照搬工作簿跨单元格公式，计算职责集中在纯规则引擎中。

## 页面结构

`/characters` 提供八个工作区：游玩、身份与构筑、属性、熟练项、特性、法术、装备和背景。构筑页负责规则选择，游玩页只保留团中高频操作；生命、休息和法术位等游玩操作会立即保存，其他编辑通过显式保存提交。

## 存储与 API

个人角色卡使用 D1 `characters` 表，并始终以会话 `user_id` 过滤。插件接口是：

- `GET /api/plugins/dnd5e-character-sheet/rules`
- `GET|POST /api/plugins/dnd5e-character-sheet/characters`
- `GET|PATCH|DELETE /api/plugins/dnd5e-character-sheet/characters/:id`
- `GET /api/rooms/:slug/plugins/dnd5e-character-sheet/characters`（仅玩家）
- `POST /api/rooms/:slug/plugins/dnd5e-character-sheet/characters/:id/import`（仅玩家）

将来增加别的规则系统时，应新增自己的插件目录、schema、规则目录和导入桥接，不要向核心 Actor 或大厅写入该规则系统的字段。
