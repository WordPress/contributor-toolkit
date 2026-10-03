import { useId } from 'react';
import { Card, Stack, Text } from '@wordpress/ui';
import { StepList } from './step-list.jsx';

/**
 * An update of trunk under way (#94, #557): which step it is on, of how
 * many, and each of them.
 *
 * It draws what it is given. The plan, how each step stands and what a
 * skipped one says are decided in update-plan.cjs.
 *
 * @param {Object} props
 * @param {Object} props.cue    The next-action cue's props for this card.
 * @param {Array}  props.rows   The steps: `{ key, label, status }` each.
 * @param {string} props.count  Where it is: "step 2 of 3".
 * @param {string} [props.note] What is worth knowing about the step it is on, or ''.
 */
export function TrunkUpdateCard({ cue, rows, count, note = '' }) {
  const titleId = useId();
  return (
    <Card.Root {...cue} className={['trunk-update-card', cue.className].filter(Boolean).join(' ')} render={<section aria-labelledby={titleId} />}>
      <Card.Header>
        <Stack direction="row" align="baseline" justify="space-between" gap="md" wrap="wrap">
          <Card.Title id={titleId} render={<h2 />}>Updating to latest trunk</Card.Title>
          <Text variant="body-sm" className="muted-label">{count}</Text>
        </Stack>
      </Card.Header>
      <Card.Content render={<Stack direction="column" gap="md" />}>
        <StepList rows={rows} />
        {note ? <Text variant="body-sm" className="muted-label">{note}</Text> : null}
      </Card.Content>
    </Card.Root>
  );
}
