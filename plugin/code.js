/**
 * GY Design MCP Bridge — main thread (sandbox)
 * Fork of nothing-sy/js.design (MIT). Adds write/create methods.
 */

/* global jsDesign */

const DEFAULTS = {
  skipHidden: true,
  skipInstanceChildren: true,
  maxDepth: 40,
  maxAssets: 50,
  exportScale: 2,
};

jsDesign.showUI(__html__, { width: 320, height: 220 });

jsDesign.ui.onmessage = async (msg) => {
  if (!msg || typeof msg !== "object") return;
  const { id, method, params } = msg;
  if (!id || !method) return;

  try {
    const result = await handleMethod(method, params || {});
    jsDesign.ui.postMessage({ type: "rpc-result", id, ok: true, result });
  } catch (err) {
    jsDesign.ui.postMessage({
      type: "rpc-result",
      id,
      ok: false,
      error: err && err.message ? err.message : String(err),
    });
  }
};

// Notify UI of document context for hello handshake
jsDesign.ui.postMessage({
  type: "doc-info",
  documentName: jsDesign.root && jsDesign.root.name,
  pageName: jsDesign.currentPage && jsDesign.currentPage.name,
});

async function handleMethod(method, params) {
  switch (method) {
    case "get_document_info":
      return getDocumentInfo();
    case "list_pages":
      return listPages();
    case "list_top_frames":
      return listTopFrames();
    case "export_selection":
      return exportSelection(params);
    case "export_node":
      return exportNode(params);
    case "export_page":
      return exportPage(params);
    case "export_assets":
      return exportAssets(params);
    case "get_design_tokens":
      return getDesignTokens(params);
    case "get_node_css":
      return getNodeCss(params);
    case "create_frame":
      return createFrameNode(params);
    case "create_rectangle":
      return createRectangleNode(params);
    case "create_text":
      return createTextNode(params);
    case "create_from_json":
      return createFromJson(params);
    case "ping":
      return { pong: true, at: Date.now() };
    default:
      throw new Error("未知方法: " + method);
  }
}

function getDocumentInfo() {
  return {
    documentName: jsDesign.root.name,
    documentId: jsDesign.root.id,
    currentPage: {
      id: jsDesign.currentPage.id,
      name: jsDesign.currentPage.name,
    },
    selectionCount: jsDesign.currentPage.selection.length,
  };
}

function listPages() {
  const pages = [];
  for (const page of jsDesign.root.children || []) {
    if (page.type === "PAGE") {
      pages.push({ id: page.id, name: page.name });
    }
  }
  return { pages, currentPageId: jsDesign.currentPage.id };
}

function listTopFrames() {
  const frames = [];
  for (const child of jsDesign.currentPage.children || []) {
    frames.push({
      id: child.id,
      name: child.name,
      type: child.type,
      width: "width" in child ? child.width : undefined,
      height: "height" in child ? child.height : undefined,
    });
  }
  return { pageId: jsDesign.currentPage.id, pageName: jsDesign.currentPage.name, frames };
}

function resolveOptions(params) {
  return {
    maxDepth:
      typeof params.maxDepth === "number" ? params.maxDepth : DEFAULTS.maxDepth,
    skipHidden:
      typeof params.skipHidden === "boolean"
        ? params.skipHidden
        : DEFAULTS.skipHidden,
    skipInstanceChildren:
      typeof params.skipInstanceChildren === "boolean"
        ? params.skipInstanceChildren
        : DEFAULTS.skipInstanceChildren,
  };
}

function applyTraverseFlags(opts) {
  try {
    if (opts.skipInstanceChildren) {
      jsDesign.skipInvisibleInstanceChildren = true;
    }
  } catch (_) {
    /* older API */
  }
}

async function exportSelection(params) {
  const selection = jsDesign.currentPage.selection;
  if (!selection || selection.length === 0) {
    throw new Error("当前没有选中节点。请在即时设计中选中目标画板/图层后再导出。");
  }
  const opts = resolveOptions(params);
  applyTraverseFlags(opts);
  const nodes = selection.map((n) => serializeNode(n, 0, opts));
  const result = {
    source: "selection",
    documentName: jsDesign.root.name,
    page: { id: jsDesign.currentPage.id, name: jsDesign.currentPage.name },
    nodes,
  };
  if (params.includeAssets) {
    const assetsResult = await collectAndExportAssets([...selection], params);
    result.assets = assetsResult.assets;
    if (assetsResult.truncated) result.assetsTruncated = true;
  }
  return result;
}

