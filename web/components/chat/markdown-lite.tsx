import * as React from "react";

/**
 * A tiny markdown renderer for assistant replies: bold, inline code, bullet
 * and numbered lists, headings-as-bold and line breaks. Deliberately no
 * dependency and no HTML pass-through; everything renders as React text.
 */

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={i}
          className="rounded bg-background/70 px-1 py-0.5 font-mono text-[0.85em]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "h"; text: string };

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "p", lines: paragraph });
      paragraph = [];
    }
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^\s*#{1,4}\s+(.*)$/.exec(line);

    if (line.trim() === "") {
      flush();
    } else if (bullet) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.kind === "ul") last.items.push(bullet[1]);
      else blocks.push({ kind: "ul", items: [bullet[1]] });
    } else if (numbered) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.kind === "ol") last.items.push(numbered[1]);
      else blocks.push({ kind: "ol", items: [numbered[1]] });
    } else if (heading) {
      flush();
      blocks.push({ kind: "h", text: heading[1] });
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

export function MarkdownLite({ text }: { text: string }) {
  const blocks = React.useMemo(() => parseBlocks(text), [text]);

  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        if (block.kind === "h") {
          return (
            <p key={i} className="font-semibold">
              {renderInline(block.text)}
            </p>
          );
        }
        if (block.kind === "ul") {
          return (
            <ul key={i} className="list-disc space-y-1 pl-4">
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.kind === "ol") {
          return (
            <ol key={i} className="list-decimal space-y-1 pl-4">
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={i}>
            {block.lines.map((line, j) => (
              <React.Fragment key={j}>
                {j > 0 && <br />}
                {renderInline(line)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
