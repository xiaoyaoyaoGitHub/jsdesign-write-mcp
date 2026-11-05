import { WebSocket } from "ws";
import { type ClientRole } from "./schema.js";
export type BridgeClientInfo = {
    id: string;
    documentName?: string;
    pageName?: string;
    lastSeen: number;
};
export type ConnectedClient = {
    id: string;
    ws: WebSocket;
    role: ClientRole;
    documentName?: string;
    pageName?: string;
    lastSeen: number;
};
/** Shared surface used by MCP tools (in-process Bridge or remote AgentClient). */
export interface BridgeLike {
    listClients(): Promise<BridgeClientInfo[]>;
    call(method: string, params?: Record<string, unknown>, options?: {
        clientId?: string;
        timeoutMs?: number;
    }): Promise<unknown>;
}
export declare class Bridge implements BridgeLike {
    private wss;
    private clients;
    private pending;
    private port;
    private clientsChanged;
    constructor(port?: number);
    /** Notify when any WebSocket client connects or disconnects (agent + plugin). */
    onClientsChanged(handler: (count: number) => void): void;
    /** Total open sockets (including pre-hello); used for idle shutdown. */
    clientCount(): number;
    start(): Promise<number>;
    stop(): void;
    private removeClient;
    private emitClientsChanged;
    listClients(): Promise<BridgeClientInfo[]>;
    getPrimaryPlugin(clientId?: string): ConnectedClient | null;
    call(method: string, params?: Record<string, unknown>, options?: {
        clientId?: string;
        timeoutMs?: number;
    }): Promise<unknown>;
    private onMessage;
    private handleAgentRpc;
    private send;
}
