import { useCallback, useEffect, useState } from 'react';
import { Button, Modal, TextControl } from '@wordpress/components';

const RENAME_INPUT_ID = 'rename-site-name-input';

// The dialog that renames a site. Mounted while it is open and not otherwise,
// so every opening starts from the name the site has now, with no error left
// over from the last one: the value, the refusal and the busy flag are this
// component's and go when it does. Whoever renders it owns only whether it is
// open.
//
// `onRename(sitePath, name)` does the renaming and is awaited; the dialog
// closes itself when it resolves. While it is pending nothing closes the
// dialog, neither Cancel nor Escape nor a click outside it, so the answer has
// somewhere to arrive.
export function RenameSiteModal({ sitePath, displayName, onRename, onClose }) {
  const [renameValue, setRenameValue] = useState(displayName);
  const [renameError, setRenameError] = useState('');
  const [renaming, setRenaming] = useState(false);
  useEffect(() => { setRenameValue(displayName); }, [displayName]);
  useEffect(() => {
    const input = document.getElementById(RENAME_INPUT_ID);
    if (input) {
      input.focus();
      if (typeof input.select === 'function') input.select();
    }
  }, []);

  const closeRenameModal = useCallback(() => {
    if (renaming) return;
    onClose();
  }, [renaming, onClose]);

  const submitRename = useCallback(async () => {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError('Site name cannot be empty.');
      return;
    }
    try {
      setRenaming(true);
      setRenameError('');
      if (onRename) await onRename(sitePath, trimmed);
      onClose();
    } catch (err) {
      setRenameError(String(err));
    } finally {
      setRenaming(false);
    }
  }, [onRename, onClose, renameValue, sitePath]);

  const handleRenameSubmit = useCallback((event) => {
    event.preventDefault();
    submitRename();
  }, [submitRename]);

  const handleRenameFormKeyDown = useCallback((event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeRenameModal();
    }
  }, [closeRenameModal]);

  return (
    <Modal
      title="Rename site"
      onRequestClose={closeRenameModal}
      shouldCloseOnClickOutside={!renaming}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape-to-close/Enter-to-submit on the modal form is standard, intentional behavior. */}
      <form
        onSubmit={handleRenameSubmit}
        onKeyDown={handleRenameFormKeyDown}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <TextControl
          id={RENAME_INPUT_ID}
          label="Site name"
          value={renameValue}
          onChange={(value) => setRenameValue(value)}
          disabled={renaming}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional: this is the only field of a just-opened modal.
          autoFocus
        />
        {renameError ? <div style={{ color: '#d63638', fontSize: 12 }}>{renameError}</div> : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button type="button" variant="secondary" onClick={closeRenameModal} disabled={renaming}>Cancel</Button>
          <Button type="submit" variant="primary" isBusy={renaming} disabled={renaming}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}
