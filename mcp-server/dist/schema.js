/** Shared RPC message shapes between MCP server and plugin UI. */
export const DEFAULT_WS_PORT = 3847;
/** Daemon exits after this long with zero WebSocket clients (agent + plugin). */
export const DEFAULT_IDLE_MS = 15 * 60 * 1000;
/** Built-in agent-rpc method: list plugin clients (not forwarded to plugin). */
export const AGENT_METHOD_LIST_CLIENTS = "list_clients";
