# Opening a pull request

**Open a pull request** is the one destination on the [Review & submit changes](submitting-changes) screen where the app does the sending: it forks `wordpress-develop` to your GitHub account, pushes your change to a branch there, and opens the pull request — all through GitHub's API, as a single commit.

You need a GitHub account, and the site must have a [linked Trac ticket](trac-tickets) — a core pull request has to cite one. The app cannot create the GitHub account for you, and it cannot post to Trac on your behalf.

## Sign in with GitHub

Click **Sign in with GitHub**. The app signs you in through your browser, using GitHub's device flow:

1. The card shows a short code, and your browser opens `github.com/login/device`.
2. Enter the code there — **Copy the code** puts it on your clipboard — and confirm the authorization on GitHub.
3. The app waits until GitHub reports the sign-in went through.

![The Open a pull request card showing a GitHub device code, Copy the code, the waiting state, and Cancel](/screenshots/github-sign-in.png)

You never type a password into the app, and no credential is written to disk: the authorization is held in memory and forgotten when you quit. Click **Cancel** to abandon the sign-in, or **Not now** to decline it — the patch file is still yours to save, and the other two destinations are unchanged.

Once signed in, the card says which account you are on and where the fork and branch will go: **your-username/wordpress-develop**. **Sign out** discards the authorization.

## The pull request form

- **Title** — what the change does, in one line. Reviewers scan these. Left empty, the pull request is titled **Ticket #NNNNN**.
- **Notes for reviewers (optional)** — what the change does and why, how to see it working, anything you are unsure about. These go at the top of the description; the ticket link and your WordPress.org username are added underneath.

Click **Open pull request** to send it. If anything fails, the error says why, and **Save the patch file instead** is always there — the patch exists regardless of what GitHub did.

## How pull requests work in core

Two things a first-timer has no way to know, stated on the card before the button:

- Nobody watches the pull request list. Your pull request is seen because its link is posted on the Trac ticket — which is why the flow ends by sending you back there.
- Nothing is merged on GitHub. A committer applies the change themselves, and the ticket is where they decide to.

The card links to [the core handbook page on pull requests](https://make.wordpress.org/core/handbook/contribute/git/github-pull-requests-for-code-review/).
