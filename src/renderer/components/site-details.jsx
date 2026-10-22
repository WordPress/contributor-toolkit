import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { __, sprintf } from '@wordpress/i18n';
// The tree the design system draws List View with: the rows a screen reader
// reads as a tree, and the arrow keys between them. Stable in use and not
// given its final export yet, like the segmented control.
// eslint-disable-next-line @wordpress/no-unsafe-wp-apis -- see above.
import { __experimentalTreeGrid as TreeGrid, __experimentalTreeGridCell as TreeGridCell, __experimentalTreeGridRow as TreeGridRow } from '@wordpress/components';
import { chevronDown, chevronRight, globe, offline, page, pencil, plus, seen, table, undo, unseen, wordpress } from '@wordpress/icons';
import { Button, EmptyState, Icon, IconButton, InputControl, Link, Notice, Stack, Text, Tooltip, VisuallyHidden } from '@wordpress/ui';
import { affectedFileTree, visibleAffectedRows } from '../affected-files.cjs';
import { siteDetailsRows } from '../site-details.cjs';
import { ProcessStatus } from './site-header-actions.jsx';
import { ReasonedUiButton } from './reasoned-button.jsx';

// A section's heading, with its process's dot and the button that starts and
// stops it. The button shows one word and is named by the whole of what it
// does, which is also what the header's menu calls it.
function SectionHeading({ title, process, onToggle }) {
  return (
    <Stack direction="row" align="center" justify="space-between" gap="md">
      <Stack direction="row" align="center" gap="sm">
        <ProcessStatus status={process.status} />
        <Text variant="heading-lg" render={<h2 />}>{title}</Text>
      </Stack>
      <Button
        variant="minimal"
        tone="neutral"
        size="compact"
        loading={process.pending}
        loadingAnnouncement={process.action}
        disabled={process.disabled}
        aria-label={process.action}
        onClick={onToggle}
      >
        {process.short}
      </Button>
    </Stack>
  );
}

function OfflinePlaceholder({ title }) {
  return (
    <div className="sidebar-empty-state">
      <EmptyState.Root>
        <EmptyState.Icon icon={offline} />
        <EmptyState.Title>{title}</EmptyState.Title>
      </EmptyState.Root>
    </div>
  );
}

// A link to somewhere on the running site. It is opened in the browser by the
// main process, and never followed here: this window shows the app and
// nothing else.
function ServerLink({ href, icon, onOpen, children }) {
  return (
    <Stack className="sidebar-link" direction="row" align="center" gap="xs">
      <Icon icon={icon} size={16} />
      <Link href={href} tone="neutral" onClick={(event) => { event.preventDefault(); onOpen(href); }}>
        {children}
      </Link>
    </Stack>
  );
}

// Which picture goes with which of the server's links.
const LINK_ICONS = { site: globe, admin: wordpress, database: table };

// The development server (#557): where the site is, once it has an address,
// and what to log in with. Which of the three things it shows is decided in
// site-processes.cjs.
function ServerSection({ server }) {
  const [showPassword, setShowPassword] = useState(false);
  const { section } = server;
  return (
    <Stack direction="column" gap="md">
      <SectionHeading title={__('Server')} process={server.process} onToggle={server.onToggle} />
      {section.state === 'online' ? (
        <Stack direction="column" gap="xl">
          <Stack direction="column" gap="sm">
            {section.links.map((link) => (
              <ServerLink key={link.id} href={link.href} icon={LINK_ICONS[link.id]} onOpen={server.onOpen}>{link.label}</ServerLink>
            ))}
          </Stack>
          <Stack direction="column" gap="md">
            <Text variant="heading-sm" render={<h3 />}>{__('Admin credentials')}</Text>
            <div className="credential-list">
              <Text variant="body-md" className="muted-label">{__('Username')}</Text>
              <Text variant="body-md">{section.credentials.username}</Text>
              <Text variant="body-md" className="muted-label">{__('Password')}</Text>
              <div className="credential-value">
                <Text variant="body-md">{showPassword ? section.credentials.password : '••••••••'}</Text>
                <IconButton
                  icon={showPassword ? unseen : seen}
                  label={showPassword ? __('Hide password') : __('Show password')}
                  variant="minimal"
                  tone="neutral"
                  size="small"
                  onClick={() => setShowPassword((current) => !current)}
                />
              </div>
            </div>
          </Stack>
        </Stack>
      ) : null}
      {section.state === 'starting' ? <Text variant="body-md" className="muted-label">{section.text}</Text> : null}
      {server.process.detail ? <Text variant="body-md" className="problem-text">{server.process.detail}</Text> : null}
      {section.state === 'offline' ? <OfflinePlaceholder title={__('Development server offline')} /> : null}
    </Stack>
  );
}

