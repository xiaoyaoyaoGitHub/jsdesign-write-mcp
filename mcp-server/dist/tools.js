import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
/** Spill oversized export JSON to a temp file so Agent can Read the path. */
const LARGE_JSON_CHARS = 400_000;
function textResult(data) {
    const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    if (text.length > LARGE_JSON_CHARS) {
        const dir = join(tmpdir(), "gy_jsdesign_mcp_bridge");
        mkdirSync(dir, { recursive: true });
        const filePath = join(dir, `export-${Date.now()}.json`);
        writeFileSync(filePath, text, "utf8");
        const preview = text.slice(0, 4000);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        spilledToFile: true,
                        path: filePath,
                        bytes: Buffer.byteLength(text, "utf8"),
                        hint: "导出过大，已写入本地 JSON。请用 Read 工具读取 path 后继续写页面。",
                        preview,
                    }, null, 2),
                },
            ],
        };
    }
    return {
        content: [{ type: "text", text }],
    };
}
function errResult(err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
        content: [{ type: "text", text: `错误: ${message}` }],
        isError: true,
    };
}
function defaultAssetsDir() {
    return join(tmpdir(), "gy_jsdesign_mcp_bridge", "assets", String(Date.now()));
}
function resolveOutputDir(outputDir) {
    if (outputDir && outputDir.trim()) {
        return resolve(outputDir.trim());
    }
    return defaultAssetsDir();
}
function uniqueFilePath(dir, stem, ext, used) {
    let base = `${stem}.${ext}`;
    let n = 1;
    while (used.has(base.toLowerCase())) {
        base = `${stem}_${n}.${ext}`;
        n += 1;
    }
    used.add(base.toLowerCase());
    return join(dir, base);
}
/** Decode base64 payloads, write files, return path map + stripped asset list. */
function materializeAssets(assets, outputDir) {
    const dir = resolveOutputDir(outputDir);
    mkdirSync(dir, { recursive: true });
    const usedNames = new Set();
    const byImageHash = new Map();
    const byNodeId = new Map();
    const written = [];
    for (const asset of assets || []) {
        const { data, ...meta } = asset;
        if (!data || asset.error) {
            written.push({ ...meta, data: undefined });
            continue;
        }
        try {
            const buf = Buffer.from(data, "base64");
            const ext = (asset.ext || "png").replace(/^\./, "");
            const filePath = uniqueFilePath(dir, asset.name || asset.id, ext, usedNames);
            writeFileSync(filePath, buf);
            const item = {
                ...meta,
                bytes: buf.length,
                localPath: filePath,
                data: undefined,
            };
            written.push(item);
            if (asset.imageHash)
                byImageHash.set(asset.imageHash, filePath);
            if (asset.nodeId)
                byNodeId.set(asset.nodeId, filePath);
            if (Array.isArray(asset.nodeIds)) {
                for (const nid of asset.nodeIds)
                    byNodeId.set(nid, filePath);
            }
        }
        catch (e) {
            written.push({
                ...meta,
                data: undefined,
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }
    return { outputDir: dir, assets: written, byImageHash, byNodeId };
}
function patchNodeAssets(node, byImageHash, byNodeId) {
    const next = { ...node };
    if (Array.isArray(node.fills)) {
        next.fills = node.fills.map((f) => {
            if (f.type === "IMAGE" && f.imageHash && byImageHash.has(f.imageHash)) {
                return { ...f, localPath: byImageHash.get(f.imageHash) };
            }
            return f;
        });
    }
    if (byNodeId.has(node.id)) {
        next.assetPath = byNodeId.get(node.id);
    }
    if (Array.isArray(node.children)) {
        next.children = node.children.map((c) => patchNodeAssets(c, byImageHash, byNodeId));
    }
    return next;
}
function attachAssetsToExportResult(result, outputDir) {
    const rawAssets = result.assets;
    if (!rawAssets || !Array.isArray(rawAssets) || rawAssets.length === 0) {
        const { assets: _drop, ...rest } = result;
        return {
            ...rest,
            assets: [],
            assetsOutputDir: outputDir ? resolveOutputDir(outputDir) : undefined,
            hint: "未发现 IMAGE fill 或带 exportSettings 的切图层。可用 export_assets({ nodeIds }) 强制导出指定节点。",
        };
    }
    const material = materializeAssets(rawAssets, outputDir);
    const out = {
        ...result,
        assets: material.assets,
        assetsOutputDir: material.outputDir,
    };
    if (Array.isArray(result.nodes)) {
        out.nodes = result.nodes.map((n) => patchNodeAssets(n, material.byImageHash, material.byNodeId));
    }
    if (result.node && typeof result.node === "object") {
        out.node = patchNodeAssets(result.node, material.byImageHash, material.byNodeId);
    }
    if (Array.isArray(result.children)) {
        out.children = result.children.map((n) => patchNodeAssets(n, material.byImageHash, material.byNodeId));
    }
    return out;
}
const exportCommonShape = {
    maxDepth: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("最大递归深度，默认不限制（建议大画板设 20）"),
    skipHidden: z
        .boolean()
        .optional()
        .describe("是否跳过不可见节点，默认 true"),
    skipInstanceChildren: z
        .boolean()
        .optional()
        .describe("是否跳过组件实例内部子节点，默认 true"),
    includeAssets: z
        .boolean()
        .optional()
        .describe("为 true 时一并导出 IMAGE fill / exportSettings 切图到本地，并在 fills.localPath / assetPath 写入路径"),
    outputDir: z
        .string()
        .optional()
        .describe("切图输出目录（绝对路径或相对 cwd）。默认写入系统临时目录 gy_jsdesign_mcp_bridge/assets/<ts>/"),
    clientId: z.string().optional().describe("可选客户端 id"),
};
export function registerTools(server, bridge) {
    server.tool("get_connection_status", "检查即时设计 MCP 插件是否已连接，以及当前文档/页面信息。", async () => {
        const clients = await bridge.listClients();
        return textResult({
            connected: clients.length > 0,
            clientCount: clients.length,
            clients,
            hint: clients.length === 0
                ? "请在即时设计中打开「GY Design MCP Bridge」插件"
                : "插件已连接，可调用 export_selection / export_assets / export_node",
        });
    });
    server.tool("get_document_info", "获取当前打开设计文件与页面的基本信息。", {
        clientId: z
            .string()
            .optional()
            .describe("多文档时指定插件客户端 id；默认第一个在线客户端"),
    }, async ({ clientId }) => {
        try {
            const result = await bridge.call("get_document_info", {}, { clientId });
            return textResult(result);
        }
        catch (e) {
            return errResult(e);
        }
    });
    server.tool("list_pages", "列出设计文件中的所有页面（id / name）。", {
        clientId: z.string().optional().describe("可选客户端 id"),
    }, async ({ clientId }) => {
        try {
            const result = await bridge.call("list_pages", {}, { clientId });
            return textResult(result);
        }
        catch (e) {
            return errResult(e);
        }
    });
    server.tool("list_top_frames", "列出当前页顶层画板/Frame/组件，便于先选要做的那一屏再导出。", {
        clientId: z.string().optional().describe("可选客户端 id"),
    }, async ({ clientId }) => {
        try {
            const result = await bridge.call("list_top_frames", {}, { clientId });
            return textResult(result);
        }
        catch (e) {
            return errResult(e);
        }
    });
    server.tool("export_selection", "导出当前选中节点的完整子树（结构+布局+样式+文字）。设 includeAssets=true 可同时导出切图到本地。推荐：在即时设计中选中目标画板后调用。", exportCommonShape, async (args) => {
        try {
            const { clientId, includeAssets, outputDir, ...params } = args;
            const result = (await bridge.call("export_selection", { ...params, includeAssets: !!includeAssets }, {
                clientId,
                timeoutMs: includeAssets ? 180_000 : 120_000,
            }));
            if (includeAssets) {
                return textResult(attachAssetsToExportResult(result, outputDir));
            }
            return textResult(result);
        }
        catch (e) {
            return errResult(e);
        }
    });
    server.tool("export_node", "按 nodeId 或 name 导出节点完整子树。name 匹配时取第一个命中。可设 includeAssets 一并导出切图。", {
        nodeId: z.string().optional().describe("节点 id"),
        name: z.string().optional().describe("节点名称（精确匹配）"),
        ...exportCommonShape,
    }, async (args) => {
        try {
            if (!args.nodeId && !args.name) {
                return errResult(new Error("请提供 nodeId 或 name"));
            }
            const { clientId, includeAssets, outputDir, ...params } = args;
            const result = (await bridge.call("export_node", { ...params, includeAssets: !!includeAssets }, {
                clientId,
                timeoutMs: includeAssets ? 180_000 : 120_000,
            }));
            if (includeAssets) {
                return textResult(attachAssetsToExportResult(result, outputDir));
            }
            return textResult(result);
        }
        catch (e) {
            return errResult(e);
        }
    });
    server.tool("export_page", "导出当前页完整节点树。大页面慎用，建议配合 maxDepth / skipHidden。优先用 export_selection 导出单个画板。可设 includeAssets。", exportCommonShape, async (args) => {
        try {
            const { clientId, includeAssets, outputDir, ...params } = args;
            const result = (await bridge.call("export_page", { ...params, includeAssets: !!includeAssets }, {
                clientId,
                timeoutMs: includeAssets ? 240_000 : 180_000,
            }));
            if (includeAssets) {
                return textResult(attachAssetsToExportResult(result, outputDir));
            }
            return textResult(result);
        }
        catch (e) {
            return errResult(e);
        }
    });
    server.tool("export_assets", "导出选区（或指定节点）中的切图/图片资源到本地目录。收集 IMAGE fill（getImageByHash）与带 exportSettings 的节点（exportAsync）。返回 localPath 清单供写页面引用，不把 base64 回传给 Agent。", {
        nodeId: z.string().optional().describe("从该节点子树收集资源"),
        name: z.string().optional().describe("按名称定位根节点"),
        nodeIds: z
            .array(z.string())
            .optional()
            .describe("强制对这些节点做 exportAsync（复杂图标/切图层）"),
        outputDir: z
            .string()
            .optional()
            .describe("输出目录。默认 %TEMP%/gy_jsdesign_mcp_bridge/assets/<ts>/。写静态页时建议传项目 public/design-assets"),
        format: z
            .enum(["PNG", "JPG", "SVG"])
            .optional()
            .describe("节点 exportAsync 默认格式（有 exportSettings 时优先用设置）。默认 PNG"),
        scale: z
            .number()
            .positive()
            .optional()
            .describe("PNG/JPG 缩放倍数，默认 2"),
        maxAssets: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe("单次最多导出张数，默认 50"),
        skipHidden: z.boolean().optional(),
        skipInstanceChildren: z.boolean().optional(),
        clientId: z
            .string()
            .trim()
            .min(1, "clientId 不能为空；请先调用 get_connection_status 获取已连接文档列表")
            .describe("目标文档的客户端 id。必须先调 get_connection_status 获取已连接文档列表，向用户确认目标文档后再传入对应的 clientId，避免创建到错误文档。"),
    }, async (args) => {
        try {
            const { clientId, outputDir, ...params } = args;
            const result = (await bridge.call("export_assets", params, {
                clientId,
                timeoutMs: 180_000,
            }));
            const material = materializeAssets(result.assets, outputDir);
            return textResult({
                source: "assets",
                documentName: result.documentName,
                page: result.page,
                outputDir: material.outputDir,
                assets: material.assets,
                truncated: result.truncated,
                skipped: result.skipped,
                hint: result.hint ||
                    "请用 assets[].localPath 作为 img/src 或 CSS background-image；IMAGE fill 可通过 imageHash 与 export_selection 节点对应。",
            });
        }
        catch (e) {
            return errResult(e);
        }
    });
    server.tool("get_design_tokens", "从当前选区（或指定节点）提取颜色、字号、间距、圆角等设计令牌去重列表，便于写页面时统一 token。", {
        nodeId: z.string().optional().describe("可选：从该节点子树提取；默认当前选区"),
        name: z.string().optional().describe("可选：按名称定位节点"),
        clientId: z
            .string()
            .trim()
            .min(1, "clientId 不能为空；请先调用 get_connection_status 获取已连接文档列表")
            .describe("目标文档的客户端 id。必须先调 get_connection_status 获取已连接文档列表，向用户确认目标文档后再传入对应的 clientId，避免创建到错误文档。"),
    }, async (args) => {
        try {
            const { clientId, ...params } = args;
            const result = await bridge.call("get_design_tokens", params, {
                clientId,
                timeoutMs: 120_000,
            });
            return textResult(result);
        }
        catch (e) {
            return errResult(e);
        }
    });
    server.tool("get_node_css", "为单个节点生成近似 CSS 摘要（辅助参考；主交付仍是 export_* JSON）。", {
        nodeId: z.string().optional(),
        name: z.string().optional(),
        clientId: z
            .string()
            .trim()
            .min(1, "clientId 不能为空；请先调用 get_connection_status 获取已连接文档列表")
            .describe("目标文档的客户端 id。必须先调 get_connection_status 获取已连接文档列表，向用户确认目标文档后再传入对应的 clientId，避免创建到错误文档。"),
    }, async (args) => {
        try {
            if (!args.nodeId && !args.name) {
                return errResult(new Error("请提供 nodeId 或 name"));
            }
            const { clientId, ...params } = args;
            const result = await bridge.call("get_node_css", params, { clientId });
            return textResult(result);
        }
        catch (e) {
            return errResult(e);
        }
    });
    // ——— Write/Create tools (fork addition) ———
    const writeToolAnnotations = { destructiveHint: true };
    const nodeIdShape = {
        parentId: z
            .string()
            .optional()
            .describe("父节点 id；不传则挂到当前页（currentPage）顶层"),
        clientId: z
            .string()
            .trim()
            .min(1, "clientId 不能为空；请先调用 get_connection_status 获取已连接文档列表")
            .describe("目标文档的客户端 id。必须先调 get_connection_status 获取已连接文档列表，向用户确认目标文档后再传入对应的 clientId，避免创建到错误文档。"),
    };
    const paintShape = z
        .union([
        z.string().describe('颜色字符串，如 "#ff0000"、"rgba(0,0,0,0.5)"'),
        z.object({
            r: z.number().describe("红 0-1 或 0-255"),
            g: z.number(),
            b: z.number(),
        }),
    ])
        .optional();
    server.tool("create_frame", "在画布创建一个 Frame（可做容器）。可指定位置、尺寸、填充、圆角、auto-layout 等。默认 100×100，挂到当前页。", {
        name: z.string().optional().describe("节点名"),
        x: z.number().optional().describe("相对父节点 x 坐标"),
        y: z.number().optional().describe("相对父节点 y 坐标"),
        width: z.number().optional().describe("宽度，默认 100"),
        height: z.number().optional().describe("高度，默认 100"),
        fills: paintShape.describe("背景填充颜色"),
        strokes: paintShape.describe("描边颜色"),
        strokeWeight: z.number().optional(),
        cornerRadius: z.number().optional().describe("圆角半径"),
        opacity: z.number().min(0).max(1).optional(),
        rotation: z.number().optional(),
        visible: z.boolean().optional(),
        layoutMode: z
            .enum(["NONE", "HORIZONTAL", "VERTICAL"])
            .optional()
            .describe("auto-layout 方向"),
        itemSpacing: z.number().optional().describe("auto-layout 子项间距"),
        paddingTop: z.number().optional(),
        paddingRight: z.number().optional(),
        paddingBottom: z.number().optional(),
        paddingLeft: z.number().optional(),
        primaryAxisAlignItems: z
            .enum(["MIN", "CENTER", "MAX", "SPACE_BETWEEN"])
            .optional(),
        counterAxisAlignItems: z.enum(["MIN", "CENTER", "MAX"]).optional(),
        ...nodeIdShape,
    }, writeToolAnnotations, async (args) => {
        try {
            const { clientId, ...params } = args;
            const result = await bridge.call("create_frame", params, {
                clientId,
                timeoutMs: 30_000,
            });
            return textResult(result);
        }
        catch (e) {
            return errResult(e);
        }
    });
    server.tool("create_rectangle", "在画布创建一个矩形（色块/底色）。可指定位置、尺寸、填充、圆角等。默认 100×100。", {
        name: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        fills: paintShape.describe("填充颜色"),
        strokes: paintShape.describe("描边颜色"),
        strokeWeight: z.number().optional(),
        cornerRadius: z.number().optional(),
        opacity: z.number().min(0).max(1).optional(),
        rotation: z.number().optional(),
        visible: z.boolean().optional(),
        ...nodeIdShape,
    }, writeToolAnnotations, async (args) => {
        try {
            const { clientId, ...params } = args;
            const result = await bridge.call("create_rectangle", params, {
                clientId,
                timeoutMs: 30_000,
            });
            return textResult(result);
        }
        catch (e) {
            return errResult(e);
        }
    });
    server.tool("create_text", "在画布创建一段文字。必须提供 text 参数。默认字体 Inter Regular；fontNode 可指定其他字体（需先 loadFontAsync）。", {
        text: z.string().describe("文字内容"),
        name: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        fontSize: z.number().positive().optional().describe("字号，默认由字体决定"),
        fontName: z
            .object({
            family: z.string(),
            style: z.string(),
        })
            .optional()
            .describe('如 { family: "Inter", style: "Bold" }'),
        color: paintShape.describe("文字颜色"),
        textAlignHorizontal: z
            .enum(["LEFT", "CENTER", "RIGHT", "JUSTIFIED"])
            .optional(),
        lineHeight: z
            .union([z.object({ value: z.number(), unit: z.string() }), z.string()])
            .optional(),
        opacity: z.number().min(0).max(1).optional(),
        rotation: z.number().optional(),
        visible: z.boolean().optional(),
        ...nodeIdShape,
    }, writeToolAnnotations, async (args) => {
        try {
            const { clientId, ...params } = args;
            const result = await bridge.call("create_text", params, {
                clientId,
                timeoutMs: 60_000,
            });
            return textResult(result);
        }
        catch (e) {
            return errResult(e);
        }
    });
    server.tool("create_from_json", "按 JSON 节点树递归创建可编辑设计稿。每个节点 { type: FRAME|RECTANGLE|TEXT|ELLIPSE|LINE, name, x, y, width, height, fills, characters, fontSize, children: [...] }。用于把 HTML 解析结果或结构化设计数据一次性写入画布。", {
        nodes: z
            .array(z.record(z.string(), z.unknown()))
            .min(1)
            .describe("节点规格数组，每项是一个 DesignNode-like 对象"),
        parentId: z
            .string()
            .optional()
            .describe("父节点 id；不传则挂到当前页顶层"),
        clientId: z
            .string()
            .trim()
            .min(1, "clientId 不能为空；请先调用 get_connection_status 获取已连接文档列表")
            .describe("目标文档的客户端 id。必须先调 get_connection_status 获取已连接文档列表，向用户确认目标文档后再传入对应的 clientId，避免创建到错误文档。"),
    }, writeToolAnnotations, async (args) => {
        try {
            const { clientId, ...params } = args;
            const result = await bridge.call("create_from_json", params, {
                clientId,
                timeoutMs: 180_000,
            });
            return textResult(result);
        }
        catch (e) {
            return errResult(e);
        }
    });
    server.tool("delete_node", "删除画布上的节点。可按 nodeId 删除单个/多个，按 name 删除所有匹配节点，或 allTopLevel=true 清空当前页顶层节点。谨慎使用。", {
        nodeId: z
            .union([z.string(), z.array(z.string())])
            .optional()
            .describe("要删除的节点 id（单个或数组）"),
        name: z
            .union([z.string(), z.array(z.string())])
            .optional()
            .describe("按名称删除所有匹配节点（单个或数组）"),
        allTopLevel: z
            .boolean()
            .optional()
            .describe("为 true 时删除当前页所有顶层节点（清空画板）"),
        clientId: z
            .string()
            .trim()
            .min(1, "clientId 不能为空；请先调用 get_connection_status 获取已连接文档列表")
            .describe("目标文档的客户端 id。必须先调 get_connection_status 获取已连接文档列表，向用户确认目标文档后再传入对应的 clientId，避免创建到错误文档。"),
    }, writeToolAnnotations, async (args) => {
        try {
            const { clientId, ...params } = args;
            // 破坏性操作：必须在工具层先拦住「什么都没指定」的调用，避免静默空转
            if (!params.nodeId && !params.name && params.allTopLevel !== true) {
                return errResult(new Error("delete_node 需要至少提供 nodeId / name / allTopLevel 之一"));
            }
            if (params.allTopLevel === true && (params.nodeId || params.name)) {
                return errResult(new Error("allTopLevel 不能与 nodeId / name 同时使用"));
            }
            const result = await bridge.call("delete_node", params, {
                clientId,
                timeoutMs: 30_000,
            });
            return textResult(result);
        }
        catch (e) {
            return errResult(e);
        }
    });
}
