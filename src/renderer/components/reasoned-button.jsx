import { Button, Tooltip } from '@wordpress/components';

// A button that explains itself while disabled (#409). A reason disables it
// the accessible way: still in the tab order, `aria-disabled` rather than
// `disabled` so assistive technology reads it, the sentence as its
// description and as a tooltip. `title` would do neither, since Chromium
// shows no tooltip on a disabled control.
//
// The Tooltip is rendered whether or not there is a reason, and with no text
// it renders its anchor and no popover. The conditional version returned two
// different element types at the same position, so React remounted the
// button every time the gate flipped — which throws away exactly what
// `accessibleWhenDisabled` buys, since a keyboard user who just activated
// the control has the focused element destroyed under them and focus falls
// back to the document. `disabled` is passed through for gates that need no
// sentence (an empty input, not a blocked action).
export function ReasonedButton({ reason, disabled, children, ...props }) {
  return (
    <Tooltip text={reason || undefined} placement="bottom">
      <Button
        {...props}
        disabled={reason ? true : disabled}
        accessibleWhenDisabled={Boolean(reason)}
        description={reason || undefined}
      >{children}</Button>
    </Tooltip>
  );
}