// The build watch (#557): what it is doing, in a sentence where there is one
// to say.
function WatchSection({ watch }) {
  return (
    <Stack direction="column" gap="md">
      <SectionHeading title={__('Build watch')} process={watch.process} onToggle={watch.onToggle} />
      {watch.process.detail ? <Text variant="body-md" className={watch.process.status === 'failed' ? 'problem-text' : 'muted-label'}>{watch.process.detail}</Text> : null}
      {watch.process.status === 'offline' ? <OfflinePlaceholder title={__('Build watch offline')} /> : null}
    </Stack>
  );
}

// The last test run's outcome. A run that counted tests is a Pass or a Fail;
// one that gave nothing to count (it did not start, was stopped, did not
// finish, or matched no tests) is a Notice that says which. Each is the
// design system's notice, whose icon gives it a shape as well as a colour,
// and which reads itself out when it appears, politely: a result is not an
// interruption. The command the run was is its last line, so the result
// and what produced it read as one. Before a run, and while one runs, it is
// a line of text, with the command under it once there is one.
const RUN_OUTCOMES = {
  pass: { intent: 'success', get title() { return __('Pass'); } },
  fail: { intent: 'error', get title() { return __('Fail'); } },
  notice: { intent: 'warning', get title() { return __('Notice'); } }
};

function RunOutcome({ lastRun }) {
  const outcome = RUN_OUTCOMES[lastRun.outcome];
  const command = lastRun.command ? <code>{lastRun.command}</code> : null;
  if (!outcome) {
    return (
      <Stack direction="column" gap="xs">
        <Text variant="body-md" role="status">{lastRun.text}</Text>
        {command ? <Text variant="body-sm" className="muted-label">{command}</Text> : null}
      </Stack>
    );
  }
  return (
    <Notice.Root intent={outcome.intent} politeness="polite">
      <Notice.Title>{outcome.title}</Notice.Title>
      <Notice.Description>{lastRun.text}</Notice.Description>
      {command ? <Notice.Description>{command}</Notice.Description> : null}
    </Notice.Root>
  );
}

// Where the Core Handbook explains core's PHPUnit tests, groups and filters
// among them.
const PHPUNIT_HANDBOOK_URL = 'https://make.wordpress.org/core/handbook/testing/automated-testing/phpunit/';