function findNodeByIdOrName(nodeId, name) {
  if (nodeId) {
    const byId = jsDesign.getNodeById(nodeId);
    if (byId) return byId;
  }
  if (name) {
    const found = jsDesign.currentPage.findOne((n) => n.name === name);
    if (found) return found;
  }
  return null;
}

async function exportNode(params) {
  const node = findNodeByIdOrName(params.nodeId, params.name);
  if (!node) {
    throw new Error(
      "未找到节点" +
        (params.nodeId ? " id=" + params.nodeId : "") +
        (params.name ? " name=" + params.name : ""),
    );
  }
  const opts = resolveOptions(params);
  applyTraverseFlags(opts);
  const result = {
    source: "node",
    documentName: jsDesign.root.name,
    page: { id: jsDesign.currentPage.id, name: jsDesign.currentPage.name },
    node: serializeNode(node, 0, opts),
  };
  if (params.includeAssets) {
    const assetsResult = await collectAndExportAssets([node], params);
    result.assets = assetsResult.assets;
    if (assetsResult.truncated) result.assetsTruncated = true;
  }
  return result;
}

async function exportPage(params) {
  const opts = resolveOptions(params);
  applyTraverseFlags(opts);
  const page = jsDesign.currentPage;
  const children = [];
  const roots = [];
  for (const child of page.children || []) {
    if (opts.skipHidden && "visible" in child && child.visible === false) continue;
    roots.push(child);
    children.push(serializeNode(child, 0, opts));
  }
  const result = {
    source: "page",
    documentName: jsDesign.root.name,
    page: { id: page.id, name: page.name },
    children,
  };
  if (params.includeAssets) {
    const assetsResult = await collectAndExportAssets(roots, params);
    result.assets = assetsResult.assets;
    if (assetsResult.truncated) result.assetsTruncated = true;
  }
  return result;
}

/**
 * Export image fills + exportSettings nodes (+ optional forced nodeIds) as base64 payloads.
 * MCP server writes files and returns local paths to the Agent.
 */
async function exportAssets(params) {
  const roots = resolveAssetRoots(params);
  if (!roots.length) {
    throw new Error("没有可导出资源的节点。请选中画板，或传入 nodeId / name / nodeIds。");
  }
  const collected = await collectAndExportAssets(roots, params);
  return {
    source: "assets",
    documentName: jsDesign.root.name,
    page: { id: jsDesign.currentPage.id, name: jsDesign.currentPage.name },
    assets: collected.assets,
    truncated: collected.truncated,
    skipped: collected.skipped,
    hint: collected.truncated
      ? "资源数量超过上限，已截断。可缩小选区或提高 maxAssets 后重试。"
      : undefined,
  };
}

function resolveAssetRoots(params) {
  if (Array.isArray(params.nodeIds) && params.nodeIds.length > 0) {
    const roots = [];
    for (const id of params.nodeIds) {
      const n = jsDesign.getNodeById(id);
      if (n) roots.push(n);
    }
    if (roots.length) return roots;
  }
  if (params.nodeId || params.name) {
    const node = findNodeByIdOrName(params.nodeId, params.name);
    if (node) return [node];
  }
  const selection = jsDesign.currentPage.selection;
  if (selection && selection.length > 0) return [...selection];
  return [];
}

