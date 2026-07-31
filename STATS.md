## Download stats

The app is distributed as release binaries, so downloads are the only usage signal there is —
there is no npm install count, no Docker pull count, no telemetry in the app.

GitHub reports a running total per release asset and keeps **no history**: the API returns the
number as it stands today and nothing about how it got there. So a
[weekly workflow](.github/workflows/download-stats.yml) records that total and commits it to
[`metrics`](https://github.com/WordPress/experimental-wp-dev-env/tree/metrics), an orphan branch
that shares no history with `trunk` and holds nothing but the data files.

### Reading the data

In the browser:
[downloads.csv](https://github.com/WordPress/experimental-wp-dev-env/blob/metrics/downloads.csv).

Locally, without switching branches:

```bash
git fetch origin metrics:metrics
git show metrics:downloads.csv
```

One row per asset per snapshot, so any release can be broken down by platform:

```csv
date,tag,asset,downloads
2026-07-31,"v0.1.2","wordpress-contributor-toolkit-0.1.2-mac-arm64.dmg",1
2026-07-31,"v0.1.1","WordPress.Contributor.Toolkit-0.1.0.AppImage",20
2026-07-31,"v0.1.0","mac-release-arm64.dmg",47
```

**The number is cumulative per asset, not per week.** Two consecutive rows for the same asset are
running totals; subtract them to get the change between those dates.

A few things the data answers directly:

```bash
# Total across every release, on the most recent snapshot
git show metrics:downloads.csv | awk -F, -v d="$(git show metrics:downloads.csv | tail -1 | cut -d, -f1)" \
  '$1 == d { gsub(/"/, "", $4); sum += $4 } END { print sum }'

# One asset over time
git show metrics:downloads.csv | grep 'mac-arm64.dmg'
```

`badge.json`, on the same branch, holds the current total across every release in the format a
[shields.io endpoint badge](https://shields.io/badges/endpoint-badge) reads.

### What the numbers are not

**They count HTTP requests, not people.** A re-download, a `curl` in a CI script, a retry after a
dropped connection and a bot crawling the releases page each add one. Treat them as an interest
signal, not an install count.

**Source archives and clones are not included.** Only uploaded release assets are counted — the
auto-generated `.zip`/`.tar.gz` and `git clone` are not.

**The counter belongs to the asset, not the release.** Deleting a release file and re-uploading it
restarts that file at zero, which is part of why these snapshots exist: they are the only record
that survives a rename. It has already happened once, to the three artifacts replaced on the
v0.1.2 draft.

**History starts when the workflow did.** Everything before the first snapshot is unrecoverable —
GitHub never stored it.
