import { useMemo } from 'react';
import { highlightDiff } from '../diff-highlight.cjs';

// What each kind of patch line looks like (#166). The classification is in
// diff-highlight.cjs; the colours are here because they are a property of this
// pane, not of a diff. Added and removed lines carry a wash as well as a
// foreground colour so the two are still distinguishable without colour vision
// — the sign in column 0 is the other half of that, and it is never hidden.
const DIFF_LINE_STYLES = {
  add: { color: '#7ee787', background: 'rgba(46,160,67,0.18)' },
  del: { color: '#ffa198', background: 'rgba(248,81,73,0.18)' },
  hunk: { color: '#d2a8ff' },
  meta: { color: '#79c0ff' },
  header: { color: '#8b949e', fontStyle: 'italic' },
  context: {}
};

// The patch, painted. An empty line still needs to occupy one: `\n` is appended
// per line rather than joining, so the last line of a patch that ends in a
// newline does not silently gain or lose one.
//
// Memoised on the text, because this renders inside SiteRow — which re-renders
// on every chunk a running dev server or watch task streams into its log. The
// patch has not changed; without this, each chunk re-splits it and hands React
// thousands of fresh spans to reconcile, on the same thread that has to paint
// the log.
export function DiffText({ text }) {
  const lines = useMemo(() => highlightDiff(text), [text]);
  if (!lines) return text;
  return lines.map((line, index) => (
    // A diff line has no identity beyond its position, and the whole pane is
    // replaced when the patch changes.
    <span key={index} style={{ display: 'block', ...DIFF_LINE_STYLES[line.kind] }}>
      {line.text || ' '}
    </span>
  ));
}