async function collectAndExportAssets(roots, params) {
  const maxAssets =
    typeof params.maxAssets === "number" && params.maxAssets > 0
      ? Math.min(params.maxAssets, 100)
      : DEFAULTS.maxAssets;
  const scale =
    typeof params.scale === "number" && params.scale > 0 ? params.scale : DEFAULTS.exportScale;
  const format = (params.format || "PNG").toUpperCase();
  const skipHidden =
    typeof params.skipHidden === "boolean" ? params.skipHidden : DEFAULTS.skipHidden;
  const skipInstanceChildren =
    typeof params.skipInstanceChildren === "boolean"
      ? params.skipInstanceChildren
      : DEFAULTS.skipInstanceChildren;

  const imageFills = new Map(); // hash -> { hash, nodeIds, names, width, height }
  const exportNodes = new Map(); // nodeId -> node

  function walk(node, depth) {
    if (!node) return;
    if (skipHidden && "visible" in node && node.visible === false) return;

    if ("fills" in node && node.fills !== jsDesign.mixed && Array.isArray(node.fills)) {
      for (const fill of node.fills) {
        if (fill && fill.type === "IMAGE" && fill.imageHash && fill.visible !== false) {
          const hash = fill.imageHash;
          let entry = imageFills.get(hash);
          if (!entry) {
            entry = {
              hash,
              nodeIds: [],
              names: [],
              width: "width" in node ? node.width : undefined,
              height: "height" in node ? node.height : undefined,
            };
            imageFills.set(hash, entry);
          }
          if (entry.nodeIds.indexOf(node.id) === -1) entry.nodeIds.push(node.id);
          if (entry.names.indexOf(node.name) === -1) entry.names.push(node.name);
        }
      }
    }

    if (
      "exportSettings" in node &&
      Array.isArray(node.exportSettings) &&
      node.exportSettings.length > 0
    ) {
      exportNodes.set(node.id, node);
    }

    if ("children" in node && Array.isArray(node.children)) {
      if (skipInstanceChildren && node.type === "INSTANCE") return;
      for (const child of node.children) walk(child, depth + 1);
    }
  }

  for (const root of roots) walk(root, 0);

  // Forced nodeIds always get exportAsync even without exportSettings
  if (Array.isArray(params.nodeIds)) {
    for (const id of params.nodeIds) {
      const n = jsDesign.getNodeById(id);
      if (n) exportNodes.set(n.id, n);
    }
  }

  const assets = [];
  let skipped = 0;
  let truncated = false;

  // 1) IMAGE fills via getImageByHash
  for (const entry of imageFills.values()) {
    if (assets.length >= maxAssets) {
      truncated = true;
      skipped += 1;
      continue;
    }
    try {
      const image = jsDesign.getImageByHash(entry.hash);
      if (!image || typeof image.getBytesAsync !== "function") {
        assets.push({
          id: "img-" + entry.hash.slice(0, 12),
          kind: "image-fill",
          name: sanitizeFileName(entry.names[0] || "image"),
          format: "PNG",
          ext: "png",
          imageHash: entry.hash,
          nodeIds: entry.nodeIds,
          width: entry.width,
          height: entry.height,
          data: "",
          error: "getImageByHash 不可用或返回空",
        });
        continue;
      }
      const bytes = await image.getBytesAsync();
      const detected = detectImageFormat(bytes);
      assets.push({
        id: "img-" + entry.hash.slice(0, 16),
        kind: "image-fill",
        name: sanitizeFileName(entry.names[0] || "image"),
        format: detected.format,
        ext: detected.ext,
        imageHash: entry.hash,
        nodeIds: entry.nodeIds,
        width: entry.width,
        height: entry.height,
        data: uint8ToBase64(bytes),
        bytes: bytes.length,
      });
    } catch (err) {
      assets.push({
        id: "img-" + entry.hash.slice(0, 12),
        kind: "image-fill",
        name: sanitizeFileName(entry.names[0] || "image"),
        format: "PNG",
        ext: "png",
        imageHash: entry.hash,
        nodeIds: entry.nodeIds,
        data: "",
        error: err && err.message ? err.message : String(err),
      });
    }
  }

  // 2) Nodes with exportSettings (or forced nodeIds)
  for (const node of exportNodes.values()) {
    if (assets.length >= maxAssets) {
      truncated = true;
      skipped += 1;
      continue;
    }
    // Skip if this node only has IMAGE fill already exported and no exportSettings
    // (forced nodeIds still export)
    try {
      const settings = pickExportSettings(node, format, scale);
      if (typeof node.exportAsync !== "function") {
        assets.push({
          id: "node-" + node.id.replace(/:/g, "_"),
          kind: "node-export",
          name: sanitizeFileName(node.name || "node"),
          format: settings.format,
          ext: formatToExt(settings.format),
          nodeId: node.id,
          nodeIds: [node.id],
          width: "width" in node ? node.width : undefined,
          height: "height" in node ? node.height : undefined,
          data: "",
          error: "exportAsync 不可用",
        });
        continue;
      }
      const bytesOrString = await node.exportAsync(settings);
      let data;
      let byteLen;
      let ext = formatToExt(settings.format);
      let outFormat = settings.format;
      if (typeof bytesOrString === "string") {
        // SVG_STRING
        data = utf8ToBase64(bytesOrString);
        byteLen = bytesOrString.length;
        ext = "svg";
        outFormat = "SVG";
      } else {
        data = uint8ToBase64(bytesOrString);
        byteLen = bytesOrString.length;
        const detected = detectImageFormat(bytesOrString);
        if (detected.ext !== "bin") {
          ext = detected.ext;
          outFormat = detected.format;
        }
      }
      assets.push({
        id: "node-" + node.id.replace(/:/g, "_"),
        kind: "node-export",
        name: sanitizeFileName(node.name || "node"),
        format: outFormat,
        ext,
        nodeId: node.id,
        nodeIds: [node.id],
        width: "width" in node ? node.width : undefined,
        height: "height" in node ? node.height : undefined,
        data,
        bytes: byteLen,
      });
    } catch (err) {
      assets.push({
        id: "node-" + node.id.replace(/:/g, "_"),
        kind: "node-export",
        name: sanitizeFileName(node.name || "node"),
        format: format,
        ext: formatToExt(format),
        nodeId: node.id,
        nodeIds: [node.id],
        data: "",
        error: err && err.message ? err.message : String(err),
      });
    }
  }

  return { assets, truncated, skipped };
}

