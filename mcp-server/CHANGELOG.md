# Changelog

本文件记录 [`jsdesign-mcp-server`](https://www.npmjs.com/package/jsdesign-mcp-server) 的版本变更。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [2.2.0] - 2026-11-05

### Added

- 新增 `delete_node` 工具：按 `nodeId`（单个 / 数组）、`name`（单个 / 数组）删除节点，或 `allTopLevel=true` 清空当前页顶层节点；插件侧同步实现 `delete_node` RPC
- 插件：节点属性支持 `effects`（投影 / 内阴影 / 模糊），带类型白名单与容错，单个 effect 解析失败不再中断整棵节点树
- 插件：`fills` 归一化，兼容 `#rrggbb` / `#rrggbbaa` / `rgba(r,g,b,a)` / `{r,g,b}` / `{color}` / `{rgb}` 及它们组成的数组
- 插件：文字节点字体加载增加兜底（失败时回退 `Inter Regular`），填充统一交由 `applyNodeProps` 处理
- 插件：`strokes`、文字 `color` 与 effect 颜色统一支持 `#hex` / `#rrggbbaa` / `rgba(...)` / `{r,g,b}` / `{color}` / `{rgb}`，alpha 不再被丢弃

### Fixed

- 修复 `fills` 传裸对象（如 `{r,g,b}`）时被静默忽略、以及 `{rgb}` / `{color}` 形态被当成纯黑的问题
- 修复 `clamp01` 对越界值（>255、NaN）不夹紧导致写入非法颜色通道的问题
- 修复 `delete_node` 缺参数时静默空转、按 `name` 会跨页删除、以及可能误删页面 / 根节点的问题
- 修复传过期 `clientId` 时错误文案误报「插件未连接」的问题

### Changed

- `export_assets`、`get_design_tokens`、`get_node_css`、`create_frame`、`create_rectangle`、`create_text`、`create_from_json`、`delete_node` 的 `clientId` 改为**必填**（空串会被拒绝），工具描述要求先调 `get_connection_status` 并向用户确认目标文档，避免写错文档
- 版本号统一为 `2.2.0`：根 `package.json`、`mcp-server/package.json`、`manifest.version`、MCP 自报版本、插件面板展示

## [2.0.0] - 2026-08-07

### Changed

- 主版本号统一为 `2.0.0`：`jsdesign-mcp-server`、根 `package.json`、插件 `manifest.version` / `manifest.api`、MCP 自报版本
- 插件面板展示 `v2.0.0`
- 文档安装命令改为 `npm i -g jsdesign-mcp-server@2.0.0`

### Notes

- 包含 `0.2.x` 的 daemon 架构与空闲自动退出（`JSDESIGN_MCP_IDLE_MS`，默认 15 分钟）

## [0.2.1] - 2026-08-07

### Added

- Daemon 在 **没有任何 WebSocket 客户端**（Cursor MCP agent 与即时设计插件均断开）持续 **15 分钟**后自动退出，减少孤儿进程与端口占用困惑
- 环境变量 `JSDESIGN_MCP_IDLE_MS`：覆盖空闲时长（毫秒）；设为 `0` 可禁用自动退出

### Changed

- 文档说明由「永久常驻」调整为「有连接时保活，全部断开后空闲退出；下次启用 MCP 会再自动拉起」

## [0.2.0] - 2026-08-07

### Added

- 独立常驻 WebSocket daemon（默认 `ws://127.0.0.1:3847`），与 Cursor MCP stdio 进程分离
- MCP 进程作为 agent 接入 daemon；daemon 未运行时自动 detached 拉起
- Agent RPC（`list_clients` 等）与 `JSDESIGN_MCP_PORT` 端口配置
- 参考 Skill（`skills/jsdesign`）与端到端使用文档
- 本地 `.npm-token` 发布脚本（`npm run release`）

### Changed

- Bridge 支持 `plugin` / `agent` 双角色连接

## [0.1.0] - 2026-08-06

### Added

- 初版即时设计 MCP Bridge：插件 WebSocket ↔ MCP 工具
- 导出工具：`export_selection` / `export_node` / `export_page` / `export_assets` 等
- `get_connection_status`、`get_document_info`、`list_pages`、`list_top_frames`、`get_design_tokens`、`get_node_css`
