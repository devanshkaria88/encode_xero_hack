"use client";

import * as React from "react";
import { Upload, FileUp, ChevronDown, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { post, useAction, type Schemas } from "@/lib/api";
import { Button } from "@/components/ui/button";

/** Plural helper matching the card's copy. */
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function looksLikeIcs(text: string): boolean {
  return /BEGIN:VCALENDAR/i.test(text);
}

/**
 * The .ics fallback for the calendar: paste calendar text or choose a file,
 * then import it via POST /meetings/import-ics. This is the offline path when
 * Google Calendar OAuth isn't connected — same pipeline, same result.
 */
export function IcsImport({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [fileName, setFileName] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const importer = useAction((icsText: string) =>
    post<Schemas["SyncResultDto"]>("/meetings/import-ics", { icsText }),
  );

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Allow re-selecting the same file next time.
    e.target.value = "";
    if (!file) return;
    try {
      const content = await file.text();
      setText(content);
      setFileName(file.name);
      if (!looksLikeIcs(content)) {
        toast.warning("That doesn't look like an .ics file", {
          description: "Robyn expects a calendar file that starts with BEGIN:VCALENDAR.",
        });
      }
    } catch {
      toast.error("Couldn't read that file", {
        description: "Please try a different .ics file.",
      });
    }
  };

  const onImport = async () => {
    const icsText = text.trim();
    if (!icsText) return;
    try {
      const res = await importer.run(icsText);
      onImported();
      toast.success("Calendar imported", {
        description: `${plural(res.imported, "new event")}, ${res.updated} updated.`,
      });
      setText("");
      setFileName(null);
      setOpen(false);
    } catch (err) {
      toast.error("Couldn't import that calendar", {
        description:
          err instanceof Error && err.message
            ? err.message
            : "Check the .ics contents and try again.",
      });
    }
  };

  const clear = () => {
    setText("");
    setFileName(null);
  };

  const canImport = text.trim().length > 0 && !importer.isPending;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Upload className="h-3.5 w-3.5" aria-hidden="true" />
        Import an .ics file
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform duration-fast",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            Paste your calendar export below, or choose an .ics file. Robyn runs
            it through the same pipeline as a live calendar sync.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".ics,text/calendar"
              onChange={onPickFile}
              className="sr-only"
              aria-label="Choose an .ics calendar file"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={importer.isPending}
            >
              <FileUp className="h-3.5 w-3.5" />
              Choose file
            </Button>
            {fileName && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <span className="max-w-[14rem] truncate font-mono">
                  {fileName}
                </span>
              </span>
            )}
          </div>

          <label htmlFor="ics-text" className="sr-only">
            Paste .ics calendar text
          </label>
          <textarea
            id="ics-text"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (fileName) setFileName(null);
            }}
            placeholder="BEGIN:VCALENDAR&#10;VERSION:2.0&#10;..."
            spellCheck={false}
            rows={5}
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={onImport}
              disabled={!canImport}
            >
              {importer.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              {importer.isPending ? "Importing" : "Import calendar"}
            </Button>
            {text.length > 0 && !importer.isPending && (
              <Button type="button" variant="ghost" size="sm" onClick={clear}>
                <X className="h-3.5 w-3.5" />
                Clear
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
