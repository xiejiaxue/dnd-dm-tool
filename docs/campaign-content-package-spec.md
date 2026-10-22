# 跑团内容包规范 v1

本规范是项目中跑团模组的唯一数据边界。新增模组不应修改 Worker、房间领域模型或前端组件；只需增加一个内容包，校验、构建并发布。

实现契约位于 `shared/content-package.ts`，机器可读约束位于 `schemas/campaign-content-package.schema.json`。二者冲突时，以运行时解析器为准，并应同步修正 Schema。

## 生命周期与边界

```text
内容包源码               构建产物                    运行时
manifest.json    ─┐
scenes/**/*.json ├─ content:build ─→ manifest + assets ─→ 私有 R2
npcs/**/*.json   ┤                         │
assets/*         ┘                         └─ 创建房间时克隆 → 独立 Room 状态
```

- 内容包是只读、可版本化的数据，不包含任意 JavaScript、Worker 路由或数据库迁移。
- 地图二进制只在 R2 保存一份；创建房间会为场景和 Token 生成新 ID，并复制 NPC 和可变游戏状态。
- 已创建房间不跟随内容包升级，避免正在进行的战役被发布操作改写。升级后的版本仅用于以后新建的房间。
- `id`、场景 `key` 和 NPC `id` 是源码中的稳定身份；房间 ID、场景 ID 和 Token ID 都是实例身份，禁止写回内容包。

## 推荐目录

```text
my-adventure/
├── manifest.json
├── scenes/
│   ├── 010-第一章/
│   │   ├── 010-入口.json
│   │   └── 020-大厅.json
│   └── 020-第二章/
│       └── 010-地窖.json
├── npcs/
│   ├── 010-中立/
│   │   ├── 010-旅店老板.json
│   │   └── 020-向导.json
│   └── 020-城卫队/
│       └── 010-队长.json
└── assets/
    ├── map-entry-0123456789ab
    └── map-cellar-fedcba987654
```

文件名前的数字只控制源码阅读顺序，不是数据身份。场景的客户端分组来自 `chapter`；NPC 固定为“阵营 → 人物”两级，来自 `faction`，每个人物文件必须包含这个人物的全部身份、背景、地点、规则引用、公开信息与主持人笔记，不再拆成“背景/数据/地点”子文件。

为了兼容已有深水城构建器，`scenes` 和 `npcs` 也可以直接内嵌在 `manifest.json`。新内容包优先使用上述多文件形式；两者不可混用。

## manifest.json

```json
{
  "schemaVersion": 1,
  "id": "my-adventure",
  "name": "我的冒险",
  "description": "用于首页模板选择的简介。",
  "version": 1,
  "system": "dnd5e",
  "authors": ["作者名"],
  "license": "仅限获得授权的使用方式",
  "homepage": "https://example.com/my-adventure"
}
```

| 字段 | 规则 |
| --- | --- |
| `schemaVersion` | 当前固定为 `1`。结构不兼容时才升级。 |
| `id` | 1–64 位小写字母、数字和连字符；发布后永久稳定。 |
| `name` | 首页显示名，最多 120 字符。 |
| `description` | 最多 500 字符。 |
| `version` | 正整数。任何会影响新房间的发布都递增。 |
| `system` | 当前可省略或使用 `dnd5e`。 |
| `authors`、`license`、`homepage` | 可选的来源与授权信息，不能放密钥。 |
| `sceneCount`、`npcCount` | 构建产物字段，由构建器生成，源码无需维护。 |

内容包只保存你有权使用的资料和图片。许可证字段是说明，不会代替原作品的实际授权。

## 场景文件

一个文件只包含一个场景对象：

```json
{
  "key": "chapter-1-entry",
  "name": "第一章 · 入口",
  "chapter": "第一章",
  "unlocked": false,
  "map": {
    "assetId": "map-entry-0123456789ab",
    "width": 2400,
    "height": 1600,
    "contentType": "image/webp",
    "mapScale": 2
  },
  "tokens": []
}
```

- `key` 在同一内容包内唯一；重命名场景时也不要改变它。
- `chapter` 是场景库文件夹路径显示值，可使用 `第一章 / 城堡` 表达分组；当前房间实例化按完整字符串建立一层分组。
- `unlocked` 只决定新房间中玩家能否在场景库看到它。通常仅第一个安全场景设为 `true`。
- `map.width` 和 `height` 必须是图片原始像素尺寸，构建器会读取图片复核。
- `mapScale` 是原图坐标到棋盘世界坐标的比例，范围 `0.1–8`。
- `assetId` 必须以该文件 SHA-256 的前 12–64 位十六进制摘要结尾。构建器会验证；资源因此可以安全使用不可变缓存。
- 当前支持 JPEG、PNG、WebP 和 AVIF，单边不超过 20,000 像素。

