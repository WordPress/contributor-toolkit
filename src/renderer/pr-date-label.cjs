// The date shown under a linked pull request (#281).
//
// The row used to read "updated 6 Jul 2026", and on the ticket that produced
// #281 that was the one number a contributor should not have been reading: an
// upstream force-push had restamped both pull requests on the ticket inside the
// same second, so the row was reporting the sweep, not the work.
//
// So the row prefers the date of the newest commit, and says which date it is
// showing rather than leaving the reader to assume. "updated" survives as the
// fallback, for a pull request whose commit date could not be resolved — that
// row is genuinely unknown, and a blank line would read as "nothing here".
//
// The asymmetry is deliberate and is the reason this is a module with a test
// rather than two lines of JSX: latest-patch.cjs must NEVER fall back to
// `updatedAt` — a pull request without a resolved commit date does not compete
// for the "Latest" pill at all — while the row shows it, clearly labelled,
// because a contributor reading a date they can see beats a contributor reading
// nothing.
'use strict';

/**
 * What the date line under a pull request row says, or null when the row has no
 * date to show at all.
 *
 * Returns the field to read rather than a formatted string: the formatting is
 * `toLocaleDateString`, which belongs where the locale does.
 *
 * @param {Object} pr
 * @return {{prefix: string, when: string}|null}
 */
function prDateLabel(pr) {
	const commitDate = pr && typeof pr.commitDate === 'string' ? pr.commitDate : '';
	if (commitDate) return { prefix: 'last commit', when: commitDate };

	const updatedAt = pr && typeof pr.updatedAt === 'string' ? pr.updatedAt : '';
	if (updatedAt) return { prefix: 'updated', when: updatedAt };

	return null;
}

module.exports = { prDateLabel };
