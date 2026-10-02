import { useId } from 'react';
import { Button, Tooltip } from '@wordpress/components';
import { Button as UiButton, Tooltip as UiTooltip } from '@wordpress/ui';

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

// The same, for the design system's button (#557). That button is held the
// accessible way without being asked: disabled, it stays in the tab order and
// says `aria-disabled`. What is added here is the reason. The tooltip is for
// the eye and the hidden sentence is the button's description, since a
// tooltip of the design system describes nothing to a screen reader by
// itself. Hidden outright, and not only from the eye: a description is read
// from wherever it is, and a sentence left in the reading order would be
// read a second time after the button. Both are always rendered, for the reason above: the button must
// not be remounted as the gate flips.
export function ReasonedUiButton({ reason, disabled, children, ...props }) {
  const reasonId = useId();
  return (
    <UiTooltip.Root disabled={!reason}>
      <UiTooltip.Trigger
        render={
          <UiButton
            {...props}
            disabled={reason ? true : disabled}
            aria-describedby={reason ? reasonId : undefined}
          />
        }
      >{children}</UiTooltip.Trigger>
      <UiTooltip.Popup>{reason}</UiTooltip.Popup>
      <span id={reasonId} hidden>{reason || ''}</span>
    </UiTooltip.Root>
  );
}
