import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { AGENT_METHOD_LIST_CLIENTS, DEFAULT_WS_PORT, } from "./schema.js";
export class Bridge {
    wss = null;
    clients = new Map();
    pending = new Map();
    port;
    clientsChanged = null;
    constructor(port = DEFAULT_WS_PORT) {
        this.port = port;
    }
    /** Notify when any WebSocket client connects or disconnects (agent + plugin). */
    onClientsChanged(handler) {
        this.clientsChanged = handler;
    }
    /** Total open sockets (including pre-hello); used for idle shutdown. */
    clientCount() {
        return this.clients.size;
    }
    start() {
        return new Promise((resolve, reject) => {
            const wss = new WebSocketServer({ host: "127.0.0.1", port: this.port });
            this.wss = wss;
            wss.on("listening", () => resolve(this.port));
            wss.on("error", (err) => {
                if (err.code === "EADDRINUSE") {
                    reject(new Error(`端口 ${this.port} 已被占用。若已是 gy_jsdesign_mcp_bridge daemon 可忽略；否则结束占用进程或设置 JSDESIGN_MCP_PORT。`));
                    return;
                }
                reject(err);
            });
            wss.on("connection", (ws) => {
                const clientId = randomUUID();
                const client = {
                    id: clientId,
                    ws,
                    role: "plugin",
                    lastSeen: Date.now(),
                };
                this.clients.set(clientId, client);
                this.emitClientsChanged();
                ws.on("message", (raw) => {
                    this.onMessage(client, raw.toString());
                });
                ws.on("close", () => {
                    this.removeClient(clientId);
                });
                ws.on("error", () => {
                    this.removeClient(clientId);
                });
                this.send(ws, {
                    type: "hello",
                    clientId,
                });
            });
        });
    }
    stop() {
        for (const [, p] of this.pending) {
            clearTimeout(p.timer);
            p.reject(new Error("Bridge stopped"));
        }
        this.pending.clear();
        for (const c of this.clients.values()) {
            try {
                c.ws.close();
            }
            catch {
                /* ignore */
            }
        }
        this.clients.clear();
        this.wss?.close();
        this.wss = null;
    }
    removeClient(clientId) {
        if (!this.clients.delete(clientId))
            return;
        this.emitClientsChanged();
    }
    emitClientsChanged() {
        this.clientsChanged?.(this.clients.size);
    }
    async listClients() {
        return [...this.clients.values()]
            .filter((c) => c.role === "plugin")
            .map((c) => ({
            id: c.id,
            documentName: c.documentName,
            pageName: c.pageName,
            lastSeen: c.lastSeen,
        }));
    }
    getPrimaryPlugin(clientId) {
        if (clientId) {
            const c = this.clients.get(clientId);
            return c && c.role === "plugin" ? c : null;
        }
        return ([...this.clients.values()].find((c) => c.role === "plugin") ?? null);
    }
    async call(method, params = {}, options = {}) {
        const client = this.getPrimaryPlugin(options.clientId);
        if (!client) {
            // 区分「根本没插件连上」和「指定的 clientId 已失效（插件重连换 id）」
            throw new Error(options.clientId
                ? `未找到 clientId=${options.clientId} 的已连接文档（插件重连后 id 会变化）。请重新调用 get_connection_status 获取最新 clientId 后再试。`
                : "即时设计插件未连接。请在即时设计中打开「GY Design MCP Bridge」插件，并确认状态为「已连接」。");
        }
        const id = randomUUID();
        const timeoutMs = options.timeoutMs ?? 60_000;
        const req = { type: "rpc", id, method, params };
        const resultPromise = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`调用 ${method} 超时（${timeoutMs}ms）`));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
        });
        this.send(client.ws, req);
        return resultPromise;
    }
    onMessage(client, text) {
        let msg;
        try {
            msg = JSON.parse(text);
        }
        catch {
            return;
        }
        client.lastSeen = Date.now();
        if (msg.type === "hello") {
            if (msg.role === "agent") {
                client.role = "agent";
            }
            else {
                client.role = "plugin";
                client.documentName = msg.documentName;
                client.pageName = msg.pageName;
            }
            return;
        }
        if (msg.type === "heartbeat") {
            return;
        }
        if (msg.type === "agent-rpc") {
            if (client.role !== "agent")
                return;
            void this.handleAgentRpc(client, msg);
            return;
        }
        if (msg.type === "rpc-result") {
            const pending = this.pending.get(msg.id);
            if (!pending)
                return;
            clearTimeout(pending.timer);
            this.pending.delete(msg.id);
            const res = msg;
            if (res.ok) {
                pending.resolve(res.result);
            }
            else {
                pending.reject(new Error(res.error || "插件返回错误"));
            }
        }
    }
    async handleAgentRpc(agent, msg) {
        const reply = (payload) => {
            this.send(agent.ws, {
                type: "agent-rpc-result",
                id: msg.id,
                ...payload,
            });
        };
        try {
            if (msg.method === AGENT_METHOD_LIST_CLIENTS) {
                const clients = await this.listClients();
                reply({ ok: true, result: clients });
                return;
            }
            const result = await this.call(msg.method, msg.params || {}, {
                clientId: msg.clientId,
            });
            reply({ ok: true, result });
        }
        catch (e) {
            reply({
                ok: false,
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }
    send(ws, msg) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
        }
    }
}
