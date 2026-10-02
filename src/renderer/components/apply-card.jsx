import { useId, useState } from 'react';
import { __ } from '@wordpress/i18n';
import { check } from '@wordpress/icons';
import { Badge, Button, Card, CollapsibleCard, Dialog, Icon, InputControl, Notice, Spinner, Stack, Tabs, Text } from '@wordpress/ui';
import { applyCardWords, applyFailureWords, applyStepRows, checkoutNoticeIntent, conflictFileRows, previewWords } from '../apply-card.cjs';
import { pullRequestState } from '../ticket-card.cjs';
import { ReasonedUiButton } from './reasoned-button.jsx';

// Every notice here is told what to say, or told to say nothing. Left to
// itself the design system's notice reads its own content out, and with a
// button in it that reading can fail without a word (#557, the ticket card).
// The ones that were alerts or status regions before still are, by their
// role, and say nothing a second time; the ones that said nothing still say
// nothing.
const SILENT = '';

// Where a pull request is asked for, by its address or its number.
function PullRequestField({ words, entry }) {
  return (
    <Stack direction="column" gap="sm">
      <div className="inline-field">
        <InputControl
          label={words.prLabel}
          value={entry.value}
          disabled={entry.disabled}
          onChange={(event) => entry.onChange(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); entry.onSubmit(); } }}
        />
        <Button variant="outline" tone="neutral" disabled={entry.disabled || !entry.value.trim()} onClick={entry.onSubmit}>
          {words.prAction}
        </Button>
      </div>
      <Text variant="body-sm" className="muted-label">{words.prHelp}</Text>
    </Stack>
  );
}

// The two ways in. A project that takes patch files has a tab for each; one
// that does not has the pull request's field and nothing to choose between.
function Entry({ words, entry, tab, onTab }) {
  if (!words.fileTab) return <PullRequestField words={words} entry={entry} />;
  return (
    <Tabs.Root value={tab} onValueChange={onTab} render={<Stack direction="column" gap="md" />}>
      <div className="card-tabs-bar">
        <Tabs.List variant="minimal" className="card-tabs">
          <Tabs.Tab value="pr">{words.prTab}</Tabs.Tab>
          <Tabs.Tab value="file">{words.fileTab}</Tabs.Tab>
        </Tabs.List>
        <hr className="card-divider" />
      </div>
      <Tabs.Panel value="pr" tabIndex={-1}>
        <PullRequestField words={words} entry={entry} />
      </Tabs.Panel>
      <Tabs.Panel value="file" tabIndex={-1}>
        <Stack direction="column" gap="sm">
          {/* The file is chosen in the system's own dialog, which the main
              process opens: a page cannot be told where a file is. */}
          <Stack direction="row">
            <Button variant="outline" tone="neutral" disabled={entry.disabled} onClick={entry.onChooseFile}>
              {words.fileAction}
            </Button>
          </Stack>
          <Text variant="body-sm" className="muted-label">{words.fileHelp}</Text>
        </Stack>
      </Tabs.Panel>
    </Tabs.Root>
  );
}

// The steps of an apply under way. The one being done has the spinner, and
// is the one a screen reader is told is current.
function Progress({ progress }) {
  return (
    <ol {...progress.cue} className={['apply-steps', progress.cue.className].filter(Boolean).join(' ')}>
      {applyStepRows(progress.steps, progress.states).map((row) => (
        <li key={row.key} className={`apply-step is-${row.status}`} aria-current={row.status === 'current' ? 'step' : undefined}>
          <span className="apply-step-mark" aria-hidden="true">
            {row.status === 'complete' ? <Icon icon={check} size={16} /> : null}
            {row.status === 'current' ? <Spinner /> : null}
          </span>
          <Text variant="body-md">{row.label}</Text>
        </li>
      ))}
    </ol>
  );
}

// The two ways out of a patch that cannot be lifted back out, or that would
// not go on: keep a copy of the work, then put the ticket back to its base.
function LayerExits({ exits }) {
  return (
    <>
      <Button variant="outline" tone="neutral" size="compact" disabled={exits.blocked} onClick={exits.onSaveCopy}>{__('Save a copy of your work')}</Button>
      <Button variant="minimal" tone="neutral" size="compact" disabled={exits.blocked} onClick={exits.onDiscard}>{__('Discard this ticket to its base')}</Button>
    </>
  );
}

