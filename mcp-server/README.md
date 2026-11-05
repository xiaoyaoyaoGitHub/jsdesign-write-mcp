# gy_jsdesign_mcp_bridge

> Fork of [nothing-sy/js.design](https://github.com/nothing-sy/js.design) (MIT).  
> Adds **write/create** capabilities on top of the original read-only MCP server — lets an Agent create Frames / Rectangles / Text / nested node trees directly on the js.design canvas, enabling the **HTML → editable design** direction the upstream does not support.

即时设计（[js.design](https://js.design)）MCP Server（读写增强版）：在原版导出能力之上，新增 `create_frame` / `create_rectangle` / `create_text` / `create_from_json` / `delete_node` 五个写入工具。

完整文档与原项目：https://github.com/nothing-sy/js.design

## 架构（未改动）

- **daemon**：WebSocket 桥，监听 `ws://127.0.0.1:3847`（`JSDESIGN_MCP_PORT` 可覆盖）。
- **stdio MCP（默认）**：Agent 拉起的 stdio 进程，作为 agent 接入已有 daemon。
- **即时设计插件**：跑在即时设计桌面端里，通过 WS 收发 RPC，真正调用 `jsDesign.*` Plugin API。

fork 主要改动 **插件端 `plugin/code.js`** 与 **server 端 `mcp-server/src/tools.ts`**；本轮另改了 `bridge.ts` 的过期 clientId 错误文案与插件面板版本号，daemon 架构本身未动。

## 工具清单（共 15 个）

### 只读（原版 10 个，保留）
`get_connection_status` · `get_document_info` · `list_pages` · `list_top_frames` · `export_selection` · `export_node` · `export_page` · `export_assets` · `get_design_tokens` · `get_node_css`

### 写入（fork 新增 5 个）

| 工具 | 参数 | 说明 |
|---|---|---|
| `create_frame` | `{ name?, x?, y?, width?, height?, fills?, strokes?, cornerRadius?, layoutMode?, ...parentId? }` | 创建 Frame（容器/画板） |
| `create_rectangle` | `{ name?, x?, y?, width?, height?, fills?, cornerRadius?, ...parentId? }` | 创建矩形（色块/底色） |
| `create_text` | `{ text, fontName?, fontSize?, color?, x?, y?, ...parentId? }` | 创建文字（自动 loadFontAsync） |
| `create_from_json` | `{ nodes: DesignNode[], parentId? }` | 递归创建节点树，支持 FRAME/RECTANGLE/TEXT/ELLIPSE/LINE + children 嵌套 |
| `delete_node` | `{ nodeId? \| name?, allTopLevel? }` | 按 id / 名称删除节点，或清空当前页顶层节点（破坏性操作） |

> `clientId` 为**必填**的工具共 8 个：`export_assets`、`get_design_tokens`、`get_node_css`、`create_frame`、`create_rectangle`、`create_text`、`create_from_json`、`delete_node`。先调 `get_connection_status` 拿到已连接文档列表，向用户确认目标文档后再传入，避免写错文件。

颜色参数统一支持 `#rrggbb` / `#rrggbbaa` / `#rgb` / `rgba(r,g,b,a)` / `{r,g,b}` / `{color}` / `{rgb}`（0-1 或 0-255 均可），`fills` / `strokes` / 文字 `color` / effect 颜色写法一致。

## 快速开始

### 1. 本地使用（已 fork 到 `~/Documents/项目/jsdesign-write-mcp/`）

无需 npm 发布，直接指向本地编译产物。编辑 ZCode 用户级 MCP 配置 `~/.zcode/cli/config.json`：

```json
{
  "mcp": {
    "servers": {
      "gy_jsdesign_mcp_bridge": {
        "type": "stdio",
        "command": "/Users/wangly/.nvm/versions/node/v20.19.6/bin/node",
        "args": [
          "/Users/wangly/Documents/项目/jsdesign-write-mcp/mcp-server/dist/index.js"
        ]
      }
    }
  }
}
```

Cursor / Claude Desktop 同理，改各自的 `mcp.json` 路径即可。

### 2. 导入即时设计插件（必须，每次新机器都要做）

即时设计桌面端 → **插件** → **开发者** → **导入插件** → 选择：

```
/Users/wangly/Documents/项目/jsdesign-write-mcp/plugin/manifest.json
```

> 注意：fork 版插件的 `id` 已改为 `wly_jsdesign_write_2026`，与原版 `JsDesign MCP Bridge` 不冲突，两者可共存。但同一时间只能运行一个连 3847 端口的插件——建议在插件管理里禁用原版，只保留 fork 版。

### 3. 构建（改了 `tools.ts` 或 `code.js` 后需要重新构建 server）

```bash
cd /Users/wangly/Documents/项目/jsdesign-write-mcp/mcp-server
npm install
npm run build   # tsc → dist/
```

插件端 `plugin/code.js` 是纯 JS，改完直接在即时设计里重新运行插件即可生效，无需构建。

### 4. 使用

1. 即时设计里打开插件面板，确认「已连接」
2. Agent 调 `create_frame` / `create_text` / `create_from_json` 等写入画布
3. 端到端：把 HTML 解析成 `DesignNode[]` 树，调 `create_from_json` 一次性导入

## HTML → 即时设计完整链路

```
HTML  ──解析──▶  DesignNode[] JSON  ──create_from_json──▶  即时设计画布（可编辑）
```

Agent 读 HTML，按 `DesignNode` schema 构造节点数组（FRAME 嵌 RECTANGLE/TEXT + children），调 `create_from_json` 递归落盘。

## License

MIT — fork 自 [nothing-sy/js.design](https://github.com/nothing-sy/js.design)，保留原作者版权声明。
