import { useCallback, useId, useState } from 'react';
// The segmented control the design has for a choice of two. The design
// system has no other, and documents this one under these names: it is
// stable in use and has not been given its final export yet.
// eslint-disable-next-line @wordpress/no-unsafe-wp-apis -- see above.
import { __experimentalToggleGroupControl as ToggleGroupControl, __experimentalToggleGroupControlOption as ToggleGroupControlOption } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { Button, Dialog, Field, InputControl, Notice, Stack, Text } from '@wordpress/ui';
import { DEFAULT_PROJECT_TYPE } from '../../project-type.cjs';
import { createSiteProblem, projectChoices, projectHelp } from '../create-site.cjs';
import { directoryFromFileEntry } from '../site-folder.cjs';

// The folder a site goes in. The field is a file input, which is what says
// "choose a folder" without a word, and the folder it shows is said under it:
// the app asks the system for a folder itself, since a page is not told
// where one is, and the input is never left holding a selection.
function FolderField({ value, disabled, onChoose, onFiles }) {
  return (
    <Field.Root disabled={disabled}>
      <Field.Label>{__('Location')}</Field.Label>
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
      <Text variant="body-sm" className="file-field-value">{value || __('No folder selected yet.')}</Text>
      <Field.Description>
        {__('Choose the parent folder where you want this new site created. A new subdirectory will be created for the site.')}
      </Field.Description>
    </Field.Root>
  );
}

// The dialog's three answers and the button that sends them. It is inside
// the dialog's popup, which is there while the dialog is open and not
// otherwise, so the answers are empty every time, on Core, however the last
// ones were left.
function CreateSiteForm({ formId, submitting, error, onError, onCreate }) {
  const [name, setName] = useState('');
  const [dir, setDir] = useState('');
  const [type, setType] = useState(DEFAULT_PROJECT_TYPE);
  const help = projectHelp(type);

  const chooseFolder = useCallback(async () => {
    try {
      const chosen = await window.api.chooseDirectory();
      if (chosen) {
        setDir(chosen);
        onError('');
      }
    } catch {}
  }, [onError]);

  // Not reached by the intended route, which is the system's dialog above:
  // a folder dropped on the input arrives here.
  const takeFiles = useCallback((event) => {
    const input = event.target;
    const files = input.files;
    if (files && files.length > 0) {
      const resolved = directoryFromFileEntry(files[0], input.value);
      setDir(resolved);
      // Clearing the error only when there is a directory: a selection that
      // resolved to nothing has not fixed anything the message was about.
      if (resolved) onError('');
    }
    input.value = '';
  }, [onError]);

  const submit = (event) => {
    event.preventDefault();
    const problem = createSiteProblem({ name, dir });
    if (problem) {
      onError(problem);
      return;
    }
    onCreate({ name: name.trim(), dir, projectType: type });
  };

  return (
    <>
      <Dialog.Content render={<form id={formId} onSubmit={submit} noValidate />}>
        <Stack direction="column" gap="lg">
          <InputControl
            label={__('Site name')}
            placeholder={__('My WordPress site')}
            value={name}
            disabled={submitting}
            onChange={(event) => setName(event.currentTarget.value)}
          />
          <ToggleGroupControl
            __nextHasNoMarginBottom
            __next40pxDefaultSize
            isBlock
            label={__('Project')}
            help={<><span>{help.about}</span> <span>{help.lasting}</span></>}
            value={type}
            disabled={submitting}
            onChange={(value) => { if (value) setType(value); }}
          >
            {projectChoices().map((project) => (
              <ToggleGroupControlOption key={project.value} value={project.value} label={project.label} />
            ))}
          </ToggleGroupControl>
          <FolderField value={dir} disabled={submitting} onChoose={chooseFolder} onFiles={takeFiles} />
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
        <Button type="submit" form={formId} loading={submitting} loadingAnnouncement={__('Setting up a site')}>{__('Create site')}</Button>
      </Dialog.Footer>
    </>
  );
}

/**
 * The dialog a site is created from (#553, #557): its name, the project it
 * is a checkout of, and the folder it goes in.
 *
 * It does not create anything. `onCreate({ name, dir, projectType })` is
 * called once every answer is there, with the name trimmed, and the caller
 * closes the dialog and runs the setup, which outlives it by minutes.
 * `submitting` is that setup still running: the dialog can be opened during
 * one, from the notice on a site the old engine made, and is then inert and
 * stays until the setup has ended, as it did before it was redrawn.
 *
 * The one message under the form is the caller's, not the dialog's: `error`
 * is shown and `onError` sets it. The dialog's complaint about a missing
 * answer and the reason a setup failed are the same line, and the second can
 * arrive while the dialog is open, or after it has closed and before it
 * opens again. Two copies of it, one here and one there, lose one or the
 * other.
 *
 * @param {Object}   props
 * @param {boolean}  props.open       Whether the dialog is open.
 * @param {boolean}  props.submitting A setup is running.
 * @param {string}   props.error      The message under the form, or ''.
 * @param {Function} props.onError    Sets that message.
 * @param {Function} props.onCreate   Given `{ name, dir, projectType }` once every answer is there.
 * @param {Function} props.onClose    Asked for by the close button, Escape, or a press outside.
 */
export function CreateSiteDialog({ open, submitting, error, onError, onCreate, onClose }) {
  const formId = useId();
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next, details) => {
        if (next) return;
        if (submitting) {
          details.cancel();
          return;
        }
        onClose();
      }}
    >
      {/* The dialog opens on the name: the design system puts the focus on
          the first thing in it that is not its close button. */}
      <Dialog.Popup size="small" className="create-site-dialog">
        <Dialog.Header>
          <Dialog.Title>{__('Create site')}</Dialog.Title>
          {submitting ? null : <Dialog.CloseIcon />}
        </Dialog.Header>
        <CreateSiteForm formId={formId} submitting={submitting} error={error} onError={onError} onCreate={onCreate} />
      </Dialog.Popup>
    </Dialog.Root>
  );
}