function pickExportSettings(node, fallbackFormat, scale) {
  const settings = node.exportSettings && node.exportSettings[0];
  if (settings && settings.format) {
    const fmt = String(settings.format).toUpperCase();
    if (fmt === "SVG") {
      return { format: "SVG_STRING" };
    }
    const constraint =
      settings.constraint ||
      (fmt === "PNG" || fmt === "JPG" ? { type: "SCALE", value: scale } : undefined);
    return constraint ? { format: fmt, constraint } : { format: fmt };
  }
  if (fallbackFormat === "SVG") {
    return { format: "SVG_STRING" };
  }
  return {
    format: fallbackFormat === "JPG" ? "JPG" : "PNG",
    constraint: { type: "SCALE", value: scale },
  };
}

function sanitizeFileName(name) {
  return String(name || "asset")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80) || "asset";
}

function formatToExt(format) {
  const f = String(format || "PNG").toUpperCase();
  if (f === "JPG" || f === "JPEG") return "jpg";
  if (f === "SVG" || f === "SVG_STRING") return "svg";
  if (f === "PDF") return "pdf";
  return "png";
}

function detectImageFormat(bytes) {
  if (!bytes || !bytes.length) return { format: "PNG", ext: "png" };
  // PNG
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { format: "PNG", ext: "png" };
  }
  // JPEG
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { format: "JPG", ext: "jpg" };
  }
  // GIF
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46
  ) {
    return { format: "GIF", ext: "gif" };
  }
  // WebP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { format: "WEBP", ext: "webp" };
  }
  // SVG text
  try {
    const head = String.fromCharCode.apply(
      null,
      Array.prototype.slice.call(bytes.subarray ? bytes.subarray(0, 64) : bytes.slice(0, 64)),
    );
    if (head.indexOf("<svg") !== -1 || head.indexOf("<?xml") !== -1) {
      return { format: "SVG", ext: "svg" };
    }
  } catch (_) {
    /* ignore */
  }
  return { format: "PNG", ext: "png" };
}

/** Pure JS base64 (plugin sandbox may lack btoa). */
function uint8ToBase64(bytes) {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const a = bytes[i];
    const b = i + 1 < len ? bytes[i + 1] : 0;
    const c = i + 2 < len ? bytes[i + 2] : 0;
    out += alphabet[a >> 2];
    out += alphabet[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < len ? alphabet[((b & 15) << 2) | (c >> 6)] : "=";
    out += i + 2 < len ? alphabet[c & 63] : "=";
  }
  return out;
}

function utf8ToBase64(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const low = str.charCodeAt(++i);
      const cp = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return uint8ToBase64(bytes);
}

function getDesignTokens(params) {
  let roots = [];
  if (params.nodeId || params.name) {
    const node = findNodeByIdOrName(params.nodeId, params.name);
    if (!node) throw new Error("未找到用于提取 tokens 的节点");
    roots = [node];
  } else if (jsDesign.currentPage.selection.length > 0) {
    roots = [...jsDesign.currentPage.selection];
  } else {
    roots = [...(jsDesign.currentPage.children || [])];
  }

  const opts = resolveOptions({ maxDepth: 40, skipHidden: true, skipInstanceChildren: true });
  applyTraverseFlags(opts);
  const trees = roots.map((n) => serializeNode(n, 0, opts));
  return extractTokens(trees);
}

function getNodeCss(params) {
  const node = findNodeByIdOrName(params.nodeId, params.name);
  if (!node) throw new Error("未找到节点");
  const serialized = serializeNode(node, 0, {
    maxDepth: 1,
    skipHidden: false,
    skipInstanceChildren: true,
  });
  return {
    nodeId: node.id,
    name: node.name,
    css: nodeToCss(serialized),
  };
}

// ——— serialization ———

