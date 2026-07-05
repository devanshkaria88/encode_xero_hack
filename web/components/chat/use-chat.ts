"use client";

import * as React from "react";

import { streamChat, type ChatStreamEvent } from "@/lib/api";

/** One tool call surfaced by the stream, shown as an inline activity chip. */
export interface ToolActivity {
  id: number;
  name: string;
  status: "running" | "done" | "error";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Assistant only: tool activity for this turn, in order. */
  tools?: ToolActivity[];
  /** Assistant only: the stream ended with an error event. */
  error?: string;
  /** Assistant only: the user pressed Stop mid-reply. */
  stopped?: boolean;
}

const STORAGE_KEY = "robyn.chat";

let nextId = 0;
function makeId(prefix: string): string {
  nextId += 1;
  return `${prefix}-${Date.now()}-${nextId}`;
}

function loadHistory(): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const messages: ChatMessage[] = [];
    for (const item of parsed) {
      if (
        typeof item !== "object" ||
        item === null ||
        !("role" in item) ||
        !("content" in item)
      )
        continue;
      const m = item as ChatMessage;
      if (m.role !== "user" && m.role !== "assistant") continue;
      if (typeof m.content !== "string") continue;
      messages.push({
        id: typeof m.id === "string" ? m.id : makeId("m"),
        role: m.role,
        content: m.content,
        // A tool still "running" after a reload is a stale stream; drop it.
        tools: Array.isArray(m.tools)
          ? m.tools.filter((t) => t && t.status !== "running")
          : undefined,
        error: typeof m.error === "string" ? m.error : undefined,
        stopped: m.stopped === true ? true : undefined,
      });
    }
    // A reload mid-stream can persist an assistant draft with nothing in it.
    // Drop those ghosts so they never render as blank bubbles.
    return messages.filter(
      (m) =>
        m.role === "user" ||
        m.content !== "" ||
        (m.tools?.length ?? 0) > 0 ||
        m.error !== undefined,
    );
  } catch {
    return [];
  }
}

function applyEvent(
  prev: ChatMessage[],
  draftId: string,
  event: ChatStreamEvent,
  seq: React.MutableRefObject<number>,
): ChatMessage[] {
  const idx = prev.findIndex((m) => m.id === draftId);
  if (idx < 0) return prev;
  const draft = prev[idx];
  const next = [...prev];

  switch (event.type) {
    case "text":
      next[idx] = { ...draft, content: draft.content + event.delta };
      break;
    case "tool": {
      const tools = [...(draft.tools ?? [])];
      if (event.status === "running") {
        seq.current += 1;
        tools.push({ id: seq.current, name: event.name, status: "running" });
      } else {
        // Completion events reuse the tool name, except MCP tools which
        // complete under the generic name "mcp". Close the most recent
        // matching chip that is still running.
        let matched = -1;
        for (let i = tools.length - 1; i >= 0; i--) {
          const t = tools[i];
          if (
            t.status === "running" &&
            (t.name === event.name ||
              (event.name === "mcp" && t.name.startsWith("mcp:")))
          ) {
            matched = i;
            break;
          }
        }
        if (matched >= 0) {
          tools[matched] = { ...tools[matched], status: event.status };
        } else {
          seq.current += 1;
          tools.push({ id: seq.current, name: event.name, status: event.status });
        }
      }
      next[idx] = { ...draft, tools };
      break;
    }
    case "error":
      next[idx] = { ...draft, error: event.message };
      break;
    case "done":
      break;
  }
  return next;
}

/**
 * Chat state for the Robyn panel. History lives in React state, mirrored to
 * sessionStorage under "robyn.chat" so it survives navigation but not a new
 * browser session. The server is stateless; we send the full history per turn.
 */
export function useChat() {
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [hydrated, setHydrated] = React.useState(false);
  const [isStreaming, setIsStreaming] = React.useState(false);

  const messagesRef = React.useRef<ChatMessage[]>(messages);
  messagesRef.current = messages;
  const streamRef = React.useRef<{ abort: () => void } | null>(null);
  const toolSeq = React.useRef(0);

  React.useEffect(() => {
    setMessages(loadHistory());
    setHydrated(true);
  }, []);

  React.useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // Storage full or unavailable. The chat still works, it just won't persist.
    }
  }, [messages, hydrated]);

  // Abort any in-flight stream if the widget unmounts.
  React.useEffect(() => {
    return () => streamRef.current?.abort();
  }, []);

  const begin = React.useCallback((base: ChatMessage[]) => {
    const draftId = makeId("a");
    setMessages([
      ...base,
      { id: draftId, role: "assistant", content: "", tools: [] },
    ]);
    setIsStreaming(true);

    const history = base
      .filter((m) => m.content.trim().length > 0)
      .map((m) => ({ role: m.role, content: m.content }));

    const stream = streamChat(history, (event) => {
      setMessages((prev) => applyEvent(prev, draftId, event, toolSeq));
      if (event.type === "done" || event.type === "error") {
        setIsStreaming(false);
      }
    });
    streamRef.current = stream;
    void stream.done.finally(() => {
      if (streamRef.current === stream) {
        streamRef.current = null;
        setIsStreaming(false);
      }
    });
  }, []);

  /** Send a new user message. No-op while a reply is streaming. */
  const send = React.useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text || streamRef.current) return;
      begin([
        ...messagesRef.current,
        { id: makeId("u"), role: "user", content: text },
      ]);
    },
    [begin],
  );

  /** Stop the current reply, keeping whatever has streamed so far. */
  const stop = React.useCallback(() => {
    streamRef.current?.abort();
    streamRef.current = null;
    setIsStreaming(false);
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (!last || last.role !== "assistant") return prev;
      const hasTools = (last.tools?.length ?? 0) > 0;
      if (last.content === "" && !hasTools && !last.error) {
        return prev.slice(0, -1);
      }
      return [
        ...prev.slice(0, -1),
        {
          ...last,
          stopped: true,
          tools: last.tools?.map((t) =>
            t.status === "running" ? { ...t, status: "done" as const } : t,
          ),
        },
      ];
    });
  }, []);

  /** Re-send the last user message (after an error), dropping the failed reply. */
  const retry = React.useCallback(() => {
    if (streamRef.current) return;
    const msgs = messagesRef.current;
    let lastUser = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "user") {
        lastUser = i;
        break;
      }
    }
    if (lastUser < 0) return;
    begin(msgs.slice(0, lastUser + 1));
  }, [begin]);

  /** Wipe the conversation, aborting any in-flight reply. */
  const clear = React.useCallback(() => {
    streamRef.current?.abort();
    streamRef.current = null;
    setIsStreaming(false);
    setMessages([]);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore.
    }
  }, []);

  return { messages, hydrated, isStreaming, send, stop, retry, clear };
}
