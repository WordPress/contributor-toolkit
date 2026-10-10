import { useId } from 'react';
import { __ } from '@wordpress/i18n';
import { Badge, Button, Card, InputControl, Link, Notice, Spinner, Stack, Text } from '@wordpress/ui';
import { attachmentRows, attachmentsStatus, pullRequestRows, pullRequestsStatus, ticketCardWords, ticketFacts } from '../ticket-card.cjs';
import { ReasonedUiButton } from './reasoned-button.jsx';

// The way to a page outside the app, drawn as a link. It is a button: the
// main process opens the page, and the window itself has nowhere to go.
function OutLink({ url, onOpen, children, ...props }) {
  return (
    <Link render={<button type="button" />} className="link-button" onClick={() => onOpen(url)} {...props}>{children}</Link>
  );
}

// A section's heading, and the button that reads its list again where there
// is one to read. The card has two of them, so each is named for its list:
// the word it shows and then its section's heading, the two as they are on
// screen, so that the name begins with what is seen in any language.
function SectionHead({ title, refresh = null }) {
  const headingId = useId();
  const buttonId = useId();
  return (
    <Stack direction="row" align="center" justify="space-between" gap="md">
      <Text id={headingId} variant="heading-lg" render={<h3 />}>{title}</Text>
      {refresh ? (
        <Button id={buttonId} aria-labelledby={`${buttonId} ${headingId}`} variant="minimal" tone="neutral" size="compact" loading={refresh.loading} loadingAnnouncement={refresh.announcement} onClick={refresh.onRefresh}>
          {__('Refresh')}
        </Button>
      ) : null}
    </Stack>
  );
}

function Waiting({ children }) {
  return (
    <Stack direction="row" align="center" gap="sm">
      <Spinner />
      <Text variant="body-md">{children}</Text>
    </Stack>
  );
}

// The button that reads a patch before it is applied. Every row has one and
// one read runs at a time, so all of them are held while any is reading.
function ApplyButton({ apply, row, item }) {
  if (apply.hidden) return null;
  return (
    <Stack direction="row">
      <Button variant="outline" tone="neutral" size="compact" loading={apply.fetching === row.key} disabled={apply.disabled || apply.fetching !== null} onClick={() => apply.onApply(item)}>
        {__('Apply…')}
      </Button>
    </Stack>
  );
}

// What Trac said of the ticket, under its number.
function Facts({ facts, onOpen }) {
  return (
    <>
      {facts.status || facts.facts.length ? (
        <Stack direction="row" align="center" gap="sm" wrap="wrap">
          {facts.status ? <Badge intent={facts.status.intent}>{facts.status.label}</Badge> : null}
          <Text variant="body-md" className="muted-label">
            {facts.facts.map((fact, index) => (
              <span key={fact.id} title={fact.title || undefined}>
                {index ? ' · ' : ''}
                {fact.url ? <OutLink url={fact.url} onOpen={onOpen} tone="neutral">{fact.text}</OutLink> : fact.text}
              </span>
            ))}
          </Text>
        </Stack>
      ) : null}
      {facts.keywords.length ? (
        <Text variant="body-md" className="muted-label">
          {__('Keywords:')}
          {facts.keywords.map((keyword) => (
            <span key={keyword.label}>
              {' '}
              {keyword.url ? <OutLink url={keyword.url} onOpen={onOpen} tone="neutral">{keyword.label}</OutLink> : keyword.label}
            </span>
          ))}
        </Text>
      ) : null}
    </>
  );
}

