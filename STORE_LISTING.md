# GY Design MCP Bridge — 插件广场文案

> 名称：`GY Design MCP Bridge`
> 定位：即时设计 ⇄ AI 客户端的双向桥接（设计稿导出 + 节点写回画布）
> 适用端：即时设计**桌面端**（插件依赖本机 WebSocket，网页端不可用）

---

## 一、一句话简介（列表卡片，≤ 40 字）

把即时设计画布接进 AI：设计稿导出给 Agent 写页面，也能把 AI 生成的节点直接画回画布。

备选（更短）：

- 让 Cursor / Claude 直接读你的设计稿，还能自己建画板。
- 即时设计 × MCP：设计稿 ⇄ 代码，双向打通。

---

## 二、详细介绍（详情页正文，可直接粘贴）

本插件通过 MCP（Model Context Protocol）把即时设计桌面端与 Cursor、Claude 等 AI 客户端打通，让 AI 能真正"看见"你的画布，也能把结果"画回来"。

装上并运行插件后，它会与你在本机运行的 MCP 服务建立一条独立的本地 WebSocket 通道（默认 `ws://127.0.0.1:3847`）。AI 客户端通过 MCP 调用工具，工具再经这条通道读取或创建画布节点——整个过程只在本机回环地址内完成，设计稿不会上传到任何服务器。

**设计稿 → 代码**：把选中的画板导出为结构化的节点树（含尺寸、布局、颜色、字号、圆角、文本内容），必要时连带切图，让 Agent 按你项目的技术栈直接写出页面，而不是靠截图"猜"。

**HTML / AI 生成 → 可编辑设计**：Agent 可以把一段结构化的节点 JSON 一次性写回画布，递归生成 Frame、矩形、文字、椭圆、直线及嵌套子节点，产出的是可继续编辑的图层，不是一张图。

适合设计师与前端协作的"设计稿还原"环节，也适合把 AI 生成的页面草稿快速落成可视化底稿。

---

## 三、功能特性

### 读取与导出（10 个工具）

| 工具 | 作用 |
|---|---|
| `get_connection_status` | 检查插件是否在线 |
| `get_document_info` | 当前文件 / 页面信息 |
| `list_pages` | 列出所有页面 |
| `list_top_frames` | 列出顶层画板 |
| `export_selection` | 导出当前选区（可含切图） |
| `export_node` | 按 id / name 导出指定节点 |
| `export_page` | 导出整页 |
| `export_assets` | 批量切图并落盘 |
| `get_design_tokens` | 汇总颜色 / 字号 / 间距 / 圆角 |
| `get_node_css` | 输出节点的 CSS 描述 |

### 写入画布（5 个工具）

| 工具 | 作用 |
|---|---|
| `create_frame` | 创建画板 / 容器 |
| `create_rectangle` | 创建矩形（色块、底色、分割线） |
| `create_text` | 创建文字（自动加载字体） |
| `create_from_json` | 递归创建整棵节点树（Frame / 矩形 / 文字 / 椭圆 / 直线 + 子节点） |
| `delete_node` | 按 id / 名称删除节点，或清空当前页顶层节点（破坏性操作，需先确认目标文档） |

颜色参数支持 `#rrggbb`、`#rrggbbaa`、`#rgb`、`rgba(r,g,b,a)`、`{r,g,b}`、`{color}`、`{rgb}`（0–1 或 0–255 均可）。节点还支持 `effects`（投影 / 内阴影 / 模糊）、`layoutMode` 自动布局等属性。

> 以下 8 个工具**必须**传 `clientId`：`export_assets`、`get_design_tokens`、`get_node_css`、`create_frame`、`create_rectangle`、`create_text`、`create_from_json`、`delete_node`。先调 `get_connection_status` 拿到已连接文档列表，向用户确认目标文档后再调用，避免误改到别的文件。

> `delete_node` 是破坏性操作：必须指定 `nodeId` / `name` / `allTopLevel` 之一（不能同时用 `allTopLevel` 与另外两者），按名称只在**当前页**匹配，页面 / 文档根 / 组件 / 锁定节点一律拒绝删除。

---

## 四、使用前须知（重要，请务必阅读）

**本插件是"本地桥接器"，单独安装无法工作。**

它只负责在即时设计与 MCP 服务之间转发 RPC，本身不含 AI 能力。你需要同时具备：

1. 即时设计**桌面端**（网页版没有插件运行环境）
2. 本机 **Node.js 18+**
3. 与插件配套的 **MCP 服务**（`gy_jsdesign_mcp_bridge`），并已在 AI 客户端里配置、且处于运行状态

三者缺一，插件面板会一直显示**「未连接」**——这是正常现象，按下方步骤补齐即可。

---

## 五、使用说明

