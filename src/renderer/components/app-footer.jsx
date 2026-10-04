import { Button as LinkButton, Dropdown } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { listView, preformatted } from '@wordpress/icons';
import { Button, IconButton } from '@wordpress/ui';
import { TRAY_ID } from './bottom-tray.jsx';

// What each tray's button is drawn with.
const TRAY_ICONS = { terminal: preformatted, logs: listView };

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
 * is the open one, and its right half holds what is about the app rather
 * than about a site. For now that is the way to give feedback. The button
 * says what the form is and who reads it before anything leaves the app,
 * since the form is on the web and a contributor should know that before
 * they are sent there.
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
          <IconButton
            key={tray.id}
            id={trayToggleId(tray.id)}
            icon={TRAY_ICONS[tray.id]}
            label={tray.toggle}
            variant="minimal"
            tone="neutral"
            size="compact"
            aria-pressed={activeTray === tray.id}
            aria-controls={TRAY_ID}
            onClick={() => onToggleTray(tray.id)}
          />
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
