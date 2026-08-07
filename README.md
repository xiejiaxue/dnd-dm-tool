# D&D DM 追踪工具

这是一份完全由claude code vibe出来的一个个人工具，适合线下面团的仿fvtt战斗追踪工具（有效避免战斗轮口胡），局域网多人 D&D 5e DM 追踪工具：棋盘（地图底图/网格/墙/token）、5e不全书中文查询、收藏夹、先攻追踪。

## 启动

1. `npm install`
2. `npm run data:update`   # 下载 5etools 中文数据 + 构建索引（需联网，约几十 MB）
3. `npm run build && npm start`   # 生产模式，监听 0.0.0.0:3001
4. DM 浏览器打开 `http://localhost:3001`（DM 权限）
5. 玩家连同一 WiFi，打开 `http://<你的局域网IP>:3001`（玩家权限，可拖 token、提交先攻）

开发模式：`npm run dev`（后端 3001 + 前端 5173，仅本机开发用）

## 功能

- **棋盘**：上传地图底图、网格开关/大小/颜色/吸附、画墙（纯视觉标记）、缩放平移、token 放置与拖拽。
- **查询**：中英文模糊搜索怪物/法术/装备/专长，点击查看完整中文详情。
- **收藏夹**：常用条目一键收藏，收藏夹显示中文名并可打开详情。
- **先攻追踪**：玩家输入先攻值提交（按 sessionId 去重），DM 推进回合，当前行动者的 token 外圈金色高亮。
- **场景管理**：多场景新建/切换/删除，每次操作自动保存，刷新后回到上次场景。
- **权限**：`localhost` 连接为 DM；玩家可拖 token、提交先攻；用口令可升级为 DM 权限。

## 数据

- `npm run data:update` 可重跑更新；数据来自 `tjliqy/5etools-cn`（cn2.0 分支，CC BY-NC-SA 4.0），存储在 `data/db/`。
- 怪物头像默认从 `https://5e.tools` 下载，可用 `DND_IMAGE_BASE` 环境变量换源。
- 下载失败自动用首字母占位 token。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3001` | 服务端口 |
| `HOST` | `0.0.0.0` | 监听地址（局域网联机需保持 0.0.0.0） |
| `DND_IMAGE_BASE` | `https://5e.tools` | 怪物肖像图源 |
| `DND_PASSWORD` | 未设置 | DM 口令；玩家输入后获得 DM 权限。不设则仅 localhost 是 DM |

## 测试

```bash
npm test        # 全部单元 + 集成测试
npx tsc --noEmit  # 类型检查
```