// A patch that is applied now: what it is, and the way to take it off.
function AppliedPatch({ applied }) {
  const { layer } = applied;
  return (
    <Notice.Root intent={layer.canRevert ? 'success' : 'warning'} spokenMessage={SILENT}>
      <Notice.Title>{layer.label} {layer.summary}</Notice.Title>
      <Notice.Description render={<div />}>
        <Stack direction="column" gap="xs">
          <span>{__('This patch is applied to your current work. Removing it may require undoing overlapping edits.')}</span>
          {applied.watchMessage ? <span>{applied.watchMessage}</span> : null}
          {layer.explanation ? <span>{layer.explanation}</span> : null}
          {layer.detail.map((line) => <span key={line} className="apply-break-all">{line}</span>)}
          {layer.note ? <span>{layer.note}</span> : null}
          {/* Both exits report failure through state the changes note and
              the review own, and neither is on screen here, so a save that
              could not write, or a discard that refused, would be a button
              that did nothing on the one way out this notice recommends. */}
          {applied.exits.message ? <span role="alert" className="apply-failed-text">{applied.exits.message}</span> : null}
        </Stack>
      </Notice.Description>
      <Notice.Actions>
        {layer.canRevert ? (
          <Button variant="outline" tone="neutral" size="compact" disabled={applied.revertDisabled} onClick={applied.onRevert}>{__('Revert this patch')}</Button>
        ) : null}
        {layer.offerCopy ? <LayerExits exits={applied.exits} /> : null}
      </Notice.Actions>
    </Notice.Root>
  );
}

// One file a patch could not change all of: how much of it, and each place.
function ConflictFile({ item }) {
  const file = conflictFileRows(item);
  return (
    <Stack direction="column" gap="xs">
      <Text variant="body-sm" className="apply-conflict-file">{file.heading}</Text>
      {file.regions.map((region) => (
        // By index and not by line: a patch made of several can carry two
        // changes that start on the same line.
        <div key={region.key} className="apply-conflict-region">
          {/* A line to search for and not a line number, where the patch
              gave one: copied into the editor's search, it lands on the
              place. */}
          {region.anchor ? (
            <Stack direction="row" align="baseline" gap="xs" wrap="wrap">
              <Text variant="body-sm">{__('Near')}</Text>
              <code className="apply-break-all">{region.anchor}</code>
            </Stack>
          ) : <Text variant="body-sm">{region.where}</Text>}
          {region.reason ? <Text variant="body-sm">{region.reason}</Text> : null}
          {/* The lines themselves, because a place alone cannot answer what
              decides the next ten minutes: is this the change that matters,
              or reformatting that came with it. */}
          {region.lines ? <pre className="apply-conflict-lines">{region.lines}</pre> : null}
          {region.more ? <Text variant="body-sm">{region.more}</Text> : null}
        </div>
      ))}
    </Stack>
  );
}

// An apply that failed: what went wrong, where the patch did not fit, and
// what can be done about it.
function Failure({ failure }) {
  const words = applyFailureWords({ error: failure.error, conflict: failure.conflict, kind: failure.kind });
  const { conflict } = failure;
  const hasActions = conflict && (conflict.offerOtherPatches || conflict.offerDiscardToBase || (conflict.prUrl && conflict.prButton));
  return (
    <Notice.Root intent="error" role="alert" spokenMessage={SILENT}>
      <Notice.Title>{words.headline}</Notice.Title>
      {words.untouched || conflict ? (
        <Notice.Description render={<div />}>
          <Stack direction="column" gap="sm">
            {words.untouched ? <span>{words.untouched}</span> : null}
            {conflict ? conflict.items.map((item, index) => (
              // By index: the breakdown is a fixed list, drawn once per failure,
              // and two of its notes can say the same.
              item.kind === 'note' ? <span key={index}>{item.text}</span> : <ConflictFile key={index} item={item} />
            )) : null}
            {conflict && conflict.advice ? <span>{conflict.advice}</span> : null}
            {conflict && conflict.offerDiscardToBase && failure.exits.message ? <span>{failure.exits.message}</span> : null}
          </Stack>
        </Notice.Description>
      ) : null}
      {hasActions ? (
        <Notice.Actions>
          {conflict.offerDiscardToBase ? <LayerExits exits={failure.exits} /> : null}
          {conflict.offerOtherPatches ? (
            <Button variant="outline" tone="neutral" size="compact" onClick={failure.onTryAnother}>{__('Try another patch on this ticket')}</Button>
          ) : null}
          {conflict.prUrl && conflict.prButton ? (
            <Button variant="outline" tone="neutral" size="compact" onClick={() => failure.onOpen(conflict.prUrl)}>{conflict.prButton}</Button>
          ) : null}
        </Notice.Actions>
      ) : null}
      <Notice.CloseIcon onClick={failure.onDismiss} />
    </Notice.Root>
  );
}

