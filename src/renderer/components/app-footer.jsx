import { Button as LinkButton, Dropdown, createSlotFill } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { listView, preformatted } from '@wordpress/icons';
import { Badge, Button, IconButton, VisuallyHidden } from '@wordpress/ui';
import { unseenLinesNote } from '../debug-log.cjs';
import { TRAY_ID } from './bottom-tray.jsx';

// What each tray's button is drawn with.
const TRAY_ICONS = { terminal: preformatted, logs: listView };

// The footer is the window's and what the Logs button has to say is a site's,
// the same split as the tray's (#558): the footer leaves a slot on the button
// and the open site fills it. The slot is the button's description, so what
// is put in it is read with the button and not only drawn on it.
const { Fill, Slot } = createSlotFill('LogsToggleNote');
const LOGS_TOGGLE_NOTE_ID = 'tray-toggle-logs-note';

/**
 * How many of a site's debug.log lines arrived unseen, on the footer's Logs
 * button: with the tray closed the tab that counts them is not on screen, and
 * a PHP error would arrive with nothing to show for it. The number is drawn
 * on the button's corner, and the words that say what it counts are the
 * button's description. Rendered by the site that is open, and nothing when
 * every line has been seen.
 *
 * @param {Object} props
 * @param {number} props.count The lines not yet seen.
 */
export function LogsToggleNote({ count }) {
  const note = unseenLinesNote(count);
  if (!note) return null;
  return (
    <Fill>
      <Badge intent="informational" aria-hidden="true">{note.badge}</Badge>
      <VisuallyHidden render={<span />}>{note.note}</VisuallyHidden>
    </Fill>
  );
}

/**
 * The id of a tray's button, so that closing the tray from inside it can put
 * the focus back on the button that opened it.
 *
 * @param {string} tray The tray's id.
 * @return {string} The button's id.
 */
export function trayToggleId(tray) {
  return `tray-toggle-${tray}`;
}

/**
 * The bar along the bottom of the window (#555).
 *
 * Its left half holds a button for each tray (#558), pressed while its tray
 * is the open one; the Logs button also says how many lines of the open
 * site's debug.log have not been seen. Its right half holds what is about
 * the app rather than about a site. For now that is the way to give
 * feedback. The button says what the form is and who reads it before
 * anything leaves the app, since the form is on the web and a contributor
 * should know that before they are sent there.
 *
 * `trays` is what the tray can hold (tray.cjs), and is empty in a window
 * with no site, where there is nothing to put in one.
 *
 * @param {Object}      props
 * @param {Object[]}    [props.trays]            The trays to offer.
 * @param {string|null} [props.activeTray]       The tray that is open, if any.
 * @param {Function}    [props.onToggleTray]     Called with a tray's id when its button is pressed.
 * @param {Function}    props.onOpenFeedbackForm Opens the form in the browser.
 */
export function AppFooter({ trays = [], activeTray = null, onToggleTray, onOpenFeedbackForm }) {
  return (
    <footer className="app-footer">
      <div className="app-footer-actions">
        {trays.map((tray) => (
          <div key={tray.id} className="app-footer-tray">
            <IconButton
              id={trayToggleId(tray.id)}
              icon={TRAY_ICONS[tray.id]}
              label={tray.toggle}
              variant="minimal"
              tone="neutral"
              size="compact"
              aria-pressed={activeTray === tray.id}
              aria-controls={TRAY_ID}
              aria-describedby={tray.id === 'logs' ? LOGS_TOGGLE_NOTE_ID : undefined}
              onClick={() => onToggleTray(tray.id)}
            />
            {tray.id === 'logs' ? <Slot bubblesVirtually id={LOGS_TOGGLE_NOTE_ID} className="app-footer-tray-note" /> : null}
          </div>
        ))}
      </div>
      <div className="app-footer-meta">
        <Dropdown
          popoverProps={{ placement: 'top-end', offset: 8 }}
          renderToggle={({ isOpen, onToggle }) => (
            <Button
              variant="minimal"
              tone="neutral"
              size="compact"
              onClick={onToggle}
              aria-expanded={isOpen}
              aria-haspopup="dialog"
            >
              {__('Give feedback')}
            </Button>
          )}
          renderContent={({ onClose }) => (
            <div className="app-footer-feedback">
              <div className="app-footer-feedback-title">{__('Give feedback')}</div>
              <p>{__('Your feedback helps decide what to build next.')}</p>
              <p>{__('Responses go into a shared form the team reviews regularly. Submissions are anonymous unless you add your email.')}</p>
              <LinkButton
                variant="link"
                onClick={() => {
                  onClose();
                  onOpenFeedbackForm();
                }}
              >
                {__('Open the feedback form ↗')}
              </LinkButton>
            </div>
          )}
        />
      </div>
    </footer>
  );
}
