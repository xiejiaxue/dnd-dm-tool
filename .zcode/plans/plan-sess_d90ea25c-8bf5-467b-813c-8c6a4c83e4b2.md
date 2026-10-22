# 瑞士风格（国际主义设计风格）前端改版方案

## 设计定位

依据你给出的经典定义，按**正统瑞士风格**执行：干净、易读、客观；以字体排印为核心设计元素；栅格与细规则线组织版面；靠左对齐；无衬线字体。当前 UI 是"深色卡片 + 圆角 + 阴影 + emoji 图标"风格，与瑞士语言相悖，本次全部替换。

## 设计系统（Design Tokens）

**色彩 — 黑 / 白 / 红 + 灰阶**（写入 `tailwind.config.js` 扩展调色板 + `index.css` 变量）：
- `paper #F5F4F0`（页面底，暖白纸面）、`panel #FFFFFF`（面板白）
- `ink #111110`（墨黑正文）、`muted #6E6C65`、`faint #A6A49B`
- `line #DAD8CF`（发丝线）、规则线用 ink（顶栏/章节用 2px 黑线）
- `accent #E42313`（瑞士红：激活态、DM 操作、关键强调、危险操作）
- 语义映射：主按钮＝黑底白字方块；激活/强调＝红；删除/伤害＝红（描边或文字形式）；在线/HP 正常＝墨黑（不再用绿色系），HP 濒死/删除悬停＝红。DM 角色标红、玩家标黑。

**字体排印**（不引入 webfont，大陆部署友好）：
- 栈：`"Helvetica Neue", Helvetica, Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`
- 大标题粗体、紧字距；栏目眉标（如"先攻""敌人"）＝10px 加粗 + `letter-spacing 0.18em`（中文字间距）
- 所有数字（先攻值、HP、骰点、缩放%）一律 `tabular-nums`

**几何**：全部直角（移除 rounded-*）；去阴影、去渐变；面板间用发丝线/粗规则线分隔，不用卡片盒子。

**通用组件类**（`index.css` `@layer components`，消灭重复类串）：
`.btn`＋`.btn-primary`（黑）/`.btn-accent`（红）/`.btn-quiet`（白底描边）/`.btn-danger`/`.btn-text`、`.field`（输入框/下拉：方角、白底、focus 红边）、`.panel-label`（眉标）。

## 人机工学改进（更符合操作习惯）

- 全局键盘 `focus-visible` 红色描边；按钮 `cursor: pointer`；悬停态统一（浅灰底，120ms 过渡）
- 工具栏从 emoji 图标改为**竖排文字标签**（选择/放置/画墙/擦除/地图/缩放，激活＝红字+左侧红规则线），加宽点击区
- 全部 emoji 图标替换为文字或排版字符（＋ − ✕ ★ 保留）；次要行内操作改为"行悬停时显现"（渐进披露），降低视觉噪音
- 主操作按钮（创建/进入/下一回合）统一加大为 32px 高黑底主按钮；数字输入居中 tabular

## 分文件改造（只改样式与文案呈现，不动任何业务逻辑/状态/props）

1. **基座**：`tailwind.config.js`（调色板）、`index.css`（变量+组件类+focus-visible）、`index.html`（theme-color）、`App.tsx`（外壳/加载/错误态）、`FilingFooter`
2. **桌面区**：`TopBar`（白底+2px 黑顶规则线，红方块标徽+粗体品牌名，面包屑，状态数据化）、`Toolbar`（文字标签竖条）、`InitiativePanel`（激活回合＝黑底白字红值反转块，"下一回合"黑色主按钮）、`EnemyList`（行式列表+发丝线，HP 黑/红 tabular）、`QueryPanel`（标签页激活＝粗体+2px 红下划线；在线来源横幅改红左规则线）
3. **阅读与录入**：`DetailDrawer`（借鉴 print 版式：粗黑顶线+编号章节眉标+发丝线行，与角色卡打印稿同一设计语言）、`ChatPanel`、`JournalPanel`
4. **门户页**：`Lobby`（海报式页头：眉标+特大粗体标题+规则线；房间列表改行式，双栏间竖向发丝线替代卡片盒；去掉渐变/圆角/阴影）、`CampaignPortal`（同系统）、`SessionCalculator`（特大 tabular 骰值、黑白红按钮）
5. **浮层**：`SceneSwitcher`、`CampaignSwitcher`、`BackupTransfer`、`CharacterSheetPanel`（保持现有 parent-relative 定位不做 portal 重构，外观改方角白底+黑描边）
6. **画布**：`BoardCanvas` HUD（白底方角 chips+发丝线）、Konva 硬编码色统一到 tokens：地图占位浅灰、墙 ink、墙预览红、选中描边红、当前回合脉冲环红、DM 迷雾红色半透明、怪物名红/玩家名白（保证地图上可读）
7. **打印稿**：`characterSheetPrint.ts` 强调色 `#d97706 → #E42313`，与屏内统一

## 验证

- `npm run build:client` + `vitest run --config vitest.config.ts`（现有测试均为纯逻辑，不受样式影响，需全绿）
- `npm run dev` 本地起 worker+vite，浏览器实际截图核查：大厅、战役门户、桌面全貌、查询/详情/先攻/敌人面板、角色卡浮层
- 按交付规范用 judge 代理对渲染页面做视觉验收，问题回修

风险控制：不改任何路由、WebSocket、op 逻辑；浮层定位机制不变；所有 title/禁用态行为保留；未提交的新文件（SessionCalculator、角色卡打印）一并纳入同套系统。