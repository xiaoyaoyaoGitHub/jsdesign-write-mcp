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
    case "delete_node":
      return deleteNode(params);
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

/** 页面 / 文档根 / 组件 / 锁定节点不允许被删除（破坏性操作的保护面） */
function isProtectedNode(node) {
  if (!node) return false;
  if (node === jsDesign.root) return true;
  if (node.type === "PAGE" || node.type === "DOCUMENT") return true;
  // 组件与组件集：删除会连带影响其它页面 / 文件里的实例
  if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") return true;
  if (node.locked === true) return true;
  return false;
}

/**
 * Delete nodes by id / name on the current page, or clear all top-level nodes.
 * 破坏性操作：必须明确指定删除范围，且页面 / 根节点 / 组件 / 锁定节点始终受保护。
 */
function deleteNode(params) {
  const results = [];
  const errors = [];

  // 空数组 / 空字符串视为「没传」，否则 [] 会被当成有效参数而静默空转
  const normalizeInput = (value) => {
    if (Array.isArray(value)) return value.length > 0 ? value : undefined;
    if (value === undefined || value === null || value === "") return undefined;
    return value;
  };
  const nodeIdInput = normalizeInput(params.nodeId);
  const nameInput = normalizeInput(params.name);
  const hasNodeId = nodeIdInput !== undefined;
  const hasName = nameInput !== undefined;
  const deleteAllTopLevel = params.allTopLevel === true;

  if (!hasNodeId && !hasName && !deleteAllTopLevel) {
    throw new Error("delete_node 需要至少提供 nodeId / name / allTopLevel 之一");
  }
  if (deleteAllTopLevel && (hasNodeId || hasName)) {
    throw new Error("allTopLevel 不能与 nodeId / name 同时使用");
  }

  if (hasNodeId) {
    const ids = Array.isArray(nodeIdInput) ? nodeIdInput : [nodeIdInput];
    for (const id of ids) {
      try {
        const node = jsDesign.getNodeById(id);
        if (!node) {
          errors.push({ id, error: "节点不存在" });
          continue;
        }
        if (isProtectedNode(node)) {
          errors.push({ id, error: "拒绝删除页面 / 文档根 / 组件 / 锁定节点" });
          continue;
        }
        const name = node.name;
        node.remove();
        results.push({ id, name, deleted: true });
      } catch (e) {
        errors.push({ id, error: e && e.message ? e.message : String(e) });
      }
    }
  }

  if (hasName) {
    const names = Array.isArray(nameInput) ? nameInput : [nameInput];
    for (const nm of names) {
      try {
        // 收集命中项时一并记录深度，避免依赖 node.parent 这种平台未保证的属性
        const matched = [];
        // 只扫当前页，避免误删其它页面的同名内容
        const findAndCollect = (root, depth) => {
          for (const child of root.children || []) {
            if (child.name === nm) matched.push({ node: child, depth });
            if ("children" in child && Array.isArray(child.children)) {
              findAndCollect(child, depth + 1);
            }
          }
        };
        findAndCollect(jsDesign.currentPage, 0);
        // 同名父子同时命中时先删子节点，避免父节点删除后产生假错误
        matched.sort((a, b) => b.depth - a.depth);
        for (const item of matched) {
          const node = item.node;
          try {
            if (isProtectedNode(node)) continue;
            const id = node.id;
            const nm2 = node.name;
            node.remove();
            results.push({ id, name: nm2, deleted: true });
          } catch (e) {
            errors.push({ name: nm, error: e && e.message ? e.message : String(e) });
          }
        }
        if (matched.length === 0) {
          errors.push({ name: nm, error: "未找到匹配节点" });
        }
      } catch (e) {
        errors.push({ name: nm, error: e && e.message ? e.message : String(e) });
      }
    }
  }

  if (deleteAllTopLevel) {
    // Delete all top-level nodes on the current page
    const page = jsDesign.currentPage;
    const toDelete = [...(page.children || [])];
    for (const node of toDelete) {
      try {
        if (isProtectedNode(node)) continue;
        const id = node.id;
        const nm = node.name;
        node.remove();
        results.push({ id, name: nm, deleted: true });
      } catch (e) {
        errors.push({ error: e && e.message ? e.message : String(e) });
      }
    }
  }

  return {
    source: "delete_node",
    documentName: jsDesign.root.name,
    page: { id: jsDesign.currentPage.id, name: jsDesign.currentPage.name },
    deleted: results,
    deletedCount: results.length,
    errors,
  };
}

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
    // 对象形态：{r,g,b} / {r,g,b,a}，0–255 与 0–1 都接受
    const rgb = {
      r: clamp01(input.r),
      g: clamp01(input.g),
      b: clamp01(input.b),
    };
    if (typeof input.a === "number" && isFinite(input.a)) {
      rgb.a = Math.max(0, Math.min(1, input.a));
    }
    return rgb;
  }
  if (typeof input !== "string") return undefined;
  const hexMatch = input.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
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
    const out = { r: r / 255, g: g / 255, b: b / 255 };
    // #rrggbbaa：末两位是 alpha
    if (hex.length === 8) out.a = parseInt(hex.slice(6, 8), 16) / 255;
    return out;
  }
  const rgbaMatch = input.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s]+([\d.]+))?\s*\)/);
  if (rgbaMatch) {
    const out = {
      r: parseInt(rgbaMatch[1], 10) / 255,
      g: parseInt(rgbaMatch[2], 10) / 255,
      b: parseInt(rgbaMatch[3], 10) / 255,
    };
    // rgba 的 alpha 必须保留，否则投影等会丢失透明度
    if (rgbaMatch[4] !== undefined) {
      out.a = Math.max(0, Math.min(1, parseFloat(rgbaMatch[4])));
    }
    return out;
  }
  throw new Error("无法解析颜色: " + input);
}

function clamp01(n) {
  if (typeof n !== "number" || Number.isNaN(n)) return 0;
  // 0–255 视为 8bit 通道，0–1 视为比例；两种情况都夹紧到 [0,1]
  const v = n > 1 ? n / 255 : n;
  return Math.max(0, Math.min(1, v));
}

/** Build a SOLID paint from a color + opacity. */
function solidPaint(colorInput, opacity) {
  const rgb = parseColor(colorInput);
  if (!rgb) return undefined;
  // 即时设计的 SOLID paint 只接受 r/g/b，alpha 一律走 opacity
  const resolvedOpacity =
    opacity !== undefined ? opacity : rgb.a !== undefined ? rgb.a : 1;
  return [
    {
      type: "SOLID",
      color: { r: rgb.r, g: rgb.g, b: rgb.b },
      opacity: resolvedOpacity,
      visible: true,
    },
  ];
}

/** parseColor 的容错版：无法解析时返回 undefined，而不是抛错中断创建 */
function safeParseColor(input) {
  try {
    return parseColor(input);
  } catch (e) {
    return undefined;
  }
}

/** 从 {color}/{rgb}/{r,g,b} 形态里取出真正的颜色值 */
function extractColorInput(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "object") {
    if (value.color !== undefined && value.color !== null) return value.color;
    if (value.rgb !== undefined && value.rgb !== null) return value.rgb;
    if (value.r !== undefined) return value;
    return undefined;
  }
  return value;
}

/** 取对象上的 opacity，缺省回落到调用方传入的默认值 */
function pickOpacity(value, fallback) {
  if (value && typeof value === "object" && typeof value.opacity === "number") {
    return value.opacity;
  }
  return fallback;
}

/**
 * 归一 fills 入参为即时设计的 paint 数组，兼容：
 * `#rrggbb` / `#rrggbbaa` / `rgba(r,g,b,a)` / `{r,g,b}` / `{color:"#hex"}` / `{rgb:{r,g,b}}`、
 * 上述任意形式的数组、以及原生 SOLID paint 数组。
 * 无法解析时返回 undefined，保持节点原有填充不变。
 */
