"use client";

import * as React from "react";
import { AlertTriangle, Check, Loader2, RotateCw } from "lucide-react";

import { cn } from "@/lib/utils";
import { useApi, type Schemas } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RobynMark } from "@/components/brand";
import { MarkdownLite } from "./markdown-lite";
import { toolLabel } from "./tool-labels";
import type { ChatMessage, ToolActivity } from "./use-chat";

function ToolChip({ tool }: { tool: ToolActivity }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs",
        tool.status === "error" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
      )}
    >
      {tool.status === "running" && (
        <Loader2
          className="h-3 w-3 shrink-0 animate-spin text-primary motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
      {tool.status === "done" && (
        <Check className="h-3 w-3 shrink-0 text-success" aria-hidden="true" />
      )}
      {tool.status === "error" && (
        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
      )}
      <span className="truncate">{toolLabel(tool.name, tool.status)}</span>
    </span>
  );
}

function AssistantBubble({
  message,
  isStreaming,
  isLast,
  onRetry,
}: {
  message: ChatMessage;
  isStreaming: boolean;
  isLast: boolean;
  onRetry: () => void;
}) {
  const thinking =
    isStreaming && isLast && message.content === "" && (message.tools?.length ?? 0) === 0;

  return (
    <div className="flex flex-col items-start gap-1.5">
      {(message.tools?.length ?? 0) > 0 && (
        <div className="flex max-w-[90%] flex-wrap gap-1.5">
          {message.tools!.map((tool) => (
            <ToolChip key={tool.id} tool={tool} />
          ))}
        </div>
      )}

      {thinking && (
        <div className="rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5">
          <span
            className="text-sm text-muted-foreground motion-safe:animate-pulse"
            role="status"
          >
            Thinking…
          </span>
        </div>
      )}

      {message.content !== "" && (
        <div className="max-w-[90%] rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
          <MarkdownLite text={message.content} />
        </div>
      )}

      {message.stopped && (
        <span className="px-1 text-xs text-muted-foreground">Stopped</span>
      )}

      {message.error && (
        <div className="max-w-[90%] rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5">
          <p className="text-xs text-foreground">{message.error}</p>
          {isLast && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2 h-7"
              onClick={onRetry}
              disabled={isStreaming}
            >
              <RotateCw className="h-3 w-3" />
              Retry
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyChat({
  active,
  onPick,
}: {
  active: boolean;
  onPick: (question: string) => void;
}) {
  const { data, isLoading, error } = useApi<Schemas["ChatStartersDto"]>(
    active ? "/chat/starters" : null,
  );
  const starters = (data?.starters ?? []).slice(0, 4);

  return (
    <div className="flex h-full flex-col items-center justify-center px-5 pb-8 text-center">
      <RobynMark className="mb-3 h-10 w-10" />
      <p className="text-sm font-medium text-foreground">Ask Robyn anything</p>
      <p className="mt-1 max-w-[240px] text-xs text-muted-foreground">
        Robyn can check your invoices, meetings and unbilled work, and act on
        what it finds.
      </p>

      <div className="mt-5 flex w-full max-w-[300px] flex-col gap-2">
        {isLoading &&
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-lg" />
          ))}
        {!isLoading && error && (
          <p className="text-xs text-muted-foreground">
            Suggestions are unavailable right now. Type a question below.
          </p>
        )}
        {!isLoading &&
          starters.map((question) => (
            <button
              key={question}
              type="button"
              onClick={() => onPick(question)}
              className="w-full cursor-pointer rounded-lg border border-border bg-card px-3 py-2 text-left text-xs text-foreground shadow-xs transition-colors duration-fast hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {question}
            </button>
          ))}
      </div>
    </div>
  );
}

export function ChatMessages({
  messages,
  hydrated,
  isStreaming,
  active,
  onSend,
  onRetry,
}: {
  messages: ChatMessage[];
  hydrated: boolean;
  isStreaming: boolean;
  /** True while the panel is open; gates the starters fetch. */
  active: boolean;
  onSend: (text: string) => void;
  onRetry: () => void;
}) {
  const listRef = React.useRef<HTMLDivElement>(null);
  const stickRef = React.useRef(true);

  const handleScroll = React.useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }, []);

  // Follow new content unless the user has scrolled up to read.
  React.useEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, isStreaming]);

  // Jump to the latest message whenever the panel is opened.
  React.useEffect(() => {
    if (!active) return;
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      stickRef.current = true;
    }
  }, [active]);

  if (hydrated && messages.length === 0) {
    return <EmptyChat active={active} onPick={onSend} />;
  }

  return (
    <div
      ref={listRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-4 py-4"
      role="log"
      aria-live="polite"
      aria-label="Conversation with Robyn"
    >
      <div className="flex flex-col gap-4">
        {messages.map((message, i) =>
          message.role === "user" ? (
            <div key={message.id} className="flex justify-end">
              <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm leading-relaxed text-primary-foreground">
                {message.content}
              </div>
            </div>
          ) : (
            <AssistantBubble
              key={message.id}
              message={message}
              isStreaming={isStreaming}
              isLast={i === messages.length - 1}
              onRetry={onRetry}
            />
          ),
        )}
      </div>
    </div>
  );
}
