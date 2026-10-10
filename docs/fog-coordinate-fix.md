# 迷雾与地图坐标修复

2026-10-10，经用户授权同步修改迷雾契约。

- 地图与迷雾共享原图坐标、原点和显示缩放；迷雾严格裁切到图片宽高。棋子与墙体仍使用场景世界坐标，地图校准不会调整其坐标或大小。
- `Scene.fogBasisScale` 固定迷雾栅格密度。`fogGridSize` 使用该基准，不再随 `mapScale` 改变数组列数。格子在图像坐标中的大小为 `50 / fogBasisScale`。
- `updateMap` 可携带迷雾基准，供备份恢复；普通上传默认基准为 1。`updateMapScale` 的服务端补丁携带服务端实际基准。`setFog` 携带 `basisScale`，过期的坐标请求会被拒绝。
- 旧场景在 Durable Object 加载时一次性补充基准，原始记录保存在 `fog_legacy_backup`。优先沿用有效的现有栅格；已发生行列错位的旧记录按数组长度与图片尺寸恢复可行网格。旧格式未保存精确的历史校准比例，已损坏记录不能保证恢复到历史像素级边界。
- 场景备份升级为 v2，保留迷雾基准；仍可读取 v1。连续遮罩合并为矩形，减少 Konva 绘制节点。
- 敌人添加失败来自头像 URL 被误当作私有底图地址校验。恢复 `/api/token/:id` 头像路由，地图地址继续使用战役私有路由。添加模式禁用画布拖拽并支持触屏点击；放置后清理全局待放置状态。

涉及文件：`shared/types.ts`、`shared/fog.ts`、`worker/src/domain.ts`、`worker/src/room.ts`、`worker/src/campaign-store.ts`、`client/src/optimistic.ts`、`client/src/components/BoardCanvas.tsx`、`client/src/components/fog-geometry.ts`、`client/src/components/query/actions.ts`、`client/src/App.tsx`、`client/src/backup.ts`、`client/src/components/BackupTransfer.tsx`，以及对应测试。

发布后应刷新已有战役页面，让浏览器使用新的迷雾坐标实现。

## 精确框选擦除

2026-10-10，经用户再次授权新增精确选区契约。

- `Scene.fogReveals` 保存原图坐标中的矩形 `{x,y,width,height}`，保留小数；无底图时相对于 `playArea` 原点。`revealFogRect` 仅主持权限可发送，服务端校验有限数值、正尺寸并裁切到地图边界。
- 框选预览和提交使用相同的逆变换及裁切。矩形不吸附到 50 单位栅格，地图校准及战斗区缩放都不改动保存的区域。重复、包含或重叠的矩形按并集显示。
- 笔刷仍使用原栅格。遮盖单元时同步扣除该单元内的精确区域；全部遮盖、全部揭开及更换地图清理精确区域。迷雾以单个 Canvas 路径填充，避免矩形拼接的抗锯齿亮缝。
- 同步补丁、客户端乐观更新、SQL 场景 JSON 和备份导入导出保留新字段。无需数据库迁移。已有整格擦除记录保留，无法从旧数据反推出当时的精确选框。

本次修改文件：`shared/fog.ts`、`shared/types.ts`、`worker/src/domain.ts`、`worker/src/room.ts`、`client/src/optimistic.ts`、`client/src/components/BoardCanvas.tsx`、`client/src/components/fog-geometry.ts`、`client/src/backup.ts`、`client/src/components/BackupTransfer.tsx`；测试为 `client/src/__tests__/{fog-geometry,board-interaction,backup}.test.ts`、`worker/test/{fog-and-token,room.integration}.test.ts`；另有本说明及 `output/playwright/fog-exact*.js` 浏览器验收记录。未修改本次授权范围外的功能或遗留 `server/` 代码。

验收：`npm run test` 通过（领域/客户端 249 项、Worker 26 项）；`npx tsc --noEmit`、`npm run build`（含 `check:worker`）通过。Playwright 本地与线上主持人/玩家双端验证：选框与保存边界一致、精确擦除面积、地图 137% 与战斗区 80% 双重缩放、小于一格的选区、Esc 取消、玩家刷新及全部遮盖均通过。已检查截图无拼接亮线。Cloudflare 版本 `0bac8672-1626-4ef4-86fd-540457066a64`，保留现有 D1/R2 绑定。
