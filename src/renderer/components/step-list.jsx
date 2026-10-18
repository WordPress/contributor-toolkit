import { check } from '@wordpress/icons';
import { Icon, Spinner, Text } from '@wordpress/ui';

/**
 * The steps of something the app is doing in several (#557): an apply, an
 * update of trunk. The one being done has the spinner, and is the one a
 * screen reader is told is current; one that is done has a tick; one still
 * to come, or skipped, is said more quietly.
 *
 * @param {Object} props
 * @param {Array}  props.rows  One per step: `{ key, label, status }`, where `status` is 'complete', 'current', 'pending' or 'skipped'.
 * @param {Object} [props.cue] The next-action cue's props for the list, where it has one.
 */
export function StepList({ rows, cue = {} }) {
  return (
    <ol {...cue} className={['step-list', cue.className].filter(Boolean).join(' ')}>
      {rows.map((row) => (
        <li key={row.key} className={`step-list-step is-${row.status}`} aria-current={row.status === 'current' ? 'step' : undefined}>
          <span className="step-list-mark" aria-hidden="true">
            {row.status === 'complete' ? <Icon icon={check} size={16} /> : null}
            {row.status === 'current' ? <Spinner /> : null}
          </span>
          <Text variant="body-md">{row.label}</Text>
        </li>
      ))}
    </ol>
  );
}
