"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowUp,
  MessageCircle,
  Settings,
  Square,
  Trash2,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RobynMark } from "@/components/brand";
import { ChatMessages } from "./chat-messages";
import { useChat } from "./use-chat";

/**
 * The Robyn chat surface: a floating bubble on every dashboard page that opens
 * a right-side panel. The widget (and any in-flight stream) stays mounted when
 * the panel closes, so a long answer keeps streaming in the background.
 */
export function ChatWidget() {
  const [open, setOpen] = React.useState(false);
  const [input, setInput] = React.useState("");
  const { messages, hydrated, isStreaming, send, stop, retry, clear } =
    useChat();

  const panelRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Keep the closed panel out of the tab order and inert for screen readers.
  React.useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    if (open) el.removeAttribute("inert");
    else el.setAttribute("inert", "");
  }, [open]);

  // Focus the input when the panel opens; Escape closes it.
  React.useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => textareaRef.current?.focus(), 240);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Grow the textarea with its content, up to a calm maximum.
  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [input]);

  const handleSend = React.useCallback(
    (text: string) => {
      if (isStreaming) return;
      send(text);
      setInput("");
      textareaRef.current?.focus();
    },
    [isStreaming, send],
  );

  const canSend = input.trim().length > 0 && !isStreaming;

  return (
    <>
      {/* Floating bubble */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Chat with Robyn"
        className={cn(
          "fixed bottom-5 right-5 z-40 flex h-12 w-12 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-all duration-fast ease-in-out-quiet hover:bg-primary/90 hover:shadow-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-95 motion-reduce:transition-none",
          open && "pointer-events-none scale-90 opacity-0",
        )}
      >
        <MessageCircle className="h-5 w-5" aria-hidden="true" />
      </button>

      {/* Right-side panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Robyn chat"
        aria-hidden={!open}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-card shadow-lg transition-transform duration-normal ease-in-out-quiet motion-reduce:transition-none sm:w-[400px]",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header */}
        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-4">
          <RobynMark className="h-7 w-7" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight text-foreground">
              Robyn
            </p>
            <p className="truncate text-xs leading-tight text-muted-foreground">
              Knows your invoices, meetings and money
            </p>
          </div>
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={clear}
              aria-label="Clear conversation"
              title="Clear conversation"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            asChild
          >
            <Link
              href="/settings"
              aria-label="Agent settings"
              title="Agent settings"
              onClick={() => setOpen(false)}
            >
              <Settings className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={() => setOpen(false)}
            aria-label="Close chat"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Messages */}
        <div className="flex min-h-0 flex-1 flex-col">
          <ChatMessages
            messages={messages}
            hydrated={hydrated}
            isStreaming={isStreaming}
            active={open}
            onSend={handleSend}
            onRetry={retry}
          />
        </div>

        {/* Input */}
        <div className="shrink-0 border-t border-border p-3">
          <div className="flex items-end gap-2 rounded-lg border border-input bg-background px-3 py-2 shadow-xs transition-colors focus-within:ring-1 focus-within:ring-ring">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  if (canSend) handleSend(input);
                }
              }}
              rows={1}
              placeholder="Ask about your invoices, clients or tasks"
              aria-label="Message Robyn"
              className="max-h-32 flex-1 resize-none bg-transparent text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            {isStreaming ? (
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={stop}
                aria-label="Stop reply"
                title="Stop"
              >
                <Square className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => handleSend(input)}
                disabled={!canSend}
                aria-label="Send message"
                title="Send"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </div>
          <p className="mt-1.5 px-1 text-[0.6875rem] text-muted-foreground">
            Enter to send. Shift+Enter for a new line.
          </p>
        </div>
      </div>
    </>
  );
}
