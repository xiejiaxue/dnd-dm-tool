# 深水城：龙金劫

模板 `waterdeep-dragon-heist` 有 21 个场景，每张书中地图一个场景。

## 地图

地图来自 Tych Maps 公开预览图（tychmaps.com，带 PATREON | TYCH 角标，粉丝内容，仅供自用）。书里一张图有多层的，各层 Tych 图按书中排列拼成一张，左上角标层名；层与层之间留一格深色间隔。

- 7.2 猩红落叶号：Tych 只有上甲板，下甲板沿用书中原图放大。
- 7.1 只合成夺目者号（嘉年华日常配置）。
- 2.1 巨魔颅骨巷：Tych 网格与书一致，一格 10 尺。
- 4.9 和 5.1：书中一格 10 尺，Tych 一格 5 尺。

`shared/waterdeep/maps.json` 记录每张图的资源 ID、尺寸和 `mapScale`。`mapScale` 取 100 ÷（每 5 尺格的像素），所以一格就是 100 棋盘像素。`shared/map-grid.ts` 按图片哈希记录格子大小。

上传方法：先把清单和图片放进 `output/waterdeep/`，再运行：

```bash
node scripts/publish-waterdeep.mjs --remote
```

脚本先传 21 张图，最后才提交清单。新战役导入新图；已创建的战役保留原来的书中地图。

## 怪物布置

- `deployment.json`：书中地图上的位置。
- `deployment-hd.json`：同一份名单在 Tych 合成图上的位置。

部署接口看场景地图是不是 `map-waterdeep-NNN-<hash>`，以此决定用哪一份，所以两种地图的战役都能部署。

HD 位置的换算方法：
1. 先把书中各层图配准到对应的 Tych 层：多数靠格子周期和边缘匹配，布局改动大的靠人工对点做仿射。
2. 每个房间的怪物整体平移。
3. 落在虚空里的怪物，移到最近的空地上。