### 第 1 步：安装 MCP 服务

**方式 A：npx 直接运行（推荐，免安装）**

```bash
npx github:xiaoyaoyaoGitHub/jsdesign-write-mcp daemon
```

**方式 B：全局安装**

```bash
npm i -g github:xiaoyaoyaoGitHub/jsdesign-write-mcp
```

安装完成后可直接使用命令 `gy_jsdesign_mcp_bridge`。仓库内已包含构建产物 `mcp-server/dist/`，从 git 安装不需要再编译。

### 第 2 步：在 AI 客户端里配置 MCP

以 Cursor 为例，编辑 `~/.cursor/mcp.json`（Windows：`%USERPROFILE%\.cursor\mcp.json`）：

```json
{
  "mcpServers": {
    "jsdesign": {
      "command": "npx",
      "args": ["github:xiaoyaoyaoGitHub/jsdesign-write-mcp"]
    }
  }
}
```

已全局安装的话，`command` 换成 `gy_jsdesign_mcp_bridge` 并去掉 `args`，启动更快。

保存后在 **Cursor → Settings → MCP** 里确认 `jsdesign` 为**绿灯**。首次启用会自动拉起本机桥接服务。

### 第 3 步：确认桥接服务在监听

默认端口 `3847`，与 Cursor 的 MCP 进程相互独立，关闭 Cursor 不会立刻断开。手动预热（**前台常驻进程，需保持该终端窗口不关**）：

```bash
gy_jsdesign_mcp_bridge daemon
# 未全局安装时：npx github:xiaoyaoyaoGitHub/jsdesign-write-mcp daemon
```

> 一般无需手动执行：AI 客户端启用 MCP 时会自动拉起 daemon。
> Windows 若在 `mcp.json` 里写 `"command": "gy_jsdesign_mcp_bridge"` 提示找不到命令，改写成 `gy_jsdesign_mcp_bridge.cmd`，或用 `"command": "npx"` 形式。

- 改端口：设置环境变量 `JSDESIGN_MCP_PORT`（例如 `3848`），并把插件面板里的地址同步改掉
- 空闲退出：当 AI 客户端与插件**都已断开**并持续 15 分钟后，服务自动退出（`JSDESIGN_MCP_IDLE_MS` 可覆盖，设 `0` 禁用）

### 第 4 步：安装并运行本插件

在即时设计桌面端安装本插件 → **运行**。面板会显示：

- 状态：**已连接**（绿点）+ WebSocket 地址
- 地址可改（换过端口时在这里同步）
- **重新连接**按钮用于断线重连

> 使用期间请**保持面板打开**。面板关闭 = 桥接断开。

### 第 5 步：开始使用

**导出设计稿让 AI 写页面**

1. 在画布上选中目标画板（整屏 Frame）
2. 在 Cursor 里对 Agent 说：

```text
按当前选中的即时设计画板，结合我项目的技术栈和风格实现这个页面
```

**让 AI 把内容画回画布**

```text
用 create_from_json 在当前页面创建一个 375×812 的移动端页面：
顶部导航栏 + 商品卡片列表 + 底部标签栏
```

常用工具组合：先 `get_connection_status` 确认在线，再 `export_selection` 取数据；写回时用 `create_frame` 打底、`create_from_json` 一次性铺树。

### 第 6 步：常见问题

| 现象 | 处理 |
|---|---|
| 面板一直「未连接」 | 确认第 1–3 步已完成；确认 `3847` 端口有服务在跑；点「重新连接」 |
| MCP 显示红灯 | 检查 `mcp.json` 语法；确认 `gy_jsdesign_mcp_bridge` 命令可用 |
| 提示无选中节点 | 先在画布上选中一个 Frame |
| 端口被占用 | 结束后台旧进程，或用 `JSDESIGN_MCP_PORT` 换端口并在面板同步 |
| 关闭 Cursor 后插件还连着 | 正常设计：服务独立运行，空闲 15 分钟才退出 |

---

## 六、隐私说明

- 插件只与**本机回环地址**（`127.0.0.1`）上的服务通信，**不访问外网**，不收集、不上传任何设计数据
- 导出内容仅返回给你本机运行的 AI 客户端
- 写入操作只作用于当前打开的设计文件，且由你主动触发

---

## 七、适用场景

- 设计稿还原：把画板交给 Agent 直接产出页面代码
- 设计系统盘点：一键汇总颜色、字号、间距、圆角
- AI 生成落地：把 AI 产出的结构快速变成可编辑图层
- 批量切图：按规则导出资源并落盘到项目目录

---

## 八、标签（Tags）

`MCP` `AI` `设计稿转代码` `Cursor` `Claude` `设计稿导出` `切图` `即时设计插件` `设计系统`
