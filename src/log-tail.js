// What to read from a file that is being tailed, given how big it was last time
// and how big it is now.
//
// Extracted from the fs.watch callback in main.js so the rule below can be
// tested: inside the callback it was unreachable, and the rule it was missing —
// a file that shrank — is not a corner case. The Clear button under the
// debug.log panel truncates the file, and `grunt clean` removes it during a
// rebuild.
//
// Deliberately free of Electron and fs imports, like log-lines.js.

// The most of an existing file to replay when the tail first attaches. A
// contributor opening a site that has been logging for a week does not want the
// week; they want enough to see what the last run did.
const MAX_INITIAL_READ = 256 * 1024;

// The byte range to send when attaching to a file for the first time.
function planInitialRead(size, max = MAX_INITIAL_READ) {
	const total = Math.max(0, Number(size) || 0);
	return {
		// Null rather than a zero-length range: an empty file has no backlog, and
		// the caller uses this to decide whether to open a stream at all.
		read: total > 0 ? { start: total > max ? total - max : 0 } : null,
		lastSize: total
	};
}

// The byte range to send when a watched file changes, and the offset to
// remember. `read` is null when there is nothing new.
function planTailRead(lastSize, size) {
	const previous = Math.max(0, Number(lastSize) || 0);
	const current = Math.max(0, Number(size) || 0);

	// Smaller than last time: the file was truncated or replaced, and the bytes
	// that used to be at `previous` are gone. Reading from there would skip past
	// everything written from now on — the whole file has to fit past the old
	// offset before a single line reappears — so the panel goes quiet for the
	// rest of the session. Start over from the beginning of what is there now.
	if (current < previous) {
		return { read: current > 0 ? { start: 0 } : null, lastSize: current };
	}

	if (current > previous) return { read: { start: previous }, lastSize: current };

	// Unchanged size. fs.watch fires on metadata changes too, and a rewrite that
	// happens to land on the same length is not something a size comparison can
	// see; replaying from 0 on every such event would duplicate the file into the
	// panel, which is worse than missing it.
	return { read: null, lastSize: current };
}

module.exports = { MAX_INITIAL_READ, planInitialRead, planTailRead };
