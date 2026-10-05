import { useState } from 'react';
import { Button, Modal } from '@wordpress/components';
import { Notice, Stack, Text } from '@wordpress/ui';

// The failure is read by its role, and is not also spoken.
const SILENT = '';

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
      <Stack direction="column" gap="md" className="dirty-tree">
        <Text variant="body-md" render={<p />}>
          You&apos;ve changed {files.length === 1 ? '1 file' : `${files.length} files`} in this site. Resetting to trunk would throw them away.
        </Text>
        {files.length ? (
          <div className="dirty-tree-files">
            {files.map((f) => (
              <div key={f}>{f}</div>
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
              className={opt.destructive ? 'dirty-tree-choice is-destructive' : 'dirty-tree-choice'}
            >
              <strong>{opt.label}</strong>
              <span className="dirty-tree-choice-detail"> — {opt.detail}</span>
            </button>
          );
        })}
        {error ? (
          <Notice.Root intent="error" role="alert" spokenMessage={SILENT} className="dirty-tree-error">
            <Notice.Description>{error}</Notice.Description>
          </Notice.Root>
        ) : null}
        <Stack direction="row" justify="flex-end" gap="sm" wrap="wrap">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            variant="primary"
            isDestructive={dirtyChoice === 'discard'}
            isBusy={saving}
            disabled={saving}
            onClick={() => (dirtyChoice === 'discard' ? onDiscard() : onSave())}
          >{dirtyChoice === 'discard' ? 'Discard & update' : 'Save patch & update'}</Button>
        </Stack>
      </Stack>
    </Modal>
  );
}