// The site's test suites, each run in the terminal, where their output is.
// One suite so far, core's PHP unit tests; more join it as each is proven to
// run without a host toolchain. `reason` holds every button while something
// rewrites the tree or holds the terminal. The dot and the sentence are the
// last run's (phpunit-result.cjs), with the command it was, since a ticket's
// tests passing says nothing about the rest. The sentence is a status, so a
// screen reader hears a run end without going to look. The Filter and Group
// fields add PHPUnit's flags of those names to a run, each only when it is
// filled in; Enter in either runs it. With both blank there is nothing to
// run that "Run all" does not already, so it starts nothing.
function TestsSection({ tests }) {
  const { lastRun } = tests;
  const phpHeadingId = useId();
  const lastRunHeadingId = useId();
  const groupsListId = useId();
  const [filter, setFilter] = useState('');
  // Group starts as the linked ticket's number, which PHPUnit treats as the
  // group of the tests written for it, and starts again whenever another
  // ticket is linked or this one unlinked. Reset while drawing, not in an
  // effect, so the field never shows the last ticket's number for a frame.
  const ticketGroup = tests.ticket ? String(tests.ticket) : '';
  const [group, setGroup] = useState(ticketGroup);
  const [groupTicket, setGroupTicket] = useState(ticketGroup);
  if (groupTicket !== ticketGroup) {
    setGroupTicket(ticketGroup);
    setGroup(ticketGroup);
  }
  const blank = !filter.trim() && !group.trim();
  let groupHint = __('A group such as ajax or restapi, or a ticket number.');
  if (tests.ticket) {
    // translators: %s: the number of the ticket linked to the site.
    groupHint = sprintf(__('A group such as ajax or restapi, or a ticket number, such as %s for this ticket.'), tests.ticket);
  }
  const runFiltered = () => {
    if (!tests.reason && !blank) tests.onRunFiltered({ filter, group });
  };
  const runOnEnter = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runFiltered();
    }
  };
  return (
    <Stack direction="column" gap="md">
      <Stack direction="row" align="center" gap="sm">
        <ProcessStatus status={lastRun.status} />
        <Text variant="heading-lg" render={<h2 />}>{__('Tests')}</Text>
      </Stack>
      <Stack direction="column" gap="md" role="group" aria-labelledby={phpHeadingId}>
        <Text id={phpHeadingId} variant="heading-sm" render={<h3 />}>{__('PHP unit tests')}</Text>
        <Stack direction="column" gap="sm" role="group" aria-label={__('Specific tests')}>
          <Text variant="body-sm" className="muted-label">{__('Run only the tests that match a name, a group, or both.')}</Text>
          <InputControl
            label={__('Filter')}
            description={__('Part of a test class or method name, such as wpAutop.')}
            placeholder="wpAutop"
            value={filter}
            onChange={(event) => setFilter(event.currentTarget.value)}
            onKeyDown={runOnEnter}
          />
          <InputControl
            label={__('Group')}
            description={groupHint}
            placeholder="ajax"
            list={groupsListId}
            value={group}
            onChange={(event) => setGroup(event.currentTarget.value)}
            onKeyDown={runOnEnter}
          />
          <datalist id={groupsListId}>
            {/* The linked ticket first, named as such: it is the group a
                contributor most often wants back after typing another. */}
            {ticketGroup ? <option value={ticketGroup} label={__('This ticket')} /> : null}
            {tests.groups.map((name) => <option key={name} value={name} />)}
          </datalist>
        </Stack>
        <Stack direction="column" gap="sm">
          <Stack direction="row" gap="sm" wrap="wrap">
            <ReasonedUiButton variant="outline" tone="neutral" size="compact" reason={tests.reason} disabled={blank} onClick={runFiltered}>
              {__('Run matching tests')}
            </ReasonedUiButton>
            <ReasonedUiButton variant="outline" tone="neutral" size="compact" reason={tests.reason} aria-label={__('Run all PHP unit tests')} onClick={tests.onRunAllPhp}>
              {__('Run all')}
            </ReasonedUiButton>
          </Stack>
          <Link href={PHPUNIT_HANDBOOK_URL} tone="neutral" onClick={(event) => { event.preventDefault(); window.api.openExternal(PHPUNIT_HANDBOOK_URL); }}>
            {__('How core\'s PHP unit tests are organised')}
          </Link>
        </Stack>
        {/* The results, set apart from the controls that produce them. */}
        <hr className="card-divider" />
        <Stack direction="column" gap="sm" role="group" aria-labelledby={lastRunHeadingId}>
          <Text id={lastRunHeadingId} variant="heading-md" render={<h4 />}>{__('Last run')}</Text>
          <RunOutcome lastRun={lastRun} />
        </Stack>
      </Stack>
    </Stack>
  );
}

