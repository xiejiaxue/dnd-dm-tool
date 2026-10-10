# 角色文件上传与下载协议 v1

## 用户流程

1. 在 `/characters` 新建角色，或使用「选择文件」/ 拖放上传角色文件。
2. 上传通过校验后展示名称、职业、等级、生命值及导出时间；用户确认后导入为独立角色。
3. 使用分区导航修改字段，当前草稿和选择状态自动保存在本浏览器。
4. 「下载角色文件」生成可重新上传的 `.dndcard.json`；「导出 PDF」生成阅读、打印用 PDF。

上传只在浏览器中读取与校验，不写入服务器，也不自动同步房间角色。PDF、截图及其他工具的文件不支持重新导入。页面提供空白模板与可下载 JSON Schema，避免将阅读文件误作可编辑数据。

## 文件协议

- MIME：`application/json`，UTF-8；允许 UTF-8 BOM。
- 扩展名：`.dndcard.json`，同时接受符合协议的 `.json`。
- 大小：不超过 1 MiB，每次一份。
- 顶层字段：`format: "dm-tracker-character"`、`version: 1`、`ruleset: "dnd5e-2014"`、ISO 日期 `exportedAt`、`character`。
- 机器规范：[character-file-v1.schema.json](../client/public/schemas/character-file-v1.schema.json)。线上路径：`/schemas/character-file-v1.schema.json`。
- 字段完整性与类型严格校验；拒绝未知字段、不支持的版本、字符串形式的数字、非整数和超界数值，不静默截断或丢弃上传的数据。
- 角色名称等短文本最多 160 个 UTF-16 代码单元；详细记录单项最多 30,000 个。JSON Schema 的 `maxLength` 按 Unicode 字符计数，浏览器导入的代码单元限制更严格。
- `hp <= maxHp` 为应用层交叉校验；JSON Schema 不能单独表达该约束。
- 导入生成新角色 ID，保留其他有效字段。最多保存 100 张本机角色卡；相同名称在选择列表中标注序号。
- 文件仅作为数据，不执行文本中的 HTML 或脚本。

## 实现边界

- `client/src/character-file.ts`：文件限制、严格解析、版本分派、序列化、下载及导入副本。
- `client/src/character-draft.ts`：角色领域字段与 PDF 映射。
- `client/src/components/CharacterWorkshop.tsx`：上传、拖放、导入预览、保存状态、下载及编辑导航。
- `client/src/character-pdf.ts`：中文 A4 PDF 阅读输出。
- `client/src/__tests__/character-file.test.ts`：往返保真、异常文件、字段边界、版本和独立身份测试。

未来新增文件结构时提升 `version`，提供显式迁移，保持旧版导入行为可测试。当前未知版本直接拒绝，不猜测字段映射。
