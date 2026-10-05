import { __ } from '@wordpress/i18n';
import { Button, Text } from '@wordpress/ui';
import { mailRow, noMailNote, smtpNote } from '../site-mail.cjs';

// A site's mail in the tray (#558): the mail its WordPress sent, which the
// app caught instead of letting out, newest first, and under the list where
// the mail server is listening. A row opens its mail in the dialog, which is
// the site's view's to draw.
//
// It holds no state: `mail` is what use-site-mail.jsx returns. `hidden` is
// the tray showing something else.
export function MailPanel({ hidden, mail }) {
  const emails = mail.emails || [];
  return (
    <div className="tray-panel" hidden={hidden}>
      {emails.length ? (
        <ul className="mail-list">
          {emails.map((email) => {
            const row = mailRow(email);
            return (
              <li key={email.id}>
                <button type="button" className="mail-row" onClick={() => mail.open(email)}>
                  <span className="mail-when">{row.when}</span>
                  <span className="mail-from">{row.from}</span>
                  <span className="mail-subject">{row.subject}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mail-list">
          <Text variant="body-md" className="muted-label mail-empty">{noMailNote()}</Text>
        </div>
      )}
      <div className="tray-notes">
        <Text variant="body-sm" className="muted-label">{smtpNote(mail.smtpPort)}</Text>
      </div>
    </div>
  );
}

// What is done to the whole list, in the tray's heading beside the button
// that closes it: emptying it, which empties what the app keeps of it too.
// There is nothing to press while there is nothing to clear.
export function MailTrayActions({ mail }) {
  return (
    <Button variant="minimal" tone="neutral" size="compact" disabled={!(mail.emails && mail.emails.length)} onClick={mail.clear}>
      {__('Clear emails')}
    </Button>
  );
}
