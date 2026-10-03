import { useId } from 'react';
import { Card, Stack, Text } from '@wordpress/ui';
import { ReasonedUiButton } from './reasoned-button.jsx';

// One ticket with work on the site: its number, when it was last worked on,
// and the two things that can be done with it. Every row has the same two
// buttons, so each is named for its row: the words it shows and then the
// row's number, the two as they are on screen, so that the name begins with
// what is seen in any language.
function TicketRow({ row, words, reason, deleting, onSwitch, onDelete }) {
  const numberId = useId();
  const switchId = useId();
  const deleteId = useId();
  return (
    <li className="ticket-list-row">
      <Stack direction="column" gap="xs" className="ticket-list-ticket">
        <Text id={numberId} variant="body-md" className="ticket-list-number">{row.number}</Text>
        {row.timeLabel ? <Text variant="body-sm" className="muted-label">{row.timeLabel}</Text> : null}
      </Stack>
      <Stack direction="row" align="center" gap="sm" wrap="wrap">
        <ReasonedUiButton id={switchId} aria-labelledby={`${switchId} ${numberId}`} variant="outline" tone="neutral" size="compact" reason={reason} onClick={() => onSwitch(row)}>
          {words.action}
        </ReasonedUiButton>
        <ReasonedUiButton id={deleteId} aria-labelledby={`${deleteId} ${numberId}`} variant="minimal" tone="neutral" size="compact" loading={deleting === row.ref} loadingAnnouncement={words.removing} reason={reason} onClick={() => onDelete(row)}>
          {words.remove}
        </ReasonedUiButton>
      </Stack>
    </li>
  );
}

/**
 * The tickets that have work on the site (#108, #557), besides the one it is
 * on: each can be gone back to, or have its work deleted. A card of its own,
 * below the ticket in hand and the work that can be brought into it (#240).
 *
 * It draws what it is given. Which tickets are listed and in what order, and
 * what the card says, are decided in ticket-branch-list.cjs; with nothing to
 * list there are no words, and the site's view draws no card.
 *
 * @param {Object}   props
 * @param {Object}   props.words    What the card says: `{ heading, action, remove, removing }`.
 * @param {Array}    props.rows     The tickets, `{ ref, ticketId, number, timeLabel }` each.
 * @param {string}   props.reason   Why nothing can be done to a ticket just now, or ''.
 * @param {?string}  props.deleting The branch being deleted, or null.
 * @param {Function} props.onSwitch Goes to a row's ticket.
 * @param {Function} props.onDelete Deletes a row's work. It asks first.
 */
export function TicketListCard({ words, rows, reason, deleting, onSwitch, onDelete }) {
  const titleId = useId();
  return (
    <Card.Root className="ticket-list-card" render={<section aria-labelledby={titleId} />}>
      <Card.Header>
        <Card.Title id={titleId} render={<h2 />}>{words.heading}</Card.Title>
      </Card.Header>
      <Card.Content>
        <ul className="ticket-list">
          {rows.map((row) => (
            <TicketRow key={row.ref} row={row} words={words} reason={reason} deleting={deleting} onSwitch={onSwitch} onDelete={onDelete} />
          ))}
        </ul>
      </Card.Content>
    </Card.Root>
  );
}
