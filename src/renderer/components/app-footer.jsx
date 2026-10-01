import { Button as LinkButton, Dropdown } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/ui';

/**
 * The bar along the bottom of the window (#555).
 *
 * Its left half is where the trays' toggles go once there are trays (#558),
 * and its right half holds what is about the app rather than about a site.
 * For now that is the way to give feedback. The button says what the form is
 * and who reads it before anything leaves the app, since the form is on the
 * web and a contributor should know that before they are sent there.
 *
 * @param {Object}   props
 * @param {Function} props.onOpenFeedbackForm Opens the form in the browser.
 */
export function AppFooter({ onOpenFeedbackForm }) {
  return (
    <footer className="app-footer">
      <div className="app-footer-actions" />
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
