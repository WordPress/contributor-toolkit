# Opening a pull request

**Open a pull request** is the one destination on the [Review & submit changes](submitting-changes) screen where the app does the sending: it forks the site's repository to your GitHub account, pushes your change to a branch there, and opens the pull request, all through GitHub's API, as a single commit.

Which repository follows the site's project: `wordpress-develop` on a WordPress Core site, `gutenberg` on a [Gutenberg site](gutenberg-issues). The branch, the description and the rest of the card follow it too; the table at the end lists the differences.

You need a GitHub account, and the site must have a linked work item: a [Trac ticket](trac-tickets) on a Core site, a [GitHub issue](gutenberg-issues) on a Gutenberg site. A pull request has to cite one. The app cannot create the GitHub account for you, and on a Core site it cannot post to Trac on your behalf.

You also need to be on your ticket or issue branch. If you are trying somebody else's PR, use **Revert this PR** first; the app will not include that author's commits in a new pull request under your name.

## Sign in with GitHub

Click **Sign in with GitHub**. The app signs you in through your browser, using GitHub's device flow:

1. The card shows a short code, and your browser opens `github.com/login/device`.
2. Enter the code there — **Copy the code** puts it on your clipboard — and confirm the authorization on GitHub.
3. The app waits until GitHub reports the sign-in went through.

![The Open a pull request card showing a GitHub device code, Copy the code, the waiting state, and Cancel](/screenshots/github-sign-in.png)

You never type a password into the app, and no credential is written to disk: the authorization is held in memory and forgotten when you quit. Click **Cancel** to abandon the sign-in, or **Not now** to decline it — the patch file is still yours to save, and the other two destinations are unchanged.

Once signed in, the card says which account you are on and where the fork and branch will go: **your-username/wordpress-develop** or **your-username/gutenberg**. **Sign out** discards the authorization.

## The pull request form

- **Title** — what the change does, in one line. Reviewers scan these. Left empty, the pull request is titled **Ticket #NNNNN** on a Core site and **Issue #NNNNN** on a Gutenberg site.
- **Notes for reviewers (optional)** — what the change does and why, how to see it working, anything you are unsure about. These go at the top of the description; the line that cites the work item and your WordPress.org username are added underneath. On a Gutenberg site, reviewers ask for testing steps, so this is where they go.

Click **Open pull request** to send it. If anything fails, the error says why, and **Save the patch file instead** is always there — the patch exists regardless of what GitHub did.

Once it is open, the card links the pull request and offers **Copy the link** and **Open #NNNNN to comment**, which opens the ticket or the issue.

## How pull requests work in core

Two things a first-timer has no way to know, stated on the card before the button:

- Nobody watches the pull request list. Your pull request is seen because its link is posted on the Trac ticket — which is why the flow ends by sending you back there.
- Nothing is merged on GitHub. A committer applies the change themselves, and the ticket is where they decide to.

The card links to [the core handbook page on pull requests](https://make.wordpress.org/core/handbook/contribute/git/github-pull-requests-for-code-review/).

## How pull requests work in Gutenberg

Both of the above are false on a Gutenberg site, so its card says what is true there instead:

- The pull request is where the change is reviewed and, once approved, merged. Nothing has to be posted anywhere else for it to be seen: the `Fixes #NNNNN` line lists it on the issue.
- Reviewers ask for testing steps. Put them in the notes: what to open, what to click, what should happen.

The card links to [the Gutenberg contributing guide](https://github.com/WordPress/gutenberg/blob/trunk/CONTRIBUTING.md).

## What differs per project

| | WordPress Core site | Gutenberg site |
|---|---|---|
| Repository forked and targeted | `WordPress/wordpress-develop` | `WordPress/gutenberg` |
| Base branch | `trunk` | `trunk` |
| Branch pushed to your fork | `trac-NNNNN` | `fix/issue-NNNNN` |
| Line under your notes | `Trac ticket: https://core.trac.wordpress.org/ticket/NNNNN` | `Fixes #NNNNN` |
| Untitled pull request | **Ticket #NNNNN** | **Issue #NNNNN** |
| After it is open | Post the link on the ticket | Already linked from the issue |

A branch name that is taken gets a `-2`, `-3` suffix. The rest of the sequence, and every failure and its fallback, is the same on both.
