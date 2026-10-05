import { useState } from 'react';
import { __ } from '@wordpress/i18n';
import { AlertDialog } from '@wordpress/ui';

/**
 * The question asked before something is done that cannot be undone (#557):
 * what would go, and a button that says what it does.
 *
 * It is open while there is a question. `onConfirm` is called on a yes, and
 * the dialog closes at once: what was asked for goes on without it, and says
 * how it stands where it always did. `onClose` is called however the dialog
 * is left, a yes included, and is where the question is put away.
 *
 * The design system's alert dialog is not closed by a press outside it, and
 * opens on its Cancel button.
 *
 * @param {Object}   props
 * @param {?Object}  props.question  `{ title, description, confirm }`, or null for no question.
 * @param {Function} props.onConfirm The answer was yes.
 * @param {Function} props.onClose   The dialog was left.
 */
export function ConfirmDialog({ question, onConfirm, onClose }) {
  // What was asked is kept while the dialog fades, or it would empty first.
  const [last, setLast] = useState(question);
  if (question && question !== last) setLast(question);
  const shown = question || last;
  return (
    <AlertDialog.Root
      open={Boolean(question)}
      onOpenChange={(next) => { if (!next) onClose(); }}
      onConfirm={() => { onConfirm(); }}
    >
      {shown ? (
        <AlertDialog.Popup
          className="confirm-dialog"
          intent="irreversible"
          title={shown.title}
          description={shown.description}
          confirmButtonText={shown.confirm}
          cancelButtonText={__('Cancel')}
        />
      ) : null}
    </AlertDialog.Root>
  );
}
