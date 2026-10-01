import { Button, Spinner } from '@wordpress/components';
import { copy as copyIcon, check as checkIcon, download } from '@wordpress/icons';
import { DiscardChangesLink } from './discard-changes-link.jsx';
import { DiffText } from './diff-text.jsx';

// The left column of "Review & submit changes": the contributor's own diff,
// with what can be done to it as a whole. Save it to a file, copy it, or throw
// the changes away.
//
// It holds no state. The diff, whether it is still being generated, and what
// the last save, copy and discard came to are the caller's, because the same
// patch feeds the destinations beside this pane and the same discard is
// offered from the ticket's note. This is how they look here.
export function PatchDiffPane({
  heading,
  description,
  patchText,
  patchLoading,
  patchLoadFailed,
  patchSaved,
  patchSaveError,
  copyLabel,
  copied,
  discardReason,
  discardError,
  onSave,
  onCopy,
  onDiscard
}) {
  return (
    <div className="patch-diff">
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
        <div>
          <div style={{ fontWeight:600, fontSize:14, color:'#1d2327', display:'flex', alignItems:'baseline', gap:4, flexWrap:'wrap' }}>
            {heading}
            <span style={{ fontWeight:400 }}>
              {'('}
              <DiscardChangesLink
                label="Discard all changes"
                onClick={onDiscard}
                reason={discardReason}
                style={{ fontSize: 12 }}
              />
              {')'}
            </span>
          </div>
          <div style={{ fontSize:12, color:'#6c6f72' }}>{description}</div>
          {discardError ? <div style={{ color:'#d63638', fontSize:12, marginTop:4 }}>{discardError}</div> : null}
        </div>
        {/*
          Out of the diff and into the header: these used to float
          over the top-right of the code, which was survivable at
          full width and covers the first line of a hunk once the
          pane is a column.
        */}
        <div style={{ display:'flex', gap:8 }}>
          <Button variant="secondary" icon={download} onClick={onSave} disabled={patchLoading || patchLoadFailed}>Save</Button>
          <Button
            variant="secondary"
            icon={copied ? checkIcon : copyIcon}
            onClick={onCopy}
            disabled={patchLoading || patchLoadFailed}
            // The label carries the outcome rather than a tooltip or
            // a toast: it is the thing that was just pressed, so it
            // is where the eye already is, and a screen reader
            // announces the change on the focused control.
          >{copyLabel}</Button>
        </div>
      </div>
      {/*
        Under the diff rather than beside the destinations that
        trigger it: this is the outcome for the file, the file is
        what this column is, and the header's own Save button needs
        somewhere to report even when there are no destinations to
        show.
      */}
      {patchSaved ? (
        <div style={{ fontSize:13, color:'#0f5132' }}>Saved to {patchSaved}</div>
      ) : null}
      {patchSaveError ? (
        <div role="alert" style={{ fontSize:13, color:'#d63638' }}>Could not save the patch: {patchSaveError}</div>
      ) : null}
      <div style={{ position:'relative', flex:1, minHeight:0 }}>
        {patchLoading ? (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:16 }}>
            <Spinner />
            <div style={{ color:'#666', fontSize:14 }}>Generating patch...</div>
          </div>
        ) : (
          <>
            {/*
              `boxSizing: border-box` with `height: 100%` and a
              padding: without it the pane is its container plus
              24px of padding, and it overflows by exactly that.
              Invisible while the diff spanned the modal and the
              overflow fell off the bottom; beside a sidebar it
              sits on top of the destinations.
            */}
            <pre style={{ margin:0, whiteSpace:'pre-wrap', background:'#111', color:'#eee', padding:12, borderRadius:6, height:'100%', boxSizing:'border-box', overflowY:'auto' }}>
              {patchText && patchText.trim().length ? <DiffText text={patchText} /> : 'No changes.'}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}