// A file's revert button (#669). Held by the same guard as the discard, so
// it says why when it is held, as the discard link does (#409): the reason is
// its tooltip and, hidden, its description. The tooltip is always rendered,
// naming the button when nothing holds it, so the button is never remounted
// as the guard flips; see ReasonedUiButton. `itemProps` are the tree's, which
// put the button in the row's reach of the arrow keys.
function RevertButton({ path, reason, onClick, itemProps }) {
  const reasonId = useId();
  // translators: %s: the path of a file in the site.
  const label = sprintf(__('Revert %s'), path);
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <Button
            {...itemProps}
            variant="minimal"
            tone="neutral"
            size="small"
            aria-label={label}
            aria-describedby={reason ? reasonId : undefined}
            disabled={Boolean(reason)}
            onClick={onClick}
          />
        }
      >
        <Icon icon={undo} size={16} />
      </Tooltip.Trigger>
      <Tooltip.Popup>{reason || label}</Tooltip.Popup>
      <span id={reasonId} hidden>{reason || ''}</span>
    </Tooltip.Root>
  );
}

// One changed file's row in its tree: the page icon, the file's name, a mark
// after it, and in a cell of its own its revert button. The name is drawn as
// a link and built as a button, like the terminal's command links: a click
// opens an application rather than going anywhere. The brand colour and an
// underline, which a button does not get from the browser the way a link
// does: without them the names read as plain text. Its whole path is its
// tooltip, since the folder rows above it say where it is. The mark is an
// icon (#669), named for a screen reader and explained in a tooltip; it is
// outside the button, so the button's name stays the file's, and is the
// button's description, since only buttons are in the tree's reach of the
// arrow keys.
function ChangedFileRow({ row, file, onOpenFile, revertReason }) {
  const markId = useId();
  const { mark, onRevert } = file;
  return (
    <TreeGridRow data-key={row.key} level={row.level} positionInSet={row.positionInSet} setSize={row.setSize}>
      <TreeGridCell>
        {(itemProps) => (
          <span className="affected-files-row">
            <Icon icon={page} size={16} className="affected-files-icon" />
            <Link {...itemProps} render={<button type="button" />} className="link-button affected-file apply-break-all" tone="brand" title={row.path} aria-describedby={mark ? markId : undefined} onClick={() => onOpenFile(row.path)}>
              {row.name}
            </Link>
            {mark ? (
              <Tooltip.Root>
                <Tooltip.Trigger render={<span id={markId} role="img" aria-label={mark.label} className="affected-file-mark" />}>
                  <Icon icon={mark.icon} size={16} />
                </Tooltip.Trigger>
                <Tooltip.Popup>{mark.label}</Tooltip.Popup>
              </Tooltip.Root>
            ) : null}
          </span>
        )}
      </TreeGridCell>
      {onRevert ? (
        <TreeGridCell className="affected-files-revert-cell">
          {(itemProps) => <RevertButton path={row.path} reason={revertReason} onClick={onRevert} itemProps={itemProps} />}
        </TreeGridCell>
      ) : (
        <TreeGridCell withoutGridItem className="affected-files-revert-cell" />
      )}
    </TreeGridRow>
  );
}

// One group of changed files as a tree of the folders they sit in, each file
// opening in the editor with one click. Every folder starts open; its row's
// button, or the left and right arrows on it, close and open it.
function ChangedFileTree({ label, files, onOpenFile, revertReason }) {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const setOpen = useCallback((key, open) => setCollapsed((current) => {
    if (current.has(key) !== open) return current;
    const next = new Set(current);
    if (open) next.delete(key);
    else next.add(key);
    return next;
  }), []);
  const byPath = new Map(files.map((file) => [file.path, file]));
  const rows = visibleAffectedRows(affectedFileTree(files.map((file) => file.path)), collapsed);
  return (
    // Keyed by its files: the tree remembers the last button focused in it
    // and gives every other one no tab stop, so a file that leaves the list,
    // after a revert or a refresh, would take the tree out of the tab order
    // with it. A new list is a new tree; closing a folder is not a new list.
    <TreeGrid
      key={files.map((file) => file.path).join('\n')}
      className="affected-files"
      aria-label={label}
      applicationAriaLabel={label}
      onExpandRow={(row) => setOpen(row.dataset.key, true)}
      onCollapseRow={(row) => setOpen(row.dataset.key, false)}
    >
      {rows.map((row) => {
        if (row.kind === 'file') {
          return <ChangedFileRow key={row.key} row={row} file={byPath.get(row.path)} onOpenFile={onOpenFile} revertReason={revertReason} />;
        }
        const open = !collapsed.has(row.key);
        return (
          <TreeGridRow key={row.key} data-key={row.key} level={row.level} positionInSet={row.positionInSet} setSize={row.setSize} isExpanded={open}>
            <TreeGridCell colSpan={2}>
              {(itemProps) => (
                <button {...itemProps} type="button" className="link-button affected-files-row affected-files-folder" onClick={() => setOpen(row.key, !open)}>
                  <Icon icon={open ? chevronDown : chevronRight} size={16} className="affected-files-icon" />
                  <Text variant="body-md">{row.name}</Text>
                </button>
              )}
            </TreeGridCell>
          </TreeGridRow>
        );
      })}
    </TreeGrid>
  );
}