/**
 * The apply card (#557): where a pull request or a patch file is brought
 * into the checkout to be tried. It asks for one, shows the steps while one
 * is applied, says what is applied now with the way to take it off, and
 * says why one would not go on.
 *
 * What a patch would change is shown before it is applied, in
 * `ApplyPreviewDialog`. The card can be folded away; while it has anything
 * to say besides its two fields it stays open.
 *
 * @param {Object}  props
 * @param {boolean} props.patchFiles Whether the project takes patch files as well as pull requests.
 * @param {?Object} props.entry      Asking for one: `{ value, onChange, onSubmit, onChooseFile, disabled }`. Null while there is nothing to ask.
 * @param {?Object} props.applied    A patch applied now: `{ layer, watchMessage, onRevert, revertDisabled, exits }`, the first from applied-layer.cjs.
 * @param {?Object} props.progress   An apply under way: `{ steps, states, cue }`.
 * @param {?Object} props.failure    An apply that failed: `{ error, kind, conflict, exits, onDismiss, onTryAnother, onOpen }`.
 * @param {?Object} props.notice     Something that was settled along the way: `{ text, onDismiss }`.
 */
export function ApplyCard({ patchFiles, entry, applied, progress, failure, notice }) {
  const words = applyCardWords(patchFiles);
  const titleId = useId();
  // Folded by whoever is using it, and only by them: with something to say
  // the card is open whatever they chose, and goes back to their choice
  // when it has been said.
  const [folded, setFolded] = useState(false);
  // Which way in is open is the card's to remember: the fields go while a
  // patch is applied, and come back on the tab they were left on.
  const [tab, setTab] = useState('pr');
  const speaking = Boolean(applied || progress || failure || notice);
  return (
    <CollapsibleCard.Root
      className="apply-card"
      open={speaking || !folded}
      onOpenChange={(open) => { if (!speaking) setFolded(!open); }}
      render={<section aria-labelledby={titleId} />}
    >
      <CollapsibleCard.Header>
        <Stack direction="column" gap="xs">
          <Card.Title id={titleId} render={<h2 />}>{words.title}</Card.Title>
          <CollapsibleCard.HeaderDescription>{words.description}</CollapsibleCard.HeaderDescription>
        </Stack>
      </CollapsibleCard.Header>
      <CollapsibleCard.Content>
        <Stack direction="column" gap="md">
          {applied ? <AppliedPatch applied={applied} /> : null}
          {progress ? <Progress progress={progress} /> : null}
          {failure ? <Failure failure={failure} /> : null}
          {notice ? (
            // It reports something already settled, so it has outlived its
            // use once it has been read, and nothing else here takes it
            // down until the next patch.
            <Notice.Root intent="info" role="status" spokenMessage={SILENT}>
              <Notice.Description>{notice.text}</Notice.Description>
              <Notice.CloseIcon onClick={notice.onDismiss} />
            </Notice.Root>
          ) : null}
          {entry ? <Entry words={words} entry={entry} tab={tab} onTab={setTab} /> : null}
        </Stack>
      </CollapsibleCard.Content>
    </CollapsibleCard.Root>
  );
}

