import { Button, TextControl } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { Text } from '@wordpress/ui';
import { Destination } from './destination.jsx';
import { ReasonedButton } from './reasoned-button.jsx';

// "Attach to Trac": the destination that saves the patch and opens the
// ticket's attach page for the contributor to upload it themselves.
//
// It needs a ticket. With one, it is a single button. Without one, it asks for
// it in place, and that is the same linking the ticket's own card does: the
// same input, the same gate, the same refusal, and the same things said back
// while a link is under way or has a question to ask first. So none of that is
// this component's. The caller owns the ticket being typed and what linking
// does, and hands in what the link says back as `children`, the very elements
// the ticket's card shows, so the two cannot come to say different things.
export function TracDestination({
  ticket,
  saveDisabled,
  onSave,
  ticketInput,
  onTicketInputChange,
  onLinkTicket,
  linking,
  linkReason,
  ticketError,
  children
}) {
  return (
    <Destination
      title={__('Attach to Trac')}
      cost={__('A WordPress.org account — needed anyway, for props and to comment.')}
      after={__('No automated checks. Often followed by a request to open a pull request.')}
    >
      {ticket ? (
        <Button variant="primary" onClick={onSave} disabled={saveDisabled}>
          {
            // translators: %d: a Trac ticket number.
            sprintf(__('Save, then open #%d'), ticket)
          }
        </Button>
      ) : (
        <>
          <Text variant="body-sm" className="muted-label">
            {__('No ticket is linked to this site, so there is nowhere to attach it yet.')}
          </Text>
          <TextControl
            value={ticketInput}
            onChange={onTicketInputChange}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onLinkTicket(); } }}
            disabled={Boolean(linkReason)}
            placeholder={__('Ticket number or URL, e.g. 62281')}
            aria-label={__('Trac ticket number or URL')}
          />
          <ReasonedButton
            variant="secondary"
            onClick={onLinkTicket}
            isBusy={linking}
            reason={linkReason}
            disabled={!ticketInput.trim()}
          >{__('Link ticket')}</ReasonedButton>
          {ticketError ? <Text variant="body-sm" className="problem-text" role="alert">{ticketError}</Text> : null}
          {children}
        </>
      )}
    </Destination>
  );
}
