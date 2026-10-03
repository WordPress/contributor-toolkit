import { Modal } from '@wordpress/components';
import { prSubmissionRefusal } from '../pr-checkout.cjs';

// Said above the destinations when the checkout is not all the contributor's
// own: someone else's pull request is checked out, or someone else's patch is
// applied. It speaks for every destination at once, and names the one thing
// that is still allowed, which is keeping a copy.
function OwnershipWarning({ pullRequest, appliedPatch, appliedPatchLabel }) {
  if (pullRequest) {
    return (
      <div role="alert" style={{ padding:'10px 12px', background:'#fcf9e8', border:'1px solid #dba617', borderRadius:6, fontSize:12, color:'#6e5406', lineHeight:1.5 }}>
        {prSubmissionRefusal(pullRequest.number)} You can still use <strong>Save</strong> to keep an unattributed copy of your edits.
      </div>
    );
  }
  if (appliedPatch) {
    return (
      <div role="alert" style={{ padding:'10px 12px', background:'#fcf9e8', border:'1px solid #dba617', borderRadius:6, fontSize:12, color:'#6e5406', lineHeight:1.5 }}>
        <strong>{appliedPatchLabel} is part of this checkout.</strong>{' '}
        The app cannot safely separate its author’s changes from edits made afterward, so this combined patch cannot be submitted as your work. You can still use <strong>Save</strong> to keep an unattributed copy; revert the applied patch before submitting.
      </div>
    );
  }
  return null;
}

// "Review & submit changes": the dialog around a site's diff and the places it
// can go.
//
// It holds no state and loads nothing. The site owns the diff, whether it is
// still loading and whether it could be read, because discarding and saving
// are offered outside this dialog as well and have to move the same values.
// What is here is the frame: what the dialog says before the diff (an old
// trunk, a diff that could not be read, nothing to send), the two columns, and
// the heading and the warning that stand above the destinations.
//
// `diff` is the pane on the left (PatchDiffPane) and `children` are the
// destinations on the right, which are shown only once there is a patch to
// send. `age` is how old the site's trunk is. `emptyMessage` is what to say
// when there is nothing to send. `pullRequest`, `appliedPatch` and
// `appliedPatchLabel` are whose work the checkout carries besides the
// contributor's.
export function ReviewDialog({
  onClose,
  age,
  loading,
  loadFailed,
  hasChanges,
  emptyMessage,
  pullRequest,
  appliedPatch,
  appliedPatchLabel,
  diff,
  children
}) {
  return (
    <Modal
      title="Review & submit changes"
      onRequestClose={onClose}
      shouldCloseOnClickOutside
      isFullScreen
    >
      <div style={{ display:'flex', flexDirection:'column', height:'80vh', gap:12 }}>
        {!loading && age.stale && (
          <div style={{ padding:'12px 16px', background:'#fcf9e8', border:'1px solid #dba617', borderRadius:6, fontSize:13, lineHeight:1.5, color:'#6e5406' }}>
            This site&apos;s WordPress code is {age.ageDays} days old — this patch may not apply on Trac. Consider updating to the latest trunk first.
          </div>
        )}
        {!loading && loadFailed ? (
          <div role="alert" style={{ padding: '12px 16px', color: '#8a2424', background: '#fcf0f1', borderRadius: 6 }}>
            Could not load your changes. Close this panel and try again. The error is shown below.
          </div>
        ) : null}
        {!loading && !loadFailed && !hasChanges && (
          <div style={{ padding:'12px 16px', background:'#f0f6fc', border:'1px solid #d0d7de', borderRadius:6, fontSize:14, lineHeight:1.5, color:'#24292f' }}>
            {emptyMessage}
          </div>
        )}
        {/*
          Diff on the left, destinations on the right (#186).

          The patch used to sit under the destinations, which put the choice
          above the thing being chosen for: a contributor scrolled past three
          cards to read their own code, then scrolled back. The code is what
          they came to look at and the largest thing on the screen, so it takes
          the room, and where it can go stands beside it — visible the whole
          time they are reading, rather than something to scroll back to.

          This is the shape of an earlier take on the same screen (#6), revived
          here on top of the destinations this app has now.

          The column widths, the stacking breakpoint and what scrolls in each
          case are in shell.css — a media query can express them and an inline
          style cannot. `min-width: 0` there is load-bearing on a flex child
          holding a <pre>: without it the diff's longest line sets the column's
          floor and pushes the destinations off the modal instead of scrolling.
        */}
        <div className="patch-columns">
          {diff}

          {/*
            Where the patch goes, named at the moment it exists (#166), each
            destination with what it costs — a tool that emits a file and stops
            leaves the contributor to work that out alone.

            Grouped by who does the sending, and stacked rather than laid side
            by side: in a column the grouping is what the shared card says, and
            the sidebar can scroll on its own while the diff stays put.
          */}
          {!loading && hasChanges && (
            <div className="patch-destinations">
              <div>
                <div style={{ fontWeight:600, fontSize:14, color:'#1d2327' }}>Where this patch goes</div>
                <div style={{ fontSize:12, color:'#6c6f72', lineHeight:1.5 }}>The pull request is the one the app sends for you. The others save a file for you to send.</div>
              </div>

              <OwnershipWarning pullRequest={pullRequest} appliedPatch={appliedPatch} appliedPatchLabel={appliedPatchLabel} />

              {children}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