function normalizeFills(input, opacity) {
  if (!input) return undefined;
  if (Array.isArray(input)) {
    if (input.length === 0) return undefined;
    const first = input[0];
    // 已经是 paint 数组（带 type）时原样使用
    if (first && typeof first === "object" && typeof first.type === "string") {
      return input;
    }
    const color = extractColorInput(first);
    if (color === undefined) return undefined;
    return solidPaint(color, pickOpacity(first, opacity));
  }
  if (typeof input === "object") {
    const color = extractColorInput(input);
    if (color === undefined) return undefined;
    return solidPaint(color, pickOpacity(input, opacity));
  }
  return solidPaint(input, opacity);
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
    const paints = normalizeFills(params.fills, params.fillOpacity);
    if (paints) node.fills = paints;
  }
  if (params.strokes) {
    const rawStrokes = Array.isArray(params.strokes) ? params.strokes[0] : params.strokes;
    // 原生 paint 数组直接使用（与 fills 对齐）
    if (rawStrokes && typeof rawStrokes === "object" && typeof rawStrokes.type === "string") {
      node.strokes = Array.isArray(params.strokes) ? params.strokes : [rawStrokes];
    } else {
      // 其余写法与 fills 保持一致："#hex" / {r,g,b} / {color} / {rgb}
      const strokeColor = extractColorInput(rawStrokes);
      if (strokeColor !== undefined) {
        const paint = solidPaint(strokeColor, params.strokeOpacity);
        if (paint) node.strokes = paint;
      }
    }
  }
  if (typeof params.strokeWeight === "number") node.strokeWeight = params.strokeWeight;
  if (typeof params.cornerRadius === "number") node.cornerRadius = params.cornerRadius;
  if (typeof params.opacity === "number") node.opacity = params.opacity;
  if (typeof params.rotation === "number") node.rotation = params.rotation;
  if (typeof params.visible === "boolean") node.visible = params.visible;
  if (typeof params.locked === "boolean") node.locked = params.locked;
  // Effects (drop shadow etc.)
  if (Array.isArray(params.effects)) {
    // 即时设计支持的 effect 类型；非法项跳过，避免一个坏投影让整棵节点树创建失败
    const effectTypes = { DROP_SHADOW: 1, INNER_SHADOW: 1, LAYER_BLUR: 1, BACKGROUND_BLUR: 1 };
    const shadowTypes = { DROP_SHADOW: 1, INNER_SHADOW: 1 };
    const effects = [];
    for (const e of params.effects) {
      if (!e || typeof e !== "object") continue;
      const type = String(e.type || "").toUpperCase();
      if (!effectTypes[type]) continue;
      try {
        const eff = { type, visible: e.visible !== false };
        if (shadowTypes[type]) {
          // 只有阴影类才有混合模式 / 偏移 / 扩散；模糊类只有 radius
          eff.blendMode = e.blendMode || "NORMAL";
        }
        if (typeof e.radius === "number") eff.radius = e.radius;
        if (e.color !== undefined && e.color !== null) {
          // 与 fills 一致：支持 "#hex" / {r,g,b} / {color} / {rgb} 四种写法
          const rgb = safeParseColor(extractColorInput(e.color));
          if (rgb) {
            // 透明度优先级：effect.opacity > 颜色自带 alpha > 阴影默认 0.15
            let alpha = e.opacity;
            if (typeof alpha === "number") {
              alpha = Math.max(0, Math.min(1, alpha));
            } else {
              alpha = rgb.a !== undefined ? rgb.a : 0.15;
            }
            eff.color = { r: rgb.r, g: rgb.g, b: rgb.b, a: alpha };
          }
        }
        if (e.offset && shadowTypes[type]) {
          eff.offset = { x: e.offset.x || 0, y: e.offset.y || 0 };
        }
        if (typeof e.spread === "number" && shadowTypes[type]) eff.spread = e.spread;
        effects.push(eff);
      } catch (err) {
        // 单个 effect 解析失败不影响其它属性写入
      }
    }
    if (effects.length > 0) {
      try {
        node.effects = effects;
      } catch (err) {
        // 平台拒绝该 effect 组合时不让整个节点创建失败
      }
    }
  }
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
    // 兼容 "#hex" / "#rrggbbaa" / "rgba(...)" / {r,g,b} / {color} / {rgb}，alpha 不再被丢弃
    const paint = solidPaint(extractColorInput(params.color), pickOpacity(params.color, undefined));
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
      const textFontName = spec.fontName || { family: "Inter", style: "Regular" };
      try {
        await jsDesign.loadFontAsync(textFontName);
        node.fontName = textFontName;
      } catch (e) {
        try {
          await jsDesign.loadFontAsync(node.fontName);
        } catch (e2) {
          await jsDesign.loadFontAsync({ family: "Inter", style: "Regular" });
        }
      }
      node.characters = String(spec.characters || "");
      if (typeof spec.fontSize === "number") node.fontSize = spec.fontSize;
      // Let applyNodeProps handle fills uniformly (it supports SOLID paints with color objects)
      applyNodeProps(node, spec);
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
