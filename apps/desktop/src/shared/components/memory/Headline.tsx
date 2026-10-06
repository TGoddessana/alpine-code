/**
 * A memory's line as the agent wrote it, with `code` in backticks shown in the code font rather than as backticks.
 * Nothing else of Markdown: a line is short, and the agent sees the same text.
 */
export function Headline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((part, i) =>
        /^`[^`]+`$/.test(part) ? (
          <code key={i} className="font-mono text-meta">
            {part.slice(1, -1)}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}
