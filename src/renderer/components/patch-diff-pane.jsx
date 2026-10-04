import { Button, Spinner } from '@wordpress/components';
import { Stack, Text } from '@wordpress/ui';
import { copy as copyIcon, check as checkIcon, download } from '@wordpress/icons';
import { DiscardChangesLink } from './discard-changes-link.jsx';
import { DiffText } from './diff-text.jsx';

// The left column of "Review & submit changes": the contributor's own diff,
// with what can be done to it as a whole. Save it to a file, copy it, or throw
// the changes away.
//
// It holds no state. The diff, whether it is still being generated, and what
// the last save, copy and discard came to are the caller's, because the same
// patch feeds the destinations beside this pane and the same discard is
// offered from the ticket's note. This is how they look here.
export function PatchDiffPane({
  heading,
  description,
  patchText,
  patchLoading,
  patchLoadFailed,
  patchSaved,
  patchSaveError,
  copyLabel,
  copied,
  discardReason,
  discardError,
  onSave,
  onCopy,
  onDiscard
}) {
  return (
    <div className="patch-diff">
      <Stack direction="row" align="flex-start" justify="space-between" gap="md" wrap="wrap">
        <Stack direction="column" gap="xs">
          <Stack direction="row" align="baseline" gap="xs" wrap="wrap">
            <Text variant="heading-md">{heading}</Text>
            <Text variant="body-sm">
              {'('}
              <DiscardChangesLink
                label="Discard all changes"
                onClick={onDiscard}
                reason={discardReason}
              />
              {')'}
            </Text>
          </Stack>
          <Text variant="body-sm" className="muted-label">{description}</Text>
          {discardError ? <Text variant="body-sm" className="problem-text">{discardError}</Text> : null}
        </Stack>
        {/*
          Out of the diff and into the header: these used to float
          over the top-right of the code, which was survivable at
          full width and covers the first line of a hunk once the
          pane is a column.
        */}
        <Stack direction="row" gap="sm">
          <Button variant="secondary" icon={download} onClick={onSave} disabled={patchLoading || patchLoadFailed}>Save</Button>
          <Button
            variant="secondary"
            icon={copied ? checkIcon : copyIcon}
            onClick={onCopy}
            disabled={patchLoading || patchLoadFailed}
            // The label carries the outcome rather than a tooltip or
            // a toast: it is the thing that was just pressed, so it
            // is where the eye already is, and a screen reader
            // announces the change on the focused control.
          >{copyLabel}</Button>
        </Stack>
      </Stack>
      {/*
        Under the diff rather than beside the destinations that
        trigger it: this is the outcome for the file, the file is
        what this column is, and the header's own Save button needs
        somewhere to report even when there are no destinations to
        show.
      */}
      {patchSaved ? (
        <Text variant="body-md" className="success-text">Saved to {patchSaved}</Text>
      ) : null}
      {patchSaveError ? (
        <Text variant="body-md" className="problem-text" role="alert">Could not save the patch: {patchSaveError}</Text>
      ) : null}
      <div className="patch-diff-body">
        {patchLoading ? (
          <Stack direction="column" align="center" justify="center" gap="lg" className="patch-diff-loading">
            <Spinner />
            <Text variant="body-lg" className="muted-label">Generating patch...</Text>
          </Stack>
        ) : (
          // Its height, and why its padding is counted in it, are in
          // shell.css under `.patch-diff-code`.
          <pre className="patch-diff-code">
            {patchText && patchText.trim().length ? <DiffText text={patchText} /> : 'No changes.'}
          </pre>
        )}
      </div>
    </div>
  );
}
