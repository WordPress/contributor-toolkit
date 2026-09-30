import { Button } from '@wordpress/components';

// A command named in the hints under the Terminal (#182). Clicking it types the
// command at the prompt and stops there — running it is the contributor's
// keypress, so the hint teaches where these commands live instead of becoming a
// second, hidden set of build buttons. Rendered as plain text while something is
// running, since prefilling then would land in the middle of live output.
export function TerminalCommandLink({ command, onPrefill, disabled }) {
  if (disabled) return <code>{command}</code>;
  return (
    <Button
      variant="link"
      onClick={() => onPrefill(command)}
      style={{ fontSize: 12, fontFamily: 'monospace', height: 'auto' }}
    >{command}</Button>
  );
}
