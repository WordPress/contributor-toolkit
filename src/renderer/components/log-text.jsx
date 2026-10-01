import { useMemo } from 'react';
import { highlightLog } from '../log-highlight.cjs';

// What each kind of log line looks like. Same split as the diff pane: the
// classification is in log-highlight.cjs, the colours are a property of this
// pane. Colour is never the only signal — the words `Fatal error`, `Warning`,
// `Deprecated` stay in the text, and the severity is a re-statement of them, so
// nothing is lost without colour vision.
const LOG_LINE_STYLES = {
  fatal: { color: '#ffa198' },
  warning: { color: '#ffb86c' },
  deprecated: { color: '#e3d16a' },
  notice: { color: '#e3d16a' },
  // Stack frames and node's "(Use `…`)" follow-ups: they belong to the line
  // above and are most of the volume in a full pane, so they recede.
  trace: { color: '#8b949e' },
  ready: { color: '#7ee787', fontWeight: 600 },
  plain: {}
};
// The `[11-Aug-2026 …]` every debug.log line opens with. It is worth keeping —
// it is how two runs of the same request are told apart — but it is the same 26
// characters on every line, so it is the last thing that should catch the eye.
const LOG_STAMP_STYLE = { color: '#6e7681' };

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
        <span key={index} style={{ display: 'block', ...LOG_LINE_STYLES[line.kind] }}>
          {line.stamp ? <span style={LOG_STAMP_STYLE}>{line.stamp}</span> : null}
          {/* A blank line still has to occupy one, same as in the diff pane. */}
          {line.stamp === '' && line.text === '' ? ' ' : line.text}
        </span>
      ))}
    </>
  );
}
