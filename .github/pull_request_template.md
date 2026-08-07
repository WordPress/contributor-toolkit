<!--
Title format: [Action] [what] [where or why]
  good — "Fix the patch panel's empty diff after a trunk update"
  bad  — "Fix bug", "Update component", "Changes"

A reviewer should understand this PR in five minutes. Everything above the
collapsed sections is what they read first: keep it short, and put depth in the
<details> blocks rather than deleting it. Delete the sections that genuinely do
not apply — an empty heading is worse than no heading.
-->

## Problem

<!-- What breaks, or what is missing, and who it happens to. Be concrete: the
error message, the sequence that triggers it, what the contributor sees. If it
is a feature, say what someone cannot do today. Two or three sentences. -->

## Solution

<!-- The approach, not a tour of the diff. What you changed at the level of
ideas, and the one or two decisions a reviewer would otherwise have to
reverse-engineer. Alternatives you rejected go in the collapsed section below. -->

## How to test this

<!-- Required on every PR, including ones with a green suite — this app fails in
places `node --test` cannot reach. See AGENTS.md for the full shape.

Platforms: any / macOS / Windows — and say why if it is not "any".
Buildkite builds signed artifacts for every branch with an open PR, so this can
be driven on a real machine without a local build. Check the build matches the
current head commit; force-pushing invalidates earlier ones. -->

**Starting state:**

1.
2.

**What must not have happened:**

<!-- The silent regressions. Work quietly discarded, node_modules quietly
rebuilt, a patch quietly missing a file. Name what would be easy not to notice. -->

## Risks and limitations

<!-- Known gaps, what you deliberately did not do, what could not be tested by
hand and why. An honest limitation here is worth more than silence — it is the
thing a reviewer would otherwise find and have to ask about. -->

## Related

<!-- Fixes #123 / Part of #123 / Follow-up to #123. Use the GitHub keyword when
this actually closes the issue, so it closes on merge. -->

---

<details>
<summary>Design decisions and alternatives considered</summary>

<!-- Why this shape and not the obvious one. Approaches rejected, and what ruled
them out. If you departed from what an issue asked for, this is where you say so
and why — do not let a reviewer discover it from the diff. -->

</details>

<details>
<summary>Review outcome (required — see AGENTS.md)</summary>

<!-- Counts first, e.g. "3 [fix here] · 1 [follow-up] — all 3 fixed", then what
was fixed and what was deferred with its reason. A deferral is a decision, not
an omission. Put the headline count in one line up in "Risks and limitations" if
it changes how the PR should be read. -->

</details>

<details>
<summary>Implementation notes</summary>

<!-- Anything a future reader would want and a reviewer does not need up front:
file-by-file detail, benchmarks, upstream quirks, links to the API docs that
settled a question. -->

</details>

<details>
<summary>Screenshots or recording</summary>

<!-- Required for anything with a visible surface. Before and after, or a short
recording of the flow. Delete this block only if nothing on screen changed. -->

</details>