// "Changed files" (#669): the applied patch's or pull request's own files, and
// the contributor's, each under a heading and in a tree of its own. Which file is in which,
// the groups' names, and which can be reverted are changedFileGroups' in
// affected-files.cjs.
function ChangedFilesSection({ changed }) {
  const { change, yours, onOpenFile, onRevertFile, revertReason, revertError } = changed;
  const edited = { icon: pencil, label: __('You edited this file') };
  const created = { icon: plus, label: __('You created this file') };
  return (
    <Stack direction="column" gap="md">
      <Text variant="heading-lg" render={<h2 />}>{__('Changed files')}</Text>
      {change ? (
        <Stack direction="column" gap="sm">
          <Text variant="heading-sm" render={<h3 />}>{change.label}</Text>
          <ChangedFileTree
            label={change.label}
            files={change.files.map((file) => ({
              path: file.path,
              mark: file.alsoEdited ? edited : null,
              onRevert: file.canRevert && onRevertFile ? () => onRevertFile(file, { fromChange: true }) : null,
            }))}
            onOpenFile={onOpenFile}
            revertReason={revertReason}
          />
        </Stack>
      ) : null}
      {yours.length ? (
        <Stack direction="column" gap="sm">
          <Text variant="heading-sm" render={<h3 />}>{__('Your changes')}</Text>
          <ChangedFileTree
            label={__('Your changes')}
            files={yours.map((file) => ({
              path: file.path,
              mark: file.added ? created : null,
              onRevert: file.canRevert && onRevertFile ? () => onRevertFile(file, { fromChange: false }) : null,
            }))}
            onOpenFile={onOpenFile}
            revertReason={revertReason}
          />
        </Stack>
      ) : null}
      {revertError ? <Text variant="body-sm" className="problem-text">{revertError}</Text> : null}
    </Stack>
  );
}

// The details stay in view while the cards scroll past them, for as long as
// they fit in what is in view. Taller than that, a column that stayed put
// would keep its own end out of reach until the page's end, so it is let go
// and scrolls with the cards. Which it is depends on the window's height and
// on what the details are showing, so it is measured, and measured again
// when either changes. A site that is not open measures nothing against
// nothing, and is measured when it is shown.
function useStickyWhileItFits(active) {
  const sidebarRef = useRef(null);
  const [unstuck, setUnstuck] = useState(false);
  useLayoutEffect(() => {
    const sidebar = sidebarRef.current;
    // The page's scrolling element, which App draws around every site's view.
    const scroller = sidebar ? sidebar.closest('.site-workspace-main') : null;
    if (!active || !sidebar || !scroller) {
      setUnstuck(false);
      return undefined;
    }
    const update = () => {
      const next = sidebar.offsetHeight > scroller.clientHeight;
      setUnstuck((current) => (current === next ? current : next));
    };
    const observer = new ResizeObserver(update);
    observer.observe(sidebar);
    observer.observe(scroller);
    update();
    return () => observer.disconnect();
  }, [active]);
  return { sidebarRef, unstuck };
}

