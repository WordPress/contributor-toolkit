import { useEffect, useId, useRef, useState } from 'react';
import { __ } from '@wordpress/i18n';
import { Button, Dialog, InputControl, Notice, Stack } from '@wordpress/ui';
import { renameProblem } from '../site-dialogs.cjs';

// The name and the button that gives it. It is inside the dialog's popup,
// which is there while the dialog is open, and for the moment it takes to
// fade once it is closed, and not otherwise. So every opening starts from
// the name the site has now, with no complaint left over from the last one.
function RenameSiteForm({ formId, sitePath, displayName, renaming, setRenaming, onRename, onClose }) {
  const [name, setName] = useState(displayName);
  const [error, setError] = useState('');
  const field = useRef(null);
  // The whole name is selected, so that the first key pressed replaces it.
  useEffect(() => { if (field.current) field.current.select(); }, []);

  const submit = async (event) => {
    event.preventDefault();
    const problem = renameProblem(name);
    if (problem) {
      setError(problem);
      return;
    }
    try {
      setRenaming(true);
      setError('');
      await onRename(sitePath, name.trim());
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setRenaming(false);
    }
  };

  return (
    <>
      <Dialog.Content render={<form id={formId} onSubmit={submit} noValidate />}>
        <Stack direction="column" gap="lg">
          <InputControl
            ref={field}
            label={__('Site name')}
            value={name}
            disabled={renaming}
            onChange={(event) => setName(event.currentTarget.value)}
          />
          {error ? (
            // An alert, which is said as it appears. The notice is told to
            // say nothing itself, or it would be said twice.
            <Notice.Root intent="error" role="alert" spokenMessage="">
              <Notice.Description>{error}</Notice.Description>
            </Notice.Root>
          ) : null}
        </Stack>
      </Dialog.Content>
      <Dialog.Footer>
        <Button type="submit" form={formId} loading={renaming} loadingAnnouncement={__('Renaming the site')}>{__('Rename')}</Button>
      </Dialog.Footer>
    </>
  );
}

/**
 * The dialog that renames a site (#553, #557).
 *
 * `onRename(sitePath, name)` does the renaming and is awaited, with the name
 * trimmed; the dialog asks to be closed when it resolves, and says why when
 * it does not. While it is pending nothing closes the dialog, neither its
 * button nor Escape nor a press outside it, so the answer has somewhere to
 * arrive.
 *
 * @param {Object}   props
 * @param {boolean}  props.open        Whether the dialog is open.
 * @param {string}   props.sitePath    The site.
 * @param {string}   props.displayName The name it has now.
 * @param {Function} props.onRename    Renames it. Rejects when it could not.
 * @param {Function} props.onClose     Asked for by the close button, Escape, a press outside, or a rename that worked.
 */
export function RenameSiteDialog({ open, sitePath, displayName, onRename, onClose }) {
  const formId = useId();
  const [renaming, setRenaming] = useState(false);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next, details) => {
        if (next) return;
        if (renaming) {
          details.cancel();
          return;
        }
        onClose();
      }}
    >
      <Dialog.Popup size="small" className="rename-site-dialog">
        <Dialog.Header>
          <Dialog.Title>{__('Rename site')}</Dialog.Title>
          {renaming ? null : <Dialog.CloseIcon />}
        </Dialog.Header>
        <RenameSiteForm formId={formId} sitePath={sitePath} displayName={displayName} renaming={renaming} setRenaming={setRenaming} onRename={onRename} onClose={onClose} />
      </Dialog.Popup>
    </Dialog.Root>
  );
}
