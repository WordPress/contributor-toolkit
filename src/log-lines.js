// Reassembles child-process stream chunks into whole lines for the app log.
// Deliberately free of Electron imports so it can be unit-tested.

// Child stdout/stderr arrives in arbitrary chunks: a single npm message can be
// split across two reads, and one read can carry a dozen messages. Logging the
// chunks verbatim would stamp a timestamp mid-sentence and interleave the two
// streams mid-word, which is exactly what makes a log unreadable at the moment
// someone needs it. Buffering to line boundaries costs one partial line of
// latency and is why `flush` exists — the last line before a process exits
// usually has no trailing newline, and it is often the interesting one.
function createLineBuffer() {
	let pending = '';
	return {
		// Returns the complete lines contained in `chunk`, retaining any partial
		// trailing line for the next call.
		push(chunk) {
			pending += String(chunk ?? '');
			// A trailing \n yields a final '' element, which is dropped as the new
			// pending — so a chunk ending exactly on a boundary leaves nothing behind.
			const parts = pending.split('\n');
			pending = parts.pop();
			// \r\n from Windows child processes would otherwise show as a stray CR.
			return parts.map((line) => line.replace(/\r$/, ''));
		},
		// The unterminated remainder, if any. Call once when the stream closes.
		flush() {
			const rest = pending.replace(/\r$/, '');
			pending = '';
			return rest ? [rest] : [];
		}
	};
}

module.exports = { createLineBuffer };