function PullRequests({ words, pullRequests, sectionRef, onOpen }) {
  const status = pullRequestsStatus({ list: pullRequests.list, loading: pullRequests.loading });
  const items = pullRequests.list && Array.isArray(pullRequests.list.items) ? pullRequests.list.items : [];
  const rows = pullRequestRows({ items, latest: pullRequests.latest, appliedNumber: pullRequests.appliedNumber });
  return (
    <Stack ref={sectionRef} direction="column" gap="sm">
      <SectionHead
        title={__('Linked pull requests')}
        refresh={{ loading: pullRequests.loading, announcement: __('Checking GitHub'), onRefresh: pullRequests.onRefresh }}
      />
      <Text variant="body-md" className="muted-label">{words.pullRequestsLead}</Text>
      {status.checking ? <Waiting>{__('Checking GitHub…')}</Waiting> : null}
      {status.empty ? <Text variant="body-md" className="muted-label">{words.noPullRequests}</Text> : null}
      {status.failure ? (
        <Notice.Root intent="warning">
          <Notice.Title>{status.failure.reason}</Notice.Title>
          <Notice.Description>{status.failure.fallback}</Notice.Description>
        </Notice.Root>
      ) : null}
      {rows.length ? (
        <ul className="ticket-pr-list">
          {rows.map((row, index) => (
            <li key={row.key} className="ticket-pr">
              <Stack direction="column" gap="sm">
                <Stack direction="row" align="center" gap="sm" wrap="wrap">
                  <Text variant="body-md" className="ticket-pr-id">{row.id}</Text>
                  <Badge intent={row.state.intent}>{row.state.label}</Badge>
                  {row.latest ? <Badge intent="informational">{__('Latest')}</Badge> : null}
                  {row.applied ? <Badge intent="stable">{__('Applied')}</Badge> : null}
                </Stack>
                <Text variant="body-md">
                  <OutLink url={row.url} onOpen={onOpen}>{row.title || row.id}</OutLink>
                </Text>
                {row.date ? <Text variant="body-md" className="muted-label">{row.date}</Text> : null}
                <ApplyButton apply={pullRequests.apply} row={row} item={items[index]} />
              </Stack>
            </li>
          ))}
        </ul>
      ) : null}
    </Stack>
  );
}

// Trac's alone: a GitHub issue carries no attachments, its work arrives as
// the pull requests above.
function Attachments({ attachments, onOpen }) {
  const status = attachmentsStatus({ result: attachments.result, loading: attachments.loading, count: attachments.items.length });
  const rows = attachmentRows({ items: attachments.items, latest: attachments.latest });
  return (
    <Stack direction="column" gap="sm">
      <SectionHead
        title={__('Trac attachments')}
        refresh={attachments.result ? { loading: attachments.loading, announcement: __('Opening the ticket on Trac'), onRefresh: attachments.onLoad } : null}
      />
      <Text variant="body-md" className="muted-label">
        {__('Patch files are sometimes attached on Trac instead of a PR. Reading them opens the ticket so you can pass its human-check once.')}
      </Text>
      {status.unread ? (
        <Stack direction="row">
          <Button variant="outline" tone="neutral" size="compact" disabled={attachments.loadDisabled} onClick={attachments.onLoad}>
            {__('Show Trac attachments')}
          </Button>
        </Stack>
      ) : null}
      {status.reading ? <Waiting>{__('Opening the ticket on Trac…')}</Waiting> : null}
      {status.none ? <Text variant="body-md" className="muted-label">{__('No patch files attached to this ticket.')}</Text> : null}
      {status.failure ? (
        // Told what to say, as it is written: left to read it out of its
        // own markup, the notice would say an "&" in an error as "&amp;".
        <Notice.Root intent="warning" spokenMessage={status.failure}>
          <Notice.Description>{status.failure}</Notice.Description>
        </Notice.Root>
      ) : null}
      {rows.length ? (
        <ul className="ticket-pr-list">
          {rows.map((row, index) => (
            <li key={row.key} className="ticket-pr">
              <Stack direction="column" gap="sm">
                <Stack direction="row" align="center" gap="sm" wrap="wrap">
                  <Text variant="body-md" className="ticket-pr-id">
                    <OutLink url={row.url} onOpen={onOpen}>{row.name}</OutLink>
                  </Text>
                  {row.latest ? <Badge intent="informational">{__('Latest')}</Badge> : null}
                </Stack>
                {row.meta ? <Text variant="body-md" className="muted-label">{row.meta}</Text> : null}
                <ApplyButton apply={attachments.apply} row={row} item={attachments.items[index]} />
              </Stack>
            </li>
          ))}
        </ul>
      ) : null}
    </Stack>
  );
}

