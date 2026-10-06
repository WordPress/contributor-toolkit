import { Button, Spinner, TextControl, TextareaControl } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { Notice, Stack, Text } from '@wordpress/ui';
import { copy as copyIcon, check as checkIcon } from '@wordpress/icons';
import { prStageLabel } from '../pr-stage.cjs';
import { Destination } from './destination.jsx';

// Why it failed, in a sentence that says what to do about it. Every one of
// these still leaves the patch file, which is what the card offers underneath.
// The no-ticket refusal is not here: the main process words it for the site's
// work item (#251), and the fallback below shows that sentence as sent.
function prFailureMessage(reason) {
  switch (reason) {
    case 'unauthorized': return __('That GitHub sign-in is no longer valid. Sign in again, or save the patch file instead.');
    case 'rate-limited': return __('GitHub is rate-limiting this connection. It usually clears within the hour.');
    case 'offline': return __('No connection to GitHub.');
    case 'empty': return __('There are no changes to open a pull request with.');
    default: return null;
  }
}

// A notice here is not also spoken: the card it is in is being read.
const SILENT = '';

// "Open a pull request" (#167): the one destination that acts for the
// contributor. It signs them in, forks, pushes and opens the pull request.
//
// It holds no state. `pr` is the site's usePullRequest: the account, the
// sign-in, what was typed, the attempt and how it went, all of which have to
// outlive this card (the hook says why). `project` words the card for the
// site's project and names the repository; `workItem` and `ticket` are the
// ticket or issue the pull request is for, if one is linked. `refusal` is the
// caller knowing the patch is not the contributor's own to submit, as the
// sentence that says so; it comes before everything else, including a result.
// `onSavePatch` is the floor under every failure: the file.
export function PullRequestDestination({ pr, project, workItem, ticket, refusal, onSavePatch }) {
  const { account } = pr;
  const upstreamPath = `${project.upstream.owner}/${project.upstream.repo}`;

  // The card has six states and they are genuinely sequential — done, still
  // asking, waiting on the browser, ready, declined, not started. Written as
  // nested ternaries in the JSX that is one expression six levels deep and
  // unreadable at the point where the wording matters most, so the states get
  // early returns and the card body gets one call.
  const renderBody = () => {
    if (refusal) {
      return <Text variant="body-sm" className="warning-text">{refusal}</Text>;
    }

    if (pr.result) {
      return (
        <>
          {/*
            A dry run (WP_DEV_ENV_GITHUB_DRY_RUN) stops after the branch: the
            fork writes are private, the pull request is the step watchers
            hear about. Saying so beats a "pull request #null".
          */}
          {pr.result.dryRun ? (
            <Text variant="body-md" className="success-text">
              {createInterpolateElement(
                // translators: <branch /> is the name of the branch pushed to the contributor's fork, as a link.
                __('Dry run — branch <branch /> was created on your fork; no pull request was opened.'),
                { branch: <Button variant="link" onClick={()=>window.api.openExternal(pr.result.url)}><code>{pr.result.branch}</code></Button> }
              )}
            </Text>
          ) : (
          <Text variant="body-md" className="success-text">
            {createInterpolateElement(
              sprintf(
                // translators: %s: the number of the pull request, inside a link to it. <branch /> is the name of the branch it was opened from.
                __('Opened <link>pull request #%s</link> from <branch />.'),
                pr.result.number
              ),
              {
                link: <Button variant="link" onClick={()=>window.api.openExternal(pr.result.url)} />,
                branch: <code>{pr.result.branch}</code>
              }
            )}
          </Text>
          )}
          {/*
            The branch always bases on today's trunk (see resolveBase); this
            names the consequence when the local checkout was behind it. The
            clash guard has already ruled out upstream changes to the same
            files, so this is information, not alarm.
          */}
          {pr.result.exactBase === false ? (
            <Notice.Root intent="warning" spokenMessage={SILENT}>
              <Notice.Description>
                {__('Your checkout was behind trunk, so the branch was based on today\'s trunk. None of your files were changed upstream in between — the pull request shows only your work.')}
              </Notice.Description>
            </Notice.Root>
          ) : null}
          {/*
            The loop-back to the work item is for a pull request that exists —
            a dry run has no link worth posting. What the line says is the
            project's: on Trac the link is what gets the pull request seen, on
            GitHub the Fixes line has already done that (#251).
          */}
          {!pr.result.dryRun && (
            <>
              <Text variant="body-sm">{project.cards.prLoopBack}</Text>
              <Button variant="secondary" onClick={pr.copyLink} icon={pr.linkCopied ? checkIcon : copyIcon}>
                {pr.linkCopied ? __('Link copied') : __('Copy the link')}
              </Button>
              {ticket ? (
                <Button variant="primary" onClick={()=>window.api.openExternal(workItem.urlFor(ticket))}>
                  {sprintf(
                    // translators: %s: the number of the ticket or issue the pull request is for.
                    __('Open #%s to comment'),
                    ticket
                  )}
                </Button>
              ) : null}
            </>
          )}
        </>
      );
    }

    // Not yet asked, which is not the same as signed out: offering "Sign in"
    // before the answer arrives makes the card flicker on every open.
    if (account === null) {
      return <Text variant="body-sm" className="muted-label">{__('Checking…')}</Text>;
    }

    if (account.configured === false) {
      return (
        <Text variant="body-sm" className="muted-label">
          {__('This build has no GitHub application configured, so it cannot open a pull request. The other destinations still work.')}
        </Text>
      );
    }

    if (pr.deviceCode) {
      return (
        <>
          <Text variant="body-sm">
            {createInterpolateElement(
              // translators: <address /> is GitHub's sign-in page, github.com/login/device.
              __('Enter this code at <strong><address /></strong>, which has been opened in your browser.'),
              { strong: <strong />, address: <>github.com/login/device</> }
            )}
          </Text>
          <div className="device-code">{pr.deviceCode.userCode}</div>
          <Button variant="secondary" onClick={pr.copyDeviceCode} icon={pr.codeCopied ? checkIcon : copyIcon}>
            {pr.codeCopied ? __('Code copied') : __('Copy the code')}
          </Button>
          <Stack direction="row" align="center" justify="center" gap="sm">
            <Spinner />
            <Text variant="body-sm" className="muted-label">{__('Waiting for you to finish in the browser…')}</Text>
          </Stack>
          <Text variant="body-sm"><Button variant="link" onClick={pr.cancelSignIn}>{__('Cancel')}</Button></Text>
        </>
      );
    }

    if (account.login) {
      return (
        <>
          {ticket ? (
            <>
              {/*
                The placeholder used to be the fallback title, `Ticket #NNNNN`,
                which taught the wrong thing by example: a reviewer scanning a
                list of pull requests learns nothing from a ticket number they
                can already see. It shows a good title instead, and the line
                under the field says what an empty box will produce, so the
                fallback stays honest without being the model.
              */}
              <TextControl
                value={pr.title}
                onChange={pr.setTitle}
                disabled={Boolean(pr.stage)}
                placeholder={__('Reject a theme zip in the plugin installer')}
                label={__('Title')}
                help={__('What the change does, in one line. Reviewers scan these.')}
              />
              {!pr.title.trim() ? (
                <Text variant="body-sm" className="muted-label">
                  {createInterpolateElement(
                    // translators: <title /> is the title an untitled pull request gets, such as "Ticket #60001".
                    __('Left empty, it will be titled <strong><title /></strong>.'),
                    { strong: <strong />, title: <>{workItem.defaultPrTitle(ticket)}</> }
                  )}
                </Text>
              ) : null}
              {/*
                The one part of the body a human writes, and the reason the
                field exists: everything else — the ticket link, the handle,
                the event — the app already knows and adds. It goes to the top
                of the description, above the ticket line.
              */}
              <TextareaControl
                value={pr.notes}
                onChange={pr.setNotes}
                disabled={Boolean(pr.stage)}
                rows={4}
                label={__('Notes for reviewers (optional)')}
                placeholder={[
                  __('What the change does, and why.'),
                  __('How to see it working — the steps you used.'),
                  __('Anything you are unsure about.')
                ].join('\n')}
                help={project.cards.prNotesHelp}
              />
              {/*
                What a first-timer has no way to know about pull requests on
                this project, stated before the button rather than after the
                pull request exists. The facts are the registry's (#251): Core's
                two are false on Gutenberg, where the pull request is the venue.
              */}
              <details className="destination-how">
                <summary>{project.cards.prHow.summary}</summary>
                <Stack direction="column" gap="xs">
                  {project.cards.prHow.lines.map((line) => <div key={line}>{line}</div>)}
                  <Button
                    variant="link"
                    onClick={()=>window.api.openExternal(project.cards.prHow.linkUrl)}
                  >{project.cards.prHow.linkLabel}</Button>
                </Stack>
              </details>
              {/*
                The button says what it will actually do. A dry run's button
                reading "Open pull request" is the label lying about the mode,
                which is the failure this whole indicator exists to prevent.
              */}
              <Button
                variant="primary"
                onClick={pr.open}
                isBusy={Boolean(pr.stage)}
                disabled={Boolean(pr.stage)}
              >{account?.testMode?.dryRun ? __('Push branch (dry run)') : __('Open pull request')}</Button>
            </>
          ) : (
            <Text variant="body-sm" className="muted-label">{project.cards.prBlockedNote}</Text>
          )}
          {/*
            The repository the stage label names is the effective target: the
            sandbox when the override is set, else the site's own. The same
            answer the test-mode badge above gives, so the two never disagree.
          */}
          {pr.stage ? (
            <Text variant="body-sm" className="muted-label">{prStageLabel(pr.stage, account?.testMode?.target || upstreamPath)}</Text>
          ) : (
            <Text variant="body-sm" className="muted-label">
              {/*
                The destination is named, not implied: "the fork is made for
                you" answers what, this answers where — which account the fork
                and the branch land in.
              */}
              <span>
                {createInterpolateElement(
                  // translators: <login /> is the contributor's GitHub username. <fork /> is their fork, such as janedoe/wordpress-develop, as a link.
                  __('Signed in as <login /> — the fork and branch go to <fork />.'),
                  {
                    login: <>{account.login}</>,
                    fork: (
                      <Button
                        variant="link"
                        onClick={()=>window.api.openExternal(`https://github.com/${account.login}/${project.upstream.repo}`)}
                      >{`${account.login}/${project.upstream.repo}`}</Button>
                    )
                  }
                )}
              </span>{' '}
              <Button variant="link" onClick={pr.signOut}>{__('Sign out')}</Button>
            </Text>
          )}
        </>
      );
    }

    if (pr.declined) {
      return (
        <>
          <Text variant="body-sm" className="muted-label">
            {__('Nothing was signed in and nothing was sent. The patch file is still yours to save, and the other destinations are unchanged.')}
          </Text>
          <Text variant="body-sm"><Button variant="link" onClick={pr.askAgain}>{__('Show this again')}</Button></Text>
        </>
      );
    }

    return (
      <>
        {/*
          The whole ask, before any of it happens — including the part the app
          cannot do for you. Declining has to be as visible as accepting, or the
          cliff is sprung rather than named.
        */}
        <Text variant="body-sm">
          {sprintf(
            // translators: %s: the repository the app forks, such as wordpress-develop.
            __('Signing in lets the app fork %s to your account, push this patch to a branch there, and open the pull request. It signs you in through your browser, never asks for your password, and forgets the authorization when you quit.'),
            project.upstream.repo
          )}
        </Text>
        <Text variant="body-sm" className="muted-label">{project.cards.signInCannot}</Text>
        <Button variant="primary" onClick={pr.startSignIn}>{__('Sign in with GitHub')}</Button>
        <Text variant="body-sm"><Button variant="link" onClick={pr.decline}>{__('Not now')}</Button></Text>
      </>
    );
  };

  return (
    <Destination
      title={__('Open a pull request')}
      cost={project.cards.prCost}
      after={project.cards.prAfter}
    >
      {/*
        Absent from every shipped build. When a test switch is set it sits
        above the button, because that is where the decision is made — a mode
        set in a terminal minutes earlier, in an app that otherwise looks
        identical, is how a dry run that silently was not one opened a real
        pull request during testing.
      */}
      {account?.testMode ? (
        <Notice.Root intent="neutral" spokenMessage={SILENT}>
          <Notice.Title>{__('Test mode')}</Notice.Title>
          <Notice.Description>
            {account.testMode.dryRun
              ? __('Dry run — a branch is pushed to your fork, no pull request is opened.')
              : createInterpolateElement(
                // translators: <target /> is the sandbox repository pull requests are redirected to. <upstream /> is the repository they would otherwise go to, such as WordPress/wordpress-develop.
                __('Pull requests go to <target />, not to <upstream />.'),
                { target: <code>{account.testMode.target}</code>, upstream: <>{upstreamPath}</> }
              )}
          </Notice.Description>
        </Notice.Root>
      ) : null}
      {renderBody()}
      {pr.signInError ? <Text variant="body-sm" className="problem-text" role="alert">{pr.signInError}</Text> : null}
      {pr.error ? (
        <>
          <Text variant="body-sm" className="problem-text" role="alert">
            {prFailureMessage(pr.error.reason) || pr.error.error}
          </Text>
          {/*
            Every failure lands here, and every failure has the same floor: the
            file exists regardless of what GitHub did.
          */}
          <Button variant="secondary" onClick={onSavePatch}>{__('Save the patch file instead')}</Button>
        </>
      ) : null}
    </Destination>
  );
}
