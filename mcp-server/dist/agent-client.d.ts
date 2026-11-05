import type { BridgeClientInfo, BridgeLike } from "./bridge.js";
/**
 * MCP stdio 进程侧：作为 agent 连接到 daemon，转发工具调用。
 */
export declare class AgentClient implements BridgeLike {
    private ws;
    private pending;
    private port;
    private assignedId;
    constructor(port?: number);
    get url(): string;
    /** Connect and complete agent hello handshake. */
    connect(timeoutMs?: number): Promise<void>;
    close(): void;
    listClients(): Promise<BridgeClientInfo[]>;
    call(method: string, params?: Record<string, unknown>, options?: {
        clientId?: string;
        timeoutMs?: number;
    }): Promise<unknown>;
    private onAgentResult;
    private send;
}
/** Probe whether an existing listener on port speaks agent-rpc (our daemon). */
export declare function probeDaemon(port?: number, timeoutMs?: number): Promise<boolean>;
