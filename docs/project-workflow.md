# 项目管理与发布约定

## 唯一正式来源

- 仓库：https://github.com/xiejiaxue/dnd-dm-tool
- 正式分支：`main`
- 本地主目录：`/Users/xiejiaxue/developer/dndtool`
- 网站：https://dnd.xiejiaxue.com
- Worker：`dnd-dm-tool`
- 线上提交及资源校验信息：https://dnd.xiejiaxue.com/release.json

瑞士风格、工具切换不整页刷新是当前正式产品。Claude 云会话和旧预览目录均不作为发布来源。

## 开发与发布

音乐准备需要 Python 3 和 curl。素材哈希固定为此前已验证可播放的原始录音；每次发布逐字节核对，无需额外安装系统音频解码器。

每项任务使用独立分支；同时运行的 Claude/Codex 任务使用独立 Git worktree，不共用有修改的目录。提交前检查差异，不把凭据、角色导出、本地数据库或截图加入提交。

```sh
git fetch origin
git switch -c feature/example origin/main
npm ci
npm run music:prepare
npm test
npm run build
```

将任务分支推送到 GitHub 并创建 PR，Test and build 检查通过后合入 main。main 已启用分支保护：禁止强推和删除，必须通过 PR 与检查；不要求额外人工审批。GitHub Production 工作流执行测试、音乐校验、构建、发布和线上核验。PR 只执行检查，不拿生产凭据、不发布。`production` 环境只用于 main，凭据保存在该环境的 secret 中。

生产发布串行运行，不中断正在上传的版本；执行前拒绝过期 main、脏工作区或提交号不匹配的构建。音乐优先从 GitHub Release `music-assets-20261022` 获取（附完整署名和许可清单），原作者源站作为后备。资源包不可覆盖；换曲目时发布新资源版本。音乐依据已提交的 credits.json 校验 SHA-256，旧 MP3 只从构建输出剔除，源文件不删除。

每次运行保留构建产物 14 天、发布日志和版本记录 90 天。release.json 记录源码提交、构建时间、工作流运行 ID、全部公开资源哈希。流程验证六个工具页面、Worker 健康状态及资源字节，不操作战役内容。

## 生产数据边界

- D1：`dnd-dm-tool-campaigns` / `e755f51e-5c77-4c70-8f8c-98012e52bf44`
- R2：`dnd-dm-tool-room-assets`、`dnd-dm-tool-reference-data`
- Durable Objects：ROOMS、COMPENDIUM_RATE_LIMIT

发布固定使用已有资源并保留 Worker vars。远程迁移、资料库更新、资源删除不是常规发布步骤。应用代码回滚不会回滚数据库；需要 schema 变更时另行设计兼容迁移与数据备份。

## 未完成实验与旧版本

Open TRPG 改写已保存成独立本地 Git 仓库：`/Users/xiejiaxue/developer/experiments/open-trpg-engine`，分支 `experiment/open-trpg`。原始改写快照为 `b0b5d16fc1853cf0560f790a895f5d64414838b7`（以该仓库 EXPERIMENT.md 的完整提交号为准），后续提交移除了生产路由。实验没有 Git remote，不会推送到公开正式仓库。其本地 secrets、状态、数据和截图保留在实验目录内，并被 Git 忽略。

完整清理前备份：`/Users/xiejiaxue/developer/_archives/dnd-cleanup-20261022`。三个 tar 包包含所有文件（包括未提交、未跟踪、忽略文件、依赖和本地状态），manifest.json 记录校验值；all-refs.bundle 保存清理前全部 Git 引用。备份目录仅本机用户可访问，包含本地凭据，不可上传公开仓库。

恢复时先在新目录解包，勿覆盖生产目录。独立查看 Git 历史可用 `git clone /path/to/all-refs.bundle recovery`。旧 worktree 的 .git 文件包含原路径，恢复为独立仓库时应从 bundle 建仓后复制所需工作文件，不能直接沿用该指针。

`archive/*` 历史分支保留。已合入 main 的临时分支在完成备份后清理。当前清理前正式版本有标签 `production/before-cleanup-20261022`，提交 `571f8ed515f93a79cc4e0c0122158807e2eaabe3`，Worker 版本 `e011730d-761a-4833-afdb-8b355755db61`。

## 回滚

正常回滚：在任务分支 revert 出问题的提交，运行检查，合入 main，由同一 Production 流程发布，保证代码与网站继续一致。不要强推 main。

紧急中断故障可由管理员在 Cloudflare 回滚到已验证 Worker 版本；之后必须立即用 Git revert 对齐 main，并完成新的统一发布。不要对带有不兼容数据库变化的版本盲目回滚。
