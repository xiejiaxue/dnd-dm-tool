# 项目结构与模块边界

这份说明描述代码依赖方向。新增功能应优先放进所属 feature 或 Worker 领域模块，避免继续把业务逻辑堆到页面、WebSocket 或 Durable Object 入口中。

```text
shared/types.ts                     跨端协议与领域类型

client/src/
├─ App.tsx                          应用组合入口，不承载房间业务
├─ features/
│  ├─ room-navigation/              URL、邀请兑换、房间连接生命周期
│  ├─ board/                        画布视图、几何、Token 与迷雾图层
│  ├─ compendium/                   资料搜索、收藏名称、怪物 Token 工厂
│  ├─ campaign/                     战役与场景目录数据
│  ├─ hit-points/                   HP 模型与敌人 HP 界面
│  ├─ map-upload/                   地图上传状态、校验与按钮
│  └─ npc/                          NPC Markdown 解析、档案管理与 Token 工厂
├─ realtime/
│  ├─ SocketTransport.ts            WebSocket 建连、重连与帧传输
│  ├─ RoomStore.ts                  权威快照、乐观操作与 patch 对账
│  ├─ RoomConnection.ts             组合传输和状态，不依赖 React
│  └─ protocol.ts                   浏览器端实时协议解析
└─ ws.ts                            面向现有 React 组件的兼容门面

worker/src/
├─ index.ts                         HTTP/API 网关与 Cloudflare 绑定
├─ room.ts                          Durable Object 请求/消息协调器
├─ domain.ts                        纯房间状态转换和玩家投影
├─ repository.ts                    D1 控制面数据访问
└─ board/
   ├─ operation-authorization.ts    棋盘操作校验与角色授权
   ├─ patch-projection.ts           按角色生成实时增量投影
   ├─ persistence.ts                DO SQLite schema 与事务写入
   └─ protocol.ts                   内部 header、WS attachment 与输入解析
```

## 依赖规则

1. `shared` 不依赖客户端或 Worker；协议字段只在这里定义一次。
2. React 组件负责渲染和用户事件。可独立测试的计算放进 feature 模型/几何模块，异步数据生命周期放进 hook。
3. UI 通过 `ws.ts` 使用实时房间；`RoomStore` 不访问浏览器 API，`SocketTransport` 不理解场景业务。
4. `room.ts` 只协调请求、事务和广播；授权、投影、持久化分别由 `board/` 模块负责。
5. Worker 是最终权限边界。前端隐藏按钮或乐观更新不能替代 `operation-authorization.ts` 的校验。

## 扩展方式

- 新棋盘操作：先扩展 `shared/types.ts`，再实现 Worker 授权和 domain 状态转换，最后增加 optimistic reducer 与 UI。
- 新右侧功能：在 `client/src/features/<feature>/` 中放模型、hook 和小组件，由 `QueryPanel` 或房间壳组合。
- 新实时消息：在两端 protocol 层完成解析，让 transport 保持只负责连接生命周期。
- 新持久化字段：通过迁移/兼容归一化写入，避免在 React 组件中修复历史数据。

所有边界模块都有对应的纯逻辑或协议测试；提交前运行 `npm test && npm run build`。