function serializeNode(node, depth, opts) {
  const out = {
    id: node.id,
    name: node.name,
    type: node.type,
  };

  if ("visible" in node) out.visible = node.visible;
  if ("locked" in node) out.locked = node.locked;

  if ("x" in node) out.x = node.x;
  if ("y" in node) out.y = node.y;
  if ("width" in node) out.width = node.width;
  if ("height" in node) out.height = node.height;
  if ("rotation" in node) out.rotation = node.rotation;
  if ("opacity" in node) out.opacity = node.opacity;
  if ("blendMode" in node) out.blendMode = node.blendMode;

  // Layout (auto-layout frames)
  copyIfPresent(node, out, [
    "layoutMode",
    "primaryAxisSizingMode",
    "counterAxisSizingMode",
    "primaryAxisAlignItems",
    "counterAxisAlignItems",
    "paddingLeft",
    "paddingRight",
    "paddingTop",
    "paddingBottom",
    "itemSpacing",
    "layoutAlign",
    "layoutGrow",
    "layoutPositioning",
    "clipsContent",
  ]);

  // Visual
  if ("fills" in node && node.fills !== jsDesign.mixed) {
    out.fills = serializePaints(node.fills);
  }
  if ("strokes" in node && node.strokes !== jsDesign.mixed) {
    out.strokes = serializePaints(node.strokes);
  }
  if ("strokeWeight" in node && node.strokeWeight !== jsDesign.mixed) {
    out.strokeWeight = node.strokeWeight;
  }
  if ("strokeAlign" in node) out.strokeAlign = node.strokeAlign;
  if ("dashPattern" in node) out.dashPattern = node.dashPattern;

  if ("cornerRadius" in node && node.cornerRadius !== jsDesign.mixed) {
    out.cornerRadius = node.cornerRadius;
  }
  copyIfPresent(node, out, [
    "topLeftRadius",
    "topRightRadius",
    "bottomLeftRadius",
    "bottomRightRadius",
  ]);

  if ("effects" in node && node.effects !== jsDesign.mixed) {
    out.effects = serializeEffects(node.effects);
  }

  // Text
  if (node.type === "TEXT") {
    if ("characters" in node) out.characters = node.characters;
    if ("fontSize" in node && node.fontSize !== jsDesign.mixed) out.fontSize = node.fontSize;
    if ("fontName" in node && node.fontName !== jsDesign.mixed) out.fontName = node.fontName;
    if ("lineHeight" in node && node.lineHeight !== jsDesign.mixed) out.lineHeight = node.lineHeight;
    if ("letterSpacing" in node && node.letterSpacing !== jsDesign.mixed) {
      out.letterSpacing = node.letterSpacing;
    }
    copyIfPresent(node, out, [
      "textAlignHorizontal",
      "textAlignVertical",
      "textCase",
      "textDecoration",
      "textAutoResize",
    ]);
  }

  // Constraints
  if ("constraints" in node) out.constraints = node.constraints;

  // Children
  if ("children" in node && Array.isArray(node.children)) {
    if (depth >= opts.maxDepth) {
      out.childrenTruncated = true;
      out.childCount = node.children.length;
    } else if (opts.skipInstanceChildren && node.type === "INSTANCE") {
      out.childCount = node.children.length;
      out.instanceChildrenSkipped = true;
    } else {
      const kids = [];
      for (const child of node.children) {
        if (opts.skipHidden && "visible" in child && child.visible === false) continue;
        kids.push(serializeNode(child, depth + 1, opts));
      }
      out.children = kids;
    }
  }

  return out;
}

function copyIfPresent(src, dest, keys) {
  for (const k of keys) {
    if (k in src) {
      try {
        const v = src[k];
        if (v !== undefined && v !== jsDesign.mixed) dest[k] = v;
      } catch (_) {
        /* skip */
      }
    }
  }
}

function serializePaints(fills) {
  if (!Array.isArray(fills)) return [];
  return fills.map((p) => {
    const paint = { type: p.type, visible: p.visible !== false, opacity: p.opacity };
    if (p.type === "SOLID" && p.color) {
      paint.color = rgbaToHex(p.color, p.opacity);
      paint.rgb = p.color;
    }
    if (p.type === "IMAGE") {
      paint.scaleMode = p.scaleMode;
      paint.imageHash = p.imageHash;
    }
    if (p.type === "GRADIENT_LINEAR" || p.type === "GRADIENT_RADIAL" || p.type === "GRADIENT_ANGULAR") {
      paint.gradientStops = (p.gradientStops || []).map((s) => ({
        position: s.position,
        color: rgbaToHex(s.color, s.color.a),
        rgb: s.color,
      }));
      if (p.gradientTransform) paint.gradientTransform = p.gradientTransform;
    }
    return paint;
  });
}

