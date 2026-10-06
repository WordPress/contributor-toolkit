import { __ } from '@wordpress/i18n';
import { Field, Text } from '@wordpress/ui';

/**
 * A field whose answer is a folder (#557, #559).
 *
 * The field is a file input, which is what says "choose a folder" without a
 * word, and the folder it holds is said under it: the app asks the system
 * for a folder itself, since a page is not told where one is, and the input
 * is never left holding a selection. The create-site dialog and the settings
 * both ask with it.
 *
 * @param {Object}   props
 * @param {string}   props.label         What the folder is for.
 * @param {string}   [props.description] Said under the folder.
 * @param {string}   [props.value]       The folder, or nothing for none.
 * @param {string}   [props.empty]       What to say in place of a folder when there is none.
 * @param {boolean}  [props.disabled]
 * @param {Function} props.onChoose      Asked to open the system's dialog.
 * @param {Function} [props.onFiles]     A folder dropped on the input, which arrives as files.
 */
export function FolderField({ label, description, value, empty, disabled = false, onChoose, onFiles }) {
  return (
    <Field.Root className="folder-field" disabled={disabled}>
      <Field.Label>{label}</Field.Label>
      <Field.Control
        className="file-field-control"
        render={
          <input
            type="file"
            webkitdirectory=""
            // eslint-disable-next-line react/no-unknown-property -- non-standard but required alongside webkitdirectory for cross-browser directory pickers.
            directory=""
            multiple
          />
        }
        disabled={disabled}
        onChange={onFiles}
        onClick={(event) => { event.preventDefault(); onChoose(); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onChoose();
          }
        }}
      />
      <Text variant="body-sm" className="file-field-value">{value || empty || __('No folder selected yet.')}</Text>
      {description ? <Field.Description>{description}</Field.Description> : null}
    </Field.Root>
  );
}
