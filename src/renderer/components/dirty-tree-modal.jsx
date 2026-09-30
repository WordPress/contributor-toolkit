import { useState } from 'react';
import { Button, Modal } from '@wordpress/components';

// The question an update asks when there are edits loose in the tree: the
// reset would erase them, so the contributor says what happens to them first.
//
// It owns one thing, which answer is selected. It is mounted while the
// question is open and not otherwise, so every time it is asked it starts on
// saving: the answer that cannot lose work, and what the tool is for. What
// each answer does, whether one is under way and what went wrong are the
// caller's, because doing them reaches the terminal, the ticket note and the
// update chain. While `saving` is set nothing closes the dialog.
export function DirtyTreeModal({ files, saving, error, onSave, onDiscard, onClose }) {
  const [dirtyChoice, setDirtyChoice] = useState('save'); // save | discard
  return (
    <Modal
      title="Update to latest trunk?"
      onRequestClose={() => { if (!saving) onClose(); }}
      shouldCloseOnClickOutside={!saving}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 520 }}>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
          You&apos;ve changed {files.length === 1 ? '1 file' : `${files.length} files`} in this site. Resetting to trunk would throw them away.
        </p>
        {files.length ? (
          <div style={{ border: '1px solid #dcdcde', borderRadius: 6, padding: '10px 12px', maxHeight: 140, overflowY: 'auto' }}>
            {files.map((f) => (
              <div key={f} style={{ fontFamily: 'monospace', fontSize: 12, color: '#3c434a', lineHeight: 1.7, overflowWrap: 'anywhere' }}>{f}</div>
            ))}
          </div>
        ) : null}
        {[
          { key: 'save', label: 'Save them as a patch first (as a local file)', detail: 'a .diff on your machine — nothing is sent to Trac' },
          { key: 'discard', label: 'Discard them', detail: 'your changes are lost; this cannot be undone', destructive: true }
        ].map((opt) => {
          const selected = dirtyChoice === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => setDirtyChoice(opt.key)}
              disabled={saving}
              aria-pressed={selected}
              style={{
                textAlign: 'left',
                cursor: 'pointer',
                font: 'inherit',
                fontSize: 13,
                padding: '10px 12px',
                borderRadius: 6,
                border: selected ? '2px solid #3858e9' : '1px solid #dcdcde',
                background: selected ? '#f0f3ff' : '#fff',
                color: opt.destructive ? '#b32d2e' : '#1d2327'
              }}
            >
              <span style={{ fontWeight: 600 }}>{opt.label}</span>
              <span style={{ color: opt.destructive ? '#b32d2e' : '#6c6f72' }}> — {opt.detail}</span>
            </button>
          );
        })}
        {error ? (
          <div role="alert" style={{ padding: '10px 12px', background: '#fcf0f1', border: '1px solid #d63638', borderRadius: 6, fontSize: 13, lineHeight: 1.5, color: '#8a2424', overflowWrap: 'anywhere' }}>
            {error}
          </div>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            variant="primary"
            isDestructive={dirtyChoice === 'discard'}
            isBusy={saving}
            disabled={saving}
            onClick={() => (dirtyChoice === 'discard' ? onDiscard() : onSave())}
          >{dirtyChoice === 'discard' ? 'Discard & update' : 'Save patch & update'}</Button>
        </div>
      </div>
    </Modal>
  );
}