/**
 * The details of the open site (#556), beside the cards: the facts about the
 * checkout, under them its two processes (#557), then its tests, and last
 * the files the applied change and the contributor changed (#669). What the
 * facts say is decided in site-details.cjs, and what is said of the processes in
 * site-processes.cjs; this draws them. They can be put away; hidden, they are
 * out of the tab order and the accessibility tree as well as out of sight.
 *
 * @param {Object}   props
 * @param {string}   props.id         The element's id, which the button that shows and hides it names.
 * @param {boolean}  props.open
 * @param {string}   props.siteName   For the region's name.
 * @param {Object}   props.facts      What `siteDetailsRows` takes.
 * @param {boolean}  props.pathCopied The path has just been copied with the button here.
 * @param {Function} props.onCopyPath
 * @param {Object}   [props.server]   The server's section, or null while the site's setup is not done: `{ process, section, onToggle, onOpen }`, the first two from site-processes.cjs.
 * @param {Object}   [props.watch]    The build watch's section, or null likewise: `{ process, onToggle }`.
 * @param {Object}   [props.tests]    The Tests section, or null where the site has no suite to run: `{ groups, ticket, onRunAllPhp, onRunFiltered, reason, lastRun }`, `groups` the named groups the Group field suggests, `ticket` the linked ticket's number or null, `onRunFiltered` taking the fields' `{ filter, group }`, and `lastRun` the last run's `{ status, text, command }`.
 * @param {Object}   [props.changed]  The changed files, from `changedFileGroups`, with what the rows do: `{ change, yours, onOpenFile, onRevertFile, revertReason, revertError }`. No files, no section.
 */
export function SiteDetails({ id, open, siteName, facts, pathCopied, onCopyPath, server = null, watch = null, tests = null, changed = null }) {
  const { sidebarRef, unstuck } = useStickyWhileItFits(open);
  return (
    <div id={id} className="dashboard-sidebar-slot" inert={open ? undefined : ''}>
      <aside
        ref={sidebarRef}
        className={unstuck ? 'dashboard-sidebar is-unstuck' : 'dashboard-sidebar'}
        aria-hidden={!open}
        // translators: %s: the name of a site.
        aria-label={sprintf(__('Details of %s'), siteName)}
      >
        <Stack direction="column" gap="xl">
          <Stack direction="column" gap="md">
            <Text variant="heading-lg" render={<h2 />}>{__('Details')}</Text>
            <Stack direction="column" gap="md">
              {siteDetailsRows(facts).map((row) => {
                const fact = (
                  <Stack key={row.id} direction="column" className={row.copyable ? 'path-meta' : undefined}>
                    <Text variant="body-md" className="muted-label">{row.label}</Text>
                    <Text variant="body-md" className={row.copyable ? 'path-value' : undefined}>{row.value}</Text>
                    {row.note ? <Text variant="body-sm" className="warning-text">{row.note}</Text> : null}
                  </Stack>
                );
                if (!row.copyable) return fact;
                // The button says the copy worked on itself, for the eye. For
                // a screen reader it is said by the region beside it, which
                // holds the word only while it is true: the button's name
                // changing back a moment later is not news, and a live button
                // would announce that too.
                return (
                  <Stack key={row.id} direction="row" align="end" justify="space-between" gap="sm">
                    {fact}
                    <Button variant="minimal" tone="neutral" size="compact" onClick={() => onCopyPath()}>
                      {pathCopied ? __('Copied') : __('Copy')}
                    </Button>
                    <VisuallyHidden role="status" aria-live="polite">{pathCopied ? __('Copied') : ''}</VisuallyHidden>
                  </Stack>
                );
              })}
            </Stack>
          </Stack>
          {server ? (
            <>
              <hr className="card-divider" />
              <ServerSection server={server} />
            </>
          ) : null}
          {watch ? (
            <>
              <hr className="card-divider" />
              <WatchSection watch={watch} />
            </>
          ) : null}
          {tests ? (
            <>
              <hr className="card-divider" />
              <TestsSection tests={tests} />
            </>
          ) : null}
          {/* Last, so a long list grows without pushing the server and the
              build watch out of reach. */}
          {changed && (changed.change || changed.yours.length) ? (
            <>
              <hr className="card-divider" />
              <ChangedFilesSection changed={changed} />
            </>
          ) : null}
        </Stack>
      </aside>
    </div>
  );
}
