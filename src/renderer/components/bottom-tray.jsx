import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createSlotFill } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { closeSmall } from '@wordpress/icons';
import { IconButton, Stack, Text } from '@wordpress/ui';
import { DEFAULT_TRAY_HEIGHT, clampTrayHeight, trayHeightForKey, trayHeightLimits } from '../tray.cjs';

// The tray belongs to the window, and what is in it belongs to a site (#558),
// the same split as the page's header (#556). The window draws the tray and
// leaves a slot in it, and every site's view fills that slot with its own
// terminal, hidden unless the site is the open one.
//
// Every site's, and not only the open one's: a terminal is drawn in one
// element for as long as it lives, and it has to outlive the look at another
// site. For the same reason the tray is never taken off the page. Closed, it
// is hidden, with everything in it still there.
const { Fill, Slot } = createSlotFill('SiteTray');
// And beside the button that closes it, what is done to the whole of what
// the tray shows: the open site's too, and only for the tray that is open.
const { Fill: ActionsFill, Slot: ActionsSlot } = createSlotFill('SiteTrayActions');

/**
 * What a site puts in the tray.
 */
export const SiteTrayFill = Fill;

/**
 * What the open site puts in the tray's heading, beside the button that
 * closes it.
 */
export const SiteTrayActionsFill = ActionsFill;

// The id the footer's buttons name as what they control.
export const TRAY_ID = 'app-tray';

/**
 * The tray along the bottom of the window, above the footer: a heading, a
 * way to close it, an edge to drag, and whatever the open site put in it.
 *
 * It owns one thing, how tall it is. The height is kept for as long as the
 * window is open, whichever tray is showing, and is brought back inside its
 * limits when the window is made shorter. Which tray is open, and closing
 * it, are the window's.
 *
 * @param {Object}      props
 * @param {string|null} props.title   The open tray's heading, or null when none is open.
 * @param {Function}    props.onClose Closes the tray.
 */
export function BottomTray({ title, onClose }) {
  const open = Boolean(title);
  const [height, setHeight] = useState(DEFAULT_TRAY_HEIGHT);
  const [limits, setLimits] = useState(() => trayHeightLimits(window.innerHeight));
  const trayRef = useRef(null);
  // Where a drag started: the pointer, and the height the tray had then.
  const dragRef = useRef(null);
  // The one place the height is brought inside its limits: what was asked
  // for is kept as it was asked, and what is shown is what the window allows
  // now.
  const shown = clampTrayHeight(height, limits);

  useEffect(() => {
    const onResize = () => setLimits(trayHeightLimits(window.innerHeight));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // The height is a number only known while the app runs, so it is handed to
  // the stylesheet as a property of the tray's own, and the rule that uses it
  // is in shell.css with the rest.
  useLayoutEffect(() => {
    trayRef.current.style.setProperty('--app-tray-height', `${shown}px`);
  }, [shown]);

  // And how much of the window's foot the tray takes is said to the whole
  // document: the confirmations are drawn on `body`, in the corner the tray
  // comes up into, and stand that much higher while it is open.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--app-tray-inset', open ? `${shown}px` : '0px');
    return () => root.style.removeProperty('--app-tray-inset');
  }, [open, shown]);

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragRef.current = { y: event.clientY, height: shown };
    // Captured, so the drag goes on when the pointer leaves the edge, which
    // it does at once: the edge is a few pixels tall.
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  // A drag ends when the button is let go, and also when the edge loses the
  // pointer without that, as it does when the window is left mid-drag: the
  // pointer coming back across the edge must not go on moving it.
  const endDrag = () => {
    dragRef.current = null;
  };
  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    setHeight(drag.height + (drag.y - event.clientY));
  };
  const onKeyDown = (event) => {
    const next = trayHeightForKey(shown, event.key, limits);
    if (next === null) return;
    event.preventDefault();
    setHeight(next);
  };

  return (
    <aside id={TRAY_ID} ref={trayRef} className="app-tray" aria-label={title || undefined} hidden={!open}>
      {/* The top edge, as the splitter it is: dragged with a pointer, moved
          with the arrow keys, and saying how tall the tray is. A separator
          that takes the focus is a control, and the lint rule takes every
          separator for one that is not. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        className="app-tray-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label={__('Resize tray')}
        aria-controls={TRAY_ID}
        aria-valuenow={shown}
        aria-valuemin={limits.min}
        aria-valuemax={limits.max}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onKeyDown={onKeyDown}
      />
      <Stack direction="row" align="center" justify="space-between" gap="sm" className="app-tray-header">
        <Text variant="heading-lg" render={<h2 />} className="app-tray-title">{title}</Text>
        <Stack direction="row" align="center" gap="xs">
          <ActionsSlot bubblesVirtually className="app-tray-actions" />
          <IconButton icon={closeSmall} label={__('Close')} variant="minimal" tone="neutral" size="compact" onClick={onClose} />
        </Stack>
      </Stack>
      <Slot bubblesVirtually className="app-tray-body" />
    </aside>
  );
}
