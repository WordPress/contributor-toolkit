import { Modal, TabPanel } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

function formatEmailDate(email) {
  if (email.sentAt) return new Date(email.sentAt).toLocaleString();
  if (email.date) return new Date(email.date).toLocaleString();
  return '';
}

// One mail the site sent, opened from the list under "Mail": who it is from
// and to, and the message in two forms, as a reader would see it and as it was
// sent. It holds no state of its own. Whoever renders it owns which mail is
// open, and renders it only while one is, so every mail opens on the rendered
// form whatever tab the last one was left on.
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
            <div className="email-view-rendered">
              {email.html ? (
                <div dangerouslySetInnerHTML={{ __html: String(email.html) }} />
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