function serializeEffects(effects) {
  if (!Array.isArray(effects)) return [];
  return effects.map((e) => ({
    type: e.type,
    visible: e.visible !== false,
    radius: e.radius,
    color: e.color ? rgbaToHex(e.color, e.color.a) : undefined,
    offset: e.offset,
    spread: e.spread,
  }));
}

function rgbaToHex(color, opacity) {
  if (!color) return undefined;
  const r = Math.round((color.r || 0) * 255);
  const g = Math.round((color.g || 0) * 255);
  const b = Math.round((color.b || 0) * 255);
  const a = opacity !== undefined && opacity !== null ? opacity : color.a !== undefined ? color.a : 1;
  const toHex = (n) => n.toString(16).padStart(2, "0");
  if (a < 1) {
    return "rgba(" + r + ", " + g + ", " + b + ", " + round(a, 3) + ")";
  }
  return "#" + toHex(r) + toHex(g) + toHex(b);
}

function round(n, d) {
  const p = Math.pow(10, d);
  return Math.round(n * p) / p;
}

// ——— write/create methods (fork addition) ———

/** Resolve a parent by id, fallback to currentPage. */
function resolveParent(parentId) {
  if (parentId) {
    const parent = jsDesign.getNodeById(parentId);
    if (!parent) throw new Error("未找到父节点 id=" + parentId);
    if (!("appendChild" in parent)) {
      throw new Error("父节点不支持 appendChild: " + parent.type + " (id=" + parentId + ")");
    }
    return parent;
  }
  return jsDesign.currentPage;
}

/** Convert "#rrggbb" / "#rgb" / "rgba(r,g,b,a)" / {r,g,b} (0-1) to RGB. */
function parseColor(input) {
  if (!input) return undefined;
  if (typeof input === "object" && input !== null) {
    return {
      r: clamp01(input.r),
      g: clamp01(input.g),
      b: clamp01(input.b),
    };
  }
  if (typeof input !== "string") return undefined;
  const hexMatch = input.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (hexMatch) {
    const hex = hexMatch[1];
    let r, g, b;
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    }
    return { r: r / 255, g: g / 255, b: b / 255 };
  }
  const rgbaMatch = input.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s]+([\d.]+))?\s*\)/);
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1], 10) / 255,
      g: parseInt(rgbaMatch[2], 10) / 255,
      b: parseInt(rgbaMatch[3], 10) / 255,
    };
  }
  throw new Error("无法解析颜色: " + input);
}

function clamp01(n) {
  if (typeof n !== "number") return 0;
  if (n > 1) return n / 255;
  return Math.max(0, Math.min(1, n));
}

/** Build a SOLID paint from a color + opacity. */
function solidPaint(colorInput, opacity) {
  const rgb = parseColor(colorInput);
  if (!rgb) return undefined;
  return [{ type: "SOLID", color: rgb, opacity: opacity !== undefined ? opacity : 1, visible: true }];
}

/** Apply common node properties (x/y/size/name/fills/strokes/corner/opacity). */
function applyNodeProps(node, params) {
  if (params.name) node.name = String(params.name);
  if (typeof params.x === "number") node.x = params.x;
  if (typeof params.y === "number") node.y = params.y;
  const w = typeof params.width === "number" ? params.width : 100;
  const h = typeof params.height === "number" ? params.height : 100;
  if (typeof params.width === "number" || typeof params.height === "number") {
    node.resize(w, h);
  }
  if (params.fills) {
    if (Array.isArray(params.fills) && params.fills.length > 0 && params.fills[0] && typeof params.fills[0] === "object" && params.fills[0].type) {
      node.fills = params.fills;
    } else {
      const paint = solidPaint(params.fills[0] || params.fills, params.fillOpacity);
      if (paint) node.fills = paint;
    }
  }
  if (params.strokes) {
    const paint = solidPaint(Array.isArray(params.strokes) ? params.strokes[0] : params.strokes, params.strokeOpacity);
    if (paint) node.strokes = paint;
  }
  if (typeof params.strokeWeight === "number") node.strokeWeight = params.strokeWeight;
  if (typeof params.cornerRadius === "number") node.cornerRadius = params.cornerRadius;
  if (typeof params.opacity === "number") node.opacity = params.opacity;
  if (typeof params.rotation === "number") node.rotation = params.rotation;
  if (typeof params.visible === "boolean") node.visible = params.visible;
  if (typeof params.locked === "boolean") node.locked = params.locked;
  // Auto-layout passthrough for frames
  if (params.layoutMode) node.layoutMode = params.layoutMode;
  if (typeof params.itemSpacing === "number") node.itemSpacing = params.itemSpacing;
  if (typeof params.paddingTop === "number") node.paddingTop = params.paddingTop;
  if (typeof params.paddingRight === "number") node.paddingRight = params.paddingRight;
  if (typeof params.paddingBottom === "number") node.paddingBottom = params.paddingBottom;
  if (typeof params.paddingLeft === "number") node.paddingLeft = params.paddingLeft;
  if (params.primaryAxisAlignItems) node.primaryAxisAlignItems = params.primaryAxisAlignItems;
  if (params.counterAxisAlignItems) node.counterAxisAlignItems = params.counterAxisAlignItems;
  if (params.primaryAxisSizingMode) node.primaryAxisSizingMode = params.primaryAxisSizingMode;
  if (params.counterAxisSizingMode) node.counterAxisSizingMode = params.counterAxisSizingMode;
}