### 预置 Token

```json
{
  "kind": "npc",
  "name": "守门人",
  "entryId": "npc:npc-gatekeeper",
  "x": 400,
  "y": 240,
  "size": 100,
  "avatar": "/api/token/MM__Guard",
  "color": "#8b5cf6",
  "hp": { "current": 11, "max": 11 },
  "hidden": true,
  "publicName": "蒙面守卫",
  "hpVisibility": "bar"
}
```

- `kind` 只允许 `monster` 或 `npc`；玩家 Token 属于房间成员，不属于模组内容。
- NPC 引用统一为 `npc:<NPC id>`；构建器拒绝不存在的引用。怪物引用使用规则库的稳定 `entryId`，例如 `MM__Goblin`。
- `x`、`y` 和 `size` 都是缩放后的棋盘世界坐标；原图像素位置换算为 `像素 × mapScale`。`x/y` 是 Token 左上角，整个 Token 必须位于地图内。
- `hidden` 默认为不隐藏；`publicName` 是玩家可见化名；`hpVisibility` 为 `none`、`bar` 或 `value`。
- Token 可以带当前/最大 HP 和状态，但不携带先攻或战斗轮。Encounter 是一次游戏实例中的临时状态。

## NPC 文件

每个人物一个 JSON 文件，阵营内按重要程度和文件名前缀排序：

```json
{
  "id": "npc-gatekeeper",
  "name": "守门人",
  "aliases": ["旧称"],
  "role": "城门守卫",
  "location": "北门",
  "status": "active",
  "importance": "supporting",
  "faction": "城卫队",
  "groupPath": ["城卫队"],
  "statReference": {
    "kind": "compendium",
    "entryId": "MM__Guard",
    "nameZh": "警卫",
    "nameEn": "Guard"
  },
  "notesMarkdown": "**身份**：城门守卫\n\n**背景**：……\n\n**地点**：北门",
  "playerAccess": "limited",
  "publicDescription": "一位尽职的城门守卫。",
  "sourceFile": "城卫队/守门人.json",
  "updatedAt": 0
}
```

统一规则：

- `id` 在内容包内唯一且长期稳定；不要从当前文件名或人物显示名临时推导。
- `faction` 是唯一目录层级，`groupPath` 规范值为 `[faction]`。运行时会把旧的多层路径归一化为两级浏览结构。
- `importance` 使用 `major`、`supporting`、`minor`，同阵营中主要人物优先。
- `status` 使用 `active`、`missing`、`inactive`、`dead`。
- `notesMarkdown` 是主持人完整资料；禁止把秘密内容复制到 `publicDescription`。
- `playerAccess`：`none` 完全不公开，`limited` 只公开安全简介，`observer` 还可公开规则引用。省略时按 `none` 处理。
- `statReference.kind`：`compendium` 引用怪物手册数据；`custom` 表示规则表写在人物 Markdown 中；`npc` 复用同包另一人物的数据。

## 校验、构建和发布

```bash
# 只读校验，不写 output
npm run content:validate -- /绝对路径/my-adventure

# 生成 output/room-templates/<id> 并更新总索引
npm run content:build -- /绝对路径/my-adventure

# 只发布该内容包；不设置 CONTENT_PACKAGE_ID 则发布全部构建产物
CONTENT_PACKAGE_ID=my-adventure \
R2_REFERENCE_BUCKET=<REFERENCE_DATA bucket> \
npm run content:publish
```

校验器会检查：契约版本与字段边界、唯一 ID、NPC 交叉引用、Token 地图边界、HP 合法性、地图实际格式与尺寸，以及资源 ID 中的 SHA-256 摘要。Worker 在房间创建时会再次使用同一个 TypeScript 解析器，不信任 R2 中未经构建器上传的 JSON。

## 版本策略

- 修正文案、增加 NPC、调整地图或 Token：递增 `version`。
- 删除或改变稳定 ID 会被视为破坏性内容变化；优先保留旧 ID 并增加新记录。
- 改变字段含义或必填结构：升级 `schemaVersion`，同时提供运行时兼容或迁移。
- 不允许用同一 `assetId` 覆盖新图片。图片变化会自然得到新摘要和新 ID。

## v1 明确不包含

房间权限、玩家认领、邀请、聊天/行动日志、战斗轮、战争迷雾、用户布局和撤销历史都属于房间实例，不进入内容包。Actor、Journal、Item、RollTable、Playlist、Macro 与地图标记已经在平台文档层有独立模型，但当前模板实例化尚未建立稳定的跨文档 ID 映射，因此 v1 不虚构对它们的导入支持。后续应以新增的 `documentPacks` 字段和新的 schema 版本扩展，并保持当前 v1 包可继续加载。
