import { useId, useLayoutEffect, useRef, useState } from 'react';
import { __, sprintf } from '@wordpress/i18n';
import { globe, offline, seen, table, unseen, wordpress } from '@wordpress/icons';
import { Button, EmptyState, Icon, IconButton, Link, Stack, Text, VisuallyHidden } from '@wordpress/ui';
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

// The site's test suites, each run in the terminal, where their output is.
// One suite so far, core's PHP unit tests; more join it as each is proven to
// run without a host toolchain. `reason` holds every button while something
// rewrites the tree or holds the terminal. The dot and the sentence are the
// last run's (phpunit-result.cjs), with the command it was, since a ticket's
// tests passing says nothing about the rest. The sentence is a status, so a
// screen reader hears a run end without going to look.
function TestsSection({ tests }) {
  const { lastRun } = tests;
  const phpHeadingId = useId();
  return (
    <Stack direction="column" gap="md">
      <Stack direction="row" align="center" gap="sm">
        <ProcessStatus status={lastRun.status} />
        <Text variant="heading-lg" render={<h2 />}>{__('Tests')}</Text>
      </Stack>
      <Stack direction="column" gap="sm" role="group" aria-labelledby={phpHeadingId}>
        <Text id={phpHeadingId} variant="heading-sm" render={<h3 />}>{__('PHP unit tests')}</Text>
        <Stack direction="column" gap="xs">
          <Text variant="body-md" role="status" className={lastRun.status === 'failed' ? 'problem-text' : undefined}>{lastRun.text}</Text>
          {lastRun.command ? <Text variant="body-sm" className="muted-label"><code>{lastRun.command}</code></Text> : null}
        </Stack>
        <Stack direction="row" gap="sm" wrap="wrap">
          {tests.onRunTicket ? (
            <ReasonedUiButton variant="outline" tone="neutral" size="compact" reason={tests.reason} onClick={tests.onRunTicket}>
              {__('Run this ticket\'s tests')}
            </ReasonedUiButton>
          ) : null}
          <ReasonedUiButton variant="outline" tone="neutral" size="compact" reason={tests.reason} aria-label={__('Run all PHP unit tests')} onClick={tests.onRunAllPhp}>
            {__('Run all')}
          </ReasonedUiButton>
        </Stack>
        <Text variant="body-sm" className="muted-label">{__('The first run installs PHPUnit, which takes a few minutes. All of them take about 10 minutes.')}</Text>
      </Stack>
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
 * checkout, under them its two processes (#557), and then its tests. What the facts say is
 * decided in site-details.cjs, and what is said of the processes in
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
 * @param {Object}   [props.tests]    The Tests section, or null where the site has no suite to run: `{ onRunTicket, onRunAllPhp, reason, lastRun }`, `onRunTicket` null with no ticket linked, and `lastRun` the last run's `{ status, text, command }`.
 */
export function SiteDetails({ id, open, siteName, facts, pathCopied, onCopyPath, server = null, watch = null, tests = null }) {
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
        </Stack>
      </aside>
    </div>
  );
}