/** Serialize a created node back to the caller (minimal, id/name/type/geom). */
function serializeCreated(node) {
  const out = {
    id: node.id,
    name: node.name,
    type: node.type,
    x: "x" in node ? node.x : undefined,
    y: "y" in node ? node.y : undefined,
    width: "width" in node ? node.width : undefined,
    height: "height" in node ? node.height : undefined,
  };
  return out;
}

async function createFrameNode(params) {
  const frame = jsDesign.createFrame();
  applyNodeProps(frame, params);
  const parent = resolveParent(params.parentId);
  parent.appendChild(frame);
  return serializeCreated(frame);
}

async function createRectangleNode(params) {
  const rect = jsDesign.createRectangle();
  applyNodeProps(rect, params);
  const parent = resolveParent(params.parentId);
  parent.appendChild(rect);
  return serializeCreated(rect);
}

async function createTextNode(params) {
  if (!params.text && params.text !== "") {
    throw new Error("create_text 需要 text 参数");
  }
  const text = jsDesign.createText();
  // load font before setting characters
  const fontName = params.fontName || { family: "Inter", style: "Regular" };
  try {
    await jsDesign.loadFontAsync(fontName);
    text.fontName = fontName;
  } catch (e) {
    // fallback: load the node's default font
    try {
      await jsDesign.loadFontAsync(text.fontName);
    } catch (e2) {
      throw new Error("加载字体失败: " + (e2 && e2.message ? e2.message : String(e2)));
    }
  }
  text.characters = String(params.text);
  if (typeof params.fontSize === "number") text.fontSize = params.fontSize;
  if (params.color) {
    const paint = solidPaint(params.color, 1);
    if (paint) text.fills = paint;
  }
  if (typeof params.textAlignHorizontal === "string") text.textAlignHorizontal = params.textAlignHorizontal;
  if (typeof params.lineHeight !== "undefined") text.lineHeight = params.lineHeight;
  applyNodeProps(text, params); // x/y/width/height/name/opacity...
  const parent = resolveParent(params.parentId);
  parent.appendChild(text);
  return serializeCreated(text);
}

/**
 * Recursively create nodes from a JSON tree (the inverse of serializeNode).
 * Accepts an array of DesignNode-like objects.
 * Returns { created: [{id,name,type}], count, errors: [] }
 */
async function createFromJson(params) {
  if (!Array.isArray(params.nodes)) {
    throw new Error("create_from_json 需要 nodes 数组");
  }
  const parent = resolveParent(params.parentId);
  const created = [];
  const errors = [];
  for (const spec of params.nodes) {
    try {
      const node = await createNodeRecursive(spec);
      parent.appendChild(node);
      created.push({ id: node.id, name: node.name, type: node.type });
    } catch (e) {
      errors.push({
        name: spec && spec.name ? spec.name : "(unnamed)",
        error: e && e.message ? e.message : String(e),
      });
    }
  }
  return {
    source: "create_from_json",
    documentName: jsDesign.root.name,
    page: { id: jsDesign.currentPage.id, name: jsDesign.currentPage.name },
    parentId: parent.id,
    created,
    count: created.length,
    errors,
  };
}