/**
 * What a pull request or a patch file would change, shown before it is
 * applied (#557): the files, anything that changes what applying it means,
 * and the button that applies it.
 *
 * It is open while there is a preview and closes when the preview goes,
 * whether it was cancelled or applied. What it showed is kept while it
 * closes, so that it does not empty itself on the way out.
 *
 * @param {Object}   props
 * @param {?Object}  props.preview       What the main process read of the patch, or null.
 * @param {?Object}  props.pr            What `describePrPreview` says of it, for a pull request.
 * @param {string[]} props.warnings      Whose work the patch would land on, as sentences.
 * @param {string}   props.cueId         The next step this preview is, for the cue to find. A dialog needs no ring drawn round it.
 * @param {boolean}  props.applyDisabled Something else is working on the checkout.
 * @param {Function} props.onApply
 * @param {Function} props.onCancel
 */
export function ApplyPreviewDialog({ preview, pr, warnings, cueId, applyDisabled, onApply, onCancel }) {
  const [last, setLast] = useState(null);
  if (preview && (!last || last.preview !== preview)) setLast({ preview, pr, warnings });
  const view = preview ? { preview, pr, warnings } : last;
  const words = view ? previewWords({ preview: view.preview, pr: view.pr }) : null;
  const state = view && view.pr && view.preview.prState ? pullRequestState(view.preview.prState) : null;
  return (
    <Dialog.Root open={Boolean(preview)} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <Dialog.Popup size="small" className="apply-preview-dialog">
        {words ? (
          <>
            <Dialog.Header>
              <Dialog.Title>{words.title}</Dialog.Title>
              <Dialog.CloseIcon />
            </Dialog.Header>
            <Dialog.Content>
              <Stack data-next-action={cueId} direction="column" gap="md">
                <Stack direction="row" align="center" gap="sm" wrap="wrap">
                  <Text variant="body-md">{words.headline}</Text>
                  {state ? <Badge intent={state.intent}>{state.label}</Badge> : null}
                </Stack>
                {words.closedNote ? <Text variant="body-sm">{words.closedNote}</Text> : null}
                <ul className="change-list">
                  {view.preview.paths.map((path) => (
                    <li key={path}><Text variant="body-sm"><code>{path}</code></Text></li>
                  ))}
                </ul>
                {/* Whose the work is that the patch would land on (#306). */}
                {view.warnings.length ? (
                  <Notice.Root intent="warning" role="alert" spokenMessage={SILENT}>
                    <Notice.Description render={<div />}>
                      <Stack direction="column" gap="xs">
                        {view.warnings.map((sentence) => <span key={sentence}>{sentence}</span>)}
                      </Stack>
                    </Notice.Description>
                  </Notice.Root>
                ) : null}
                {words.skipped ? <Text variant="body-sm">{words.skipped}</Text> : null}
                {words.installNote ? <Text variant="body-sm">{words.installNote}</Text> : null}
              </Stack>
            </Dialog.Content>
            <Dialog.Footer>
              <Dialog.Action variant="outline" tone="neutral">{__('Cancel')}</Dialog.Action>
              <Button disabled={applyDisabled} onClick={onApply}>{words.action}</Button>
            </Dialog.Footer>
          </>
        ) : null}
      </Dialog.Popup>
    </Dialog.Root>
  );
}

/**
 * A pull request that is checked out now (#557), in the work-item card:
 * that it is, whether the site is built around it, what became of the work
 * that was there, and the way back.
 *
 * @param {Object}   props
 * @param {Object}   props.cue      The next-action cue's props for the checkout.
 * @param {Object}   props.banner   What `appliedBannerState` says: `{ tone, title, body, revertReason }`.
 * @param {Object}   props.checkout What `describePrCheckout` says: `{ body, edits, backLabel }`.
 * @param {Function} props.onRevert
 */
export function PrCheckoutNotice({ cue, banner, checkout, onRevert }) {
  return (
    <Notice.Root {...cue} intent={checkoutNoticeIntent(banner.tone)} spokenMessage={SILENT}>
      <Notice.Title>{banner.title}</Notice.Title>
      <Notice.Description render={<div />}>
        <Stack direction="column" gap="xs">
          {banner.body ? <span>{banner.body}</span> : null}
          <span>{checkout.body} {checkout.edits}</span>
          <span>{__('Revert this PR before applying another PR or patch file.')}</span>
        </Stack>
      </Notice.Description>
      <Notice.Actions>
        <ReasonedUiButton variant="outline" tone="neutral" size="compact" reason={banner.revertReason} onClick={onRevert}>
          {checkout.backLabel}
        </ReasonedUiButton>
      </Notice.Actions>
    </Notice.Root>
  );
}
