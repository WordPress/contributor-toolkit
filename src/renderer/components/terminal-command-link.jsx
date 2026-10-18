import { Link } from '@wordpress/ui';

// A command named in the hints under the Terminal (#182). Clicking it types the
// command at the prompt and stops there — running it is the contributor's
// keypress, so the hint teaches where these commands live instead of becoming a
// second, hidden set of build buttons. Rendered as plain text while something is
// running, since prefilling then would land in the middle of live output.
//
// Drawn as a link and made of a button: it goes nowhere, it types.
export function TerminalCommandLink({ command, onPrefill, disabled }) {
  if (disabled) return <code>{command}</code>;
  return (
    <Link render={<button type="button" />} className="link-button command-link" onClick={() => onPrefill(command)}>{command}</Link>
  );
}