/** Map a serialized type to a jsDesign.createXxx() call. */
async function createNodeRecursive(spec) {
  if (!spec || typeof spec !== "object") throw new Error("节点规格无效");
  const type = String(spec.type || "FRAME").toUpperCase();
  let node;
  switch (type) {
    case "FRAME":
      node = jsDesign.createFrame();
      applyNodeProps(node, spec);
      break;
    case "RECTANGLE":
      node = jsDesign.createRectangle();
      applyNodeProps(node, spec);
      break;
    case "TEXT":
      node = jsDesign.createText();
      const fontName = spec.fontName || { family: "Inter", style: "Regular" };
      try {
        await jsDesign.loadFontAsync(fontName);
        node.fontName = fontName;
      } catch (e) {
        await jsDesign.loadFontAsync(node.fontName);
      }
      node.characters = String(spec.characters || "");
      if (typeof spec.fontSize === "number") node.fontSize = spec.fontSize;
      if (Array.isArray(spec.fills) && spec.fills.length > 0 && spec.fills[0] && spec.fills[0].rgb) {
        node.fills = [{ type: "SOLID", color: spec.fills[0].rgb, opacity: 1, visible: true }];
      } else if (Array.isArray(spec.fills) && spec.fills.length > 0 && spec.fills[0] && typeof spec.fills[0].color === "string") {
        const paint = solidPaint(spec.fills[0].color, 1);
        if (paint) node.fills = paint;
      }
      applyNodeProps(node, spec); // x/y/width/height/name...
      break;
    case "ELLIPSE":
      node = jsDesign.createEllipse();
      applyNodeProps(node, spec);
      break;
    case "LINE":
      node = jsDesign.createLine();
      applyNodeProps(node, spec);
      break;
    default:
      // Unknown type → fall back to a Frame as a container
      node = jsDesign.createFrame();
      node.name = String(spec.name || type);
      applyNodeProps(node, spec);
  }
  // Recurse into children
  if (Array.isArray(spec.children) && "appendChild" in node) {
    for (const childSpec of spec.children) {
      try {
        const child = await createNodeRecursive(childSpec);
        node.appendChild(child);
      } catch (e) {
        // skip failed child but continue
      }
    }
  }
  return node;
}

// ——— tokens ———

function extractTokens(trees) {
  const colors = new Set();
  const fontSizes = new Set();
  const fontFamilies = new Set();
  const radii = new Set();
  const spacings = new Set();

  function walk(n) {
    if (!n) return;
    if (Array.isArray(n.fills)) {
      for (const f of n.fills) {
        if (f.color) colors.add(f.color);
        if (f.gradientStops) {
          for (const s of f.gradientStops) if (s.color) colors.add(s.color);
        }
      }
    }
    if (Array.isArray(n.strokes)) {
      for (const s of n.strokes) if (s.color) colors.add(s.color);
    }
    if (typeof n.fontSize === "number") fontSizes.add(n.fontSize);
    if (n.fontName && n.fontName.family) fontFamilies.add(n.fontName.family + "/" + (n.fontName.style || ""));
    if (typeof n.cornerRadius === "number") radii.add(n.cornerRadius);
    for (const k of ["paddingLeft", "paddingRight", "paddingTop", "paddingBottom", "itemSpacing"]) {
      if (typeof n[k] === "number") spacings.add(n[k]);
    }
    if (Array.isArray(n.children)) n.children.forEach(walk);
  }

  trees.forEach(walk);

  return {
    colors: [...colors],
    fontSizes: [...fontSizes].sort((a, b) => a - b),
    fontFamilies: [...fontFamilies],
    radii: [...radii].sort((a, b) => a - b),
    spacings: [...spacings].sort((a, b) => a - b),
  };
}

function nodeToCss(n) {
  const lines = [];
  if (typeof n.width === "number") lines.push("width: " + Math.round(n.width) + "px;");
  if (typeof n.height === "number") lines.push("height: " + Math.round(n.height) + "px;");
  if (n.layoutMode === "HORIZONTAL") {
    lines.push("display: flex;");
    lines.push("flex-direction: row;");
  } else if (n.layoutMode === "VERTICAL") {
    lines.push("display: flex;");
    lines.push("flex-direction: column;");
  }
  if (typeof n.itemSpacing === "number") lines.push("gap: " + n.itemSpacing + "px;");
  if (typeof n.paddingTop === "number") {
    lines.push(
      "padding: " +
        [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft].map((v) => (v || 0) + "px").join(" ") +
        ";",
    );
  }
  if (typeof n.cornerRadius === "number") lines.push("border-radius: " + n.cornerRadius + "px;");
  if (Array.isArray(n.fills)) {
    const solid = n.fills.find((f) => f.type === "SOLID" && f.visible !== false);
    if (solid && solid.color) lines.push("background: " + solid.color + ";");
  }
  if (n.type === "TEXT") {
    if (n.fontSize) lines.push("font-size: " + n.fontSize + "px;");
    if (n.fontName && n.fontName.family) lines.push("font-family: \"" + n.fontName.family + "\";");
    if (n.characters !== undefined) lines.push("/* content: " + JSON.stringify(n.characters).slice(0, 80) + " */");
  }
  if (typeof n.opacity === "number" && n.opacity < 1) lines.push("opacity: " + n.opacity + ";");
  return lines.join("\n");
}