/**
 * The work-item card (#557): the Trac ticket or the GitHub issue the site is
 * working on. With none linked it is where one is linked; with one linked it
 * says what the ticket is and lists the work that already exists on it, its
 * pull requests and, on Trac, its attachments.
 *
 * It draws what it is given. Its words, and what each list says besides its
 * rows, are decided in ticket-card.cjs. What a link, a switch or a move onto
 * trunk says back (`feedback`), the note about uncommitted changes
 * (`changesNote`) and the checked-out pull request's banner (`banner`) are
 * the site's view's, made there and placed here.
 *
 * @param {Object}   props
 * @param {Object}   props.cue                The next-action cue's props for this card.
 * @param {string}   props.provider           'trac' or 'github-issue'.
 * @param {?number}  props.ticketId           The linked ticket or issue, or null.
 * @param {string}   props.ticketUrl          Where it lives, when one is linked.
 * @param {Function} props.onOpen             Opens a page outside the app, given its address.
 * @param {Object}   props.link               Linking: `{ value, onChange, onSubmit, saving, reason, browseUrl }`.
 * @param {Object}   props.unlink             Unlinking: `{ onUnlink, reason }`.
 * @param {?Object}  props.details            The ticket's facts, on Trac: `{ info, loading, onRead }`. Null where there are none to read.
 * @param {?Object}  props.staleNotice        The ticket being behind trunk: `{ title, body, action, busy, reason, onAction }`, or null.
 * @param {*}        props.feedback
 * @param {*}        props.changesNote
 * @param {*}        props.banner
 * @param {Object}   props.pullRequests       `{ list, loading, onRefresh, latest, appliedNumber, apply }`.
 * @param {Object}   props.pullRequestsRef    Put on the pull requests' section, which "try another patch" scrolls to.
 * @param {?Object}  props.attachments        On Trac: `{ result, loading, items, latest, onLoad, loadDisabled, apply }`. Null elsewhere.
 * @param {boolean}  props.latestIsAttachment The ticket's most recent patch is a file on Trac.
 */
