import { useMemo } from 'react';
import { highlightLog } from '../log-highlight.cjs';

// What each kind of log line looks like is the stylesheet's, by the line's
// kind: the classification is in log-highlight.cjs, and the colours are the
// design system's (#557). Colour is never the only signal — the words `Fatal
// error`, `Warning`, `Deprecated` stay in the text, and the severity is a
// re-statement of them, so nothing is lost without colour vision.
//
// The `[11-Aug-2026 …]` every debug.log line opens with is worth keeping —
// it is how two runs of the same request are told apart — but it is the same
// 26 characters on every line, so it is the last thing that should catch the
// eye.

// A log pane, painted. Memoised on the text because a running dev server streams
// chunks into it: without this, an unrelated SiteRow re-render re-splits the
// whole buffer. Only the tail is turned into per-line spans (see
// MAX_HIGHLIGHTED_LINES); everything older is one plain string, so the element
// count stays flat however long the server runs.
export function LogText({ text }) {
  const painted = useMemo(() => highlightLog(text), [text]);
  if (!painted) return null;
  return (
    <>
      {painted.head}
      {painted.lines.map((line, index) => (
        // A log line has no identity beyond its position, and lines only ever
        // arrive at the end.
        <span key={index} className={`log-line is-${line.kind}`}>
          {line.stamp ? <span className="log-stamp">{line.stamp}</span> : null}
          {/* A blank line still has to occupy one, same as in the diff pane. */}
          {line.stamp === '' && line.text === '' ? ' ' : line.text}
        </span>
      ))}
    </>
  );
}
