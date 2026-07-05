// Minimal MCP streamable-HTTP probe: JSON-RPC `initialize` then `tools/list`
// over plain fetch. No SDK, no persistence, 5s budget. Used only by the
// "Test connection" affordance in agent settings. Tokens are never logged and
// are scrubbed out of any error string before it leaves this module.

export interface McpProbeTool {
  name: string;
  description: string | null;
}

export interface McpProbeResult {
  ok: boolean;
  tools: McpProbeTool[];
  error: string | null;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string;
  result?: any;
  error?: { code?: number; message?: string };
}

const PROBE_TIMEOUT_MS = 5_000;

function scrub(text: string, secret?: string): string {
  let out = text;
  if (secret && secret.length > 0) out = out.split(secret).join('***');
  return out.slice(0, 300);
}

// A streamable-HTTP server may answer application/json or an SSE-wrapped body.
// For SSE, each JSON-RPC message sits on a `data:` line; pick the reply whose
// id matches the request (falling back to the last parseable message).
function parseSseBody(text: string, id: number | string): JsonRpcMessage | null {
  let last: JsonRpcMessage | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const raw = line.slice(5).trim();
    if (!raw) continue;
    try {
      const msg = JSON.parse(raw) as JsonRpcMessage;
      last = msg;
      if (msg.id === id && (msg.result !== undefined || msg.error !== undefined)) return msg;
    } catch {
      // ignore non-JSON data lines (comments, keep-alives)
    }
  }
  return last;
}

async function rpc(
  url: string,
  authToken: string | undefined,
  sessionId: string | undefined,
  body: Record<string, unknown>,
  deadline: number,
  isNotification = false,
): Promise<{ msg: JsonRpcMessage | null; sessionId?: string }> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('MCP probe timed out (5s)');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(remaining),
  });

  const nextSession = res.headers.get('mcp-session-id') ?? sessionId;
  if (isNotification) return { msg: null, sessionId: nextSession }; // 202/204 expected; body irrelevant

  if (!res.ok) throw new Error(`MCP server returned HTTP ${res.status}`);

  const contentType = res.headers.get('content-type') ?? '';
  const requestId = body.id as number | string;
  let msg: JsonRpcMessage | null;
  if (contentType.includes('text/event-stream')) {
    msg = parseSseBody(await res.text(), requestId);
  } else {
    msg = (await res.json()) as JsonRpcMessage;
  }
  if (!msg) throw new Error('MCP server sent no parseable JSON-RPC reply');
  return { msg, sessionId: nextSession };
}

export async function probeMcpServer(url: string, authToken?: string): Promise<McpProbeResult> {
  const deadline = Date.now() + PROBE_TIMEOUT_MS;
  try {
    const init = await rpc(
      url,
      authToken,
      undefined,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'robyn-chat', version: '0.1.0' },
        },
      },
      deadline,
    );
    if (init.msg?.error) {
      return { ok: false, tools: [], error: scrub(`initialize failed: ${init.msg.error.message ?? 'unknown error'}`, authToken) };
    }

    // Spec-compliant servers expect the initialized notification before use.
    // Best effort — some servers 202 it, some don't care.
    try {
      await rpc(url, authToken, init.sessionId, { jsonrpc: '2.0', method: 'notifications/initialized' }, deadline, true);
    } catch {
      // non-fatal
    }

    const list = await rpc(url, authToken, init.sessionId, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, deadline);
    if (list.msg?.error) {
      return { ok: false, tools: [], error: scrub(`tools/list failed: ${list.msg.error.message ?? 'unknown error'}`, authToken) };
    }

    const rawTools: any[] = Array.isArray(list.msg?.result?.tools) ? list.msg!.result.tools : [];
    const tools = rawTools
      .filter((t) => t && typeof t.name === 'string')
      .map((t) => ({ name: String(t.name), description: typeof t.description === 'string' ? t.description : null }));
    return { ok: true, tools, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const friendly = message.includes('abort') || message.includes('timeout') ? 'MCP server did not respond within 5s' : message;
    return { ok: false, tools: [], error: scrub(friendly, authToken) };
  }
}