export function TicketCard({ cue, provider, ticketId, ticketUrl, onOpen, link, unlink, details, staleNotice, feedback, changesNote, banner, pullRequests, pullRequestsRef, attachments, latestIsAttachment }) {
  const words = ticketCardWords(provider);
  const titleId = useId();
  const cardClass = ['ticket-card', cue.className].filter(Boolean).join(' ');

  if (!ticketId) {
    return (
      <Card.Root {...cue} className={cardClass} render={<section aria-labelledby={titleId} />}>
        <Card.Header render={<Stack direction="column" gap="xs" />}>
          <Card.Title id={titleId} render={<h2 />}>{words.title}</Card.Title>
          <Text variant="body-md" className="muted-label">{words.linkPrompt}</Text>
        </Card.Header>
        <Card.Content render={<Stack direction="column" gap="md" />}>
          {banner}
          <div className="inline-field">
            <InputControl
              label={words.fieldLabel}
              placeholder={words.fieldExample}
              value={link.value}
              disabled={Boolean(link.reason)}
              onChange={(event) => link.onChange(event.currentTarget.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); link.onSubmit(); } }}
            />
            <ReasonedUiButton variant="outline" tone="neutral" loading={link.saving} loadingAnnouncement={words.linking} reason={link.reason} disabled={!link.value.trim()} onClick={link.onSubmit}>
              {words.linkAction}
            </ReasonedUiButton>
          </div>
          {/* Expectation-setting, not the warning itself: since #234 the app
              asks before moving or discarding anything, so this only has to
              be true, not load-bearing. Said without asking the worktree, so
              it costs nothing. */}
          <Text variant="body-sm" className="muted-label">
            {__('If you have edited anything already, you will be asked what should happen to those edits.')}
          </Text>
          {feedback}
        </Card.Content>
        <footer className="card-footer">
          <hr className="card-divider" />
          <div className="card-footer-content">
            {/* Two sentences side by side, set apart by the row and not by
                a space typed between them. */}
            <Stack direction="row" gap="xs" wrap="wrap">
              <Text variant="body-md">{__('Not sure yet?')}</Text>
              <Text variant="body-md">
                <OutLink url={link.browseUrl} onOpen={onOpen}>{words.browse}</OutLink>
              </Text>
            </Stack>
          </div>
        </footer>
      </Card.Root>
    );
  }

  const facts = details ? ticketFacts(details.info) : null;
  return (
    <Card.Root {...cue} className={cardClass} render={<section aria-labelledby={titleId} />}>
      <Card.Header>
        <Stack direction="row" align="baseline" justify="space-between" gap="md" wrap="wrap">
          <Card.Title id={titleId} render={<h2 />}>{words.title}</Card.Title>
          <ReasonedUiButton variant="minimal" tone="neutral" size="compact" reason={unlink.reason} onClick={unlink.onUnlink}>
            {__('Unlink')}
          </ReasonedUiButton>
        </Stack>
      </Card.Header>
      <Card.Content render={<Stack direction="column" gap="xl" />}>
        {banner}
        <Stack direction="column" gap="sm">
          {/* The number is what the site is for once one is linked, and under
              #108 it also names the branch it is on. */}
          <Text variant="heading-md" render={<h3 />}>
            <OutLink url={ticketUrl} onOpen={onOpen} title={words.open}>
              <span>{`#${ticketId}`}</span>
              {facts && facts.summary ? <> {facts.summary}</> : null}
            </OutLink>
          </Text>
          {facts ? <Facts facts={facts} onOpen={onOpen} /> : null}
          {details && !details.info ? (
            <Stack direction="row">
              <Button variant="outline" tone="neutral" size="compact" loading={details.loading} loadingAnnouncement={__('Reading the ticket on Trac')} onClick={details.onRead}>
                {__('Read details from Trac')}
              </Button>
            </Stack>
          ) : null}
          {staleNotice ? (
            // The notice is told what to say. Left to say what is in it, it
            // would try to render its button outside the page to read it,
            // fail, and say nothing: the button's tooltip has no meaning
            // there.
            <Notice.Root intent="warning" spokenMessage={`${staleNotice.title} ${staleNotice.body}`}>
              <Notice.Title>{staleNotice.title}</Notice.Title>
              <Notice.Description>{staleNotice.body}</Notice.Description>
              <Notice.Actions>
                {/* Rewrites the tree when the ticket is checked out, so the
                    same gate as a discard: nothing running over the files.
                    Every branch of that gate has a sentence (#409). */}
                <ReasonedUiButton variant="outline" tone="neutral" size="compact" loading={staleNotice.busy} reason={staleNotice.reason} onClick={staleNotice.onAction}>
                  {staleNotice.action}
                </ReasonedUiButton>
              </Notice.Actions>
            </Notice.Root>
          ) : null}
          {feedback}
          {changesNote}
        </Stack>

        <hr className="card-divider" />
        <PullRequests words={words} pullRequests={pullRequests} sectionRef={pullRequestsRef} onOpen={onOpen} />

        {latestIsAttachment ? (
          <Notice.Root intent="info">
            <Notice.Description>
              {__('The most recent patch on this ticket is a file attachment, not a pull request — see Trac attachments below.')}
            </Notice.Description>
          </Notice.Root>
        ) : null}

        {attachments ? (
          <>
            <hr className="card-divider" />
            <Attachments attachments={attachments} onOpen={onOpen} />
          </>
        ) : null}
      </Card.Content>
    </Card.Root>
  );
}
