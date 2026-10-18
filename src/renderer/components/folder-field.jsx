import { useId } from 'react';
import { __ } from '@wordpress/i18n';
import { Button, Field, Text } from '@wordpress/ui';

/**
 * A field whose answer is a folder (#557, #559).
 *
 * The field is a button that asks the system for a folder, since a page is
 * not told where one is, and the folder it holds is said under it. Not a
 * file input: Chromium draws that one's button and its "No file chosen" in
 * its own language, which is not always the window's, and a folder dropped
 * on it never had a path to give (#228, #655). The create-site dialog and
 * the settings both ask with it.
 *
 * @param {Object}   props
 * @param {string}   props.label         What the folder is for.
 * @param {string}   [props.description] Said under the folder.
 * @param {string}   [props.value]       The folder, or nothing for none.
 * @param {string}   [props.empty]       What to say in place of a folder when there is none.
 * @param {boolean}  [props.disabled]
 * @param {Function} props.onChoose      Asked to open the system's dialog.
 */
export function FolderField({ label, description, value, empty, disabled = false, onChoose }) {
  const labelId = useId();
  const textId = useId();
  // Named by the label and by what the button says, so "Choose folder" is
  // in the name a voice control user would say (#655), and described by the
  // folder it holds, so the folder is heard where the button is.
  return (
    <Field.Root className="folder-field" disabled={disabled}>
      <Field.Label><span id={labelId}>{label}</span></Field.Label>
      <Field.Control
        render={<Button variant="outline" tone="neutral" className="file-field-control"><span id={textId}>{__('Choose folder…')}</span></Button>}
        aria-labelledby={`${labelId} ${textId}`}
        disabled={disabled}
        onClick={onChoose}
      />
      <Field.Description render={<Text variant="body-sm" className="file-field-value" />}>{value || empty || __('No folder selected yet.')}</Field.Description>
      {description ? <Field.Description>{description}</Field.Description> : null}
    </Field.Root>
  );
}
