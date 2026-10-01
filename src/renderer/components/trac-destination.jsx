import { Button, TextControl } from '@wordpress/components';
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
      title="Attach to Trac"
      cost="A WordPress.org account — needed anyway, for props and to comment."
      after="No automated checks. Often followed by a request to open a pull request."
    >
      {ticket ? (
        <Button variant="primary" onClick={onSave} disabled={saveDisabled} style={{ justifyContent:'center' }}>
          Save, then open #{ticket}
        </Button>
      ) : (
        <>
          <div style={{ fontSize:12, color:'#6c6f72' }}>
            No ticket is linked to this site, so there is nowhere to attach it yet.
          </div>
          <TextControl
            value={ticketInput}
            onChange={onTicketInputChange}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onLinkTicket(); } }}
            disabled={Boolean(linkReason)}
            placeholder="Ticket number or URL, e.g. 62281"
            aria-label="Trac ticket number or URL"
          />
          <ReasonedButton
            variant="secondary"
            onClick={onLinkTicket}
            isBusy={linking}
            reason={linkReason}
            disabled={!ticketInput.trim()}
            style={{ justifyContent:'center' }}
          >Link ticket</ReasonedButton>
          {ticketError ? <div role="alert" style={{ color:'#d63638', fontSize:12 }}>{ticketError}</div> : null}
          {children}
        </>
      )}
    </Destination>
  );
}
