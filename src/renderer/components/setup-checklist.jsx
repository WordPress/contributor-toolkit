import { useId } from 'react';
import { check, closeSmall } from '@wordpress/icons';
import { Badge, Button, Card, Icon, Notice, Spinner, Stack, Text } from '@wordpress/ui';
import { setupStepBadge, setupStepLabel } from '../setup-steps.cjs';

// A notice that is on the page as the page is drawn, or says itself through
// its role, says nothing of its own.
const SILENT = '';

// What stands for a step's state beside its name: a tick for one that is
// done, a cross for one that failed, the spinner for the one under way.
function StepMark({ status, running }) {
  if (status === 'complete') return <Icon icon={check} size={20} />;
  if (status === 'failed') return <Icon icon={closeSmall} size={20} />;
  if (running) return <Spinner />;
  return null;
}

/**
 * The checklist a new site is set up by (#246, #557): the clone, the
 * install, the build, and the dev server that ends it. Each step says how it
 * stands and has the button that does it, or does it again.
 *
 * It draws what it is given. How each step stands and what it says of
 * itself are decided in setup-steps.cjs.
 *
 * @param {Object}   props
 * @param {Array}    props.steps   The steps: `{ key, label, description, status, running, action }` each.
 * @param {?string}  props.cueId   The next-action cue's id, to mark the step it points at.
 * @param {?Object}  props.running The setup running by itself: `{ title, body, onStop }`, or null.
 * @param {boolean}  props.stopped The setup was stopped before it ended.
 * @param {Function} props.onSkip  Leaves the checklist for the site's own view.
 */
export function SetupChecklist({ steps, cueId, running, stopped, onSkip }) {
  const titleId = useId();
  return (
    <Card.Root className="setup-checklist" render={<section aria-labelledby={titleId} />}>
      <Card.Header render={<Stack direction="column" gap="xs" />}>
        <Card.Title id={titleId} render={<h2 />}>Initial setup checklist</Card.Title>
        <Text variant="body-md" className="muted-label">Complete each step to prepare this site for development.</Text>
      </Card.Header>
      <Card.Content render={<Stack direction="column" gap="md" />}>
        {/* Nobody pressed a button to start this, so the notice has to say
            what is happening, how far along it is and how to stop it — that
            is the whole licence for running unattended. */}
        {running ? (
          <Notice.Root intent="info" role="status" spokenMessage={SILENT}>
            <Notice.Title>{running.title}</Notice.Title>
            <Notice.Description>{running.body}</Notice.Description>
            <Notice.Actions>
              <Button variant="outline" tone="neutral" size="compact" onClick={running.onStop}>Stop setup</Button>
            </Notice.Actions>
          </Notice.Root>
        ) : null}
        {!running && stopped ? (
          <Notice.Root intent="warning" spokenMessage={SILENT}>
            <Notice.Title>Setup stopped.</Notice.Title>
            <Notice.Description>Nothing was lost — pick it back up with the buttons below whenever you want.</Notice.Description>
          </Notice.Root>
        ) : null}
        <ol className="setup-steps">
          {steps.map((step) => {
            const stepCue = `setup-${step.key}`;
            return (
              <li
                key={step.key}
                data-next-action={stepCue}
                className={['setup-step', `is-${step.status}`, cueId === stepCue ? 'next-action-cue' : ''].filter(Boolean).join(' ')}
              >
                <span className="setup-step-mark" aria-hidden="true"><StepMark status={step.status} running={step.running} /></span>
                <Stack direction="column" gap="xs" className="setup-step-body">
                  <Stack direction="row" align="center" gap="sm" wrap="wrap">
                    <Text variant="body-md" className="setup-step-label">{step.label}</Text>
                    <Badge intent={setupStepBadge(step.status)}>{setupStepLabel(step.status, step.running)}</Badge>
                  </Stack>
                  <Text variant="body-sm" className="muted-label">{step.description}</Text>
                </Stack>
                {step.action ? <div className="setup-step-action">{step.action}</div> : null}
              </li>
            );
          })}
        </ol>
        <Stack direction="row">
          <Button variant="minimal" tone="neutral" size="compact" onClick={onSkip}>Skip initialization wizard</Button>
        </Stack>
      </Card.Content>
    </Card.Root>
  );
}
