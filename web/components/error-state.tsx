"use client";

import * as React from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { ApiError } from "@/lib/api";

export interface ErrorStateProps {
  title?: string;
  /** An ApiError, an Error, or a plain message. */
  error?: ApiError | Error | string | null;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
  compact?: boolean;
}

function messageFor(error: ErrorStateProps["error"]): string {
  if (!error) return "Something went wrong.";
  if (typeof error === "string") return error;
  return error.message || "Something went wrong.";
}

/** A recoverable error surface with a retry action. Never a dead end. */
export function ErrorState({
  title = "Couldn't load this",
  error,
  onRetry,
  retrying = false,
  className,
  compact = false,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-destructive/25 bg-destructive/5 text-center",
        compact ? "px-4 py-6" : "px-6 py-12",
        className,
      )}
    >
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {messageFor(error)}
      </p>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={onRetry}
          disabled={retrying}
        >
          <RotateCw className={cn("h-3.5 w-3.5", retrying && "animate-spin")} />
          {retrying ? "Retrying" : "Try again"}
        </Button>
      )}
    </div>
  );
}
