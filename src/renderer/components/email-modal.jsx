import { Modal, TabPanel } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

function formatEmailDate(email) {
  if (email.sentAt) return new Date(email.sentAt).toLocaleString();
  if (email.date) return new Date(email.date).toLocaleString();
  return '';
}

// What goes in front of every mail's HTML part. The mail's own markup follows
// it and wins wherever it says otherwise.
//
// The style is the look a mail had when it was drawn in the dialog's own
// document: the app's font and size, and the box's padding, which the frame
// fills edge to edge. A mail is written for a white page, so it is drawn in
// the light scheme in either theme, the way a mail client draws one: a white
// page and dark text by default. That is said here rather than left to
// Chromium, which paints a white page behind a frame in a dark window only
// while the two schemes differ.
//
// The <base> is for links. A link with no target would load its address in
// the frame itself, the frame may not load it, and the mail would be replaced
// by an empty page. Aimed at a new window, which the frame may not open
// either, the link does nothing and the mail stays where it is.
const MAIL_DEFAULTS = '<base target="_blank"><style>:root{color-scheme:light;padding:12px}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px}</style>';

// One mail the site sent, opened from the list under "Mail": who it is from
// and to, and the message in two forms, as a reader would see it and as it was
// sent. It holds no state of its own. Whoever renders it owns which mail is
// open, and renders it only while one is, so every mail opens on the rendered
// form whatever tab the last one was left on.
//
// A mail's markup is written by whatever sent it, never by the app, so its
// HTML part is not put in the app's document. It is drawn in a frame that is
// allowed nothing (the empty `sandbox`): no scripts, no forms, no new windows,
// and no navigating the window it sits in. Its links, its forms, its <base>
// and its styles end at the frame's edge. The frame is a `srcdoc` one, so it
// inherits this window's content security policy as well, and nothing in it
// loads from the network.
export function EmailModal({ email, onClose }) {
  return (
    <Modal
      title={email.subject || __('Email')}
      onRequestClose={onClose}
      shouldCloseOnClickOutside
      isFullScreen
    >
      <div className="email-view">
        <div className="email-view-headers">
          <div><strong>{__('From:')}</strong> {email.from || ''}</div>
          <div><strong>{__('To:')}</strong> {email.to || ''}</div>
          {email.cc ? (<div><strong>{__('CC:')}</strong> {email.cc}</div>) : null}
          <div><strong>{__('Date:')}</strong> {formatEmailDate(email)}</div>
        </div>
        <TabPanel
          className="email-tabs"
          activeClass="is-active"
          tabs={[
            // translators: The tab that shows an email as a reader would see it.
            { name: 'rendered', title: __('Rendered') },
            // translators: The tab that shows an email as it was sent, headers and all.
            { name: 'raw', title: __('Raw') }
          ]}
        >
          {(tab)=> tab.name==='rendered' ? (
            <div className={email.html ? 'email-view-rendered is-framed' : 'email-view-rendered'}>
              {email.html ? (
                <iframe
                  title={__('Mail')}
                  sandbox=""
                  className="email-view-frame"
                  srcDoc={MAIL_DEFAULTS + String(email.html)}
                />
              ) : (
                <pre>{email.text || ''}</pre>
              )}
            </div>
          ) : (
            <pre className="email-view-raw">{email.raw || email.text || ''}</pre>
          )}
        </TabPanel>
      </div>
    </Modal>
  );
}
