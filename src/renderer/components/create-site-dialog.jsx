import { useCallback, useId, useState } from 'react';
// The segmented control the design has for a choice of two. The design
// system has no other, and documents this one under these names: it is
// stable in use and has not been given its final export yet.
// eslint-disable-next-line @wordpress/no-unsafe-wp-apis -- see above.
import { __experimentalToggleGroupControl as ToggleGroupControl, __experimentalToggleGroupControlOption as ToggleGroupControlOption } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { Button, Dialog, InputControl, Notice, Stack } from '@wordpress/ui';
import { DEFAULT_PROJECT_TYPE } from '../../project-type.cjs';
import { createSiteProblem, projectChoices, projectHelp } from '../create-site.cjs';
import { FolderField } from './folder-field.jsx';

// The dialog's three answers and the button that sends them. It is inside
// the dialog's popup, which is there while the dialog is open, and for the
// moment it takes to fade once it is closed, and not otherwise. So the
// answers are empty every time, on Core, however the last ones were left;
// the folder starts as the one the settings name, where they name one
// (#559), and is still the contributor's to change.
function CreateSiteForm({ formId, submitting, defaultDir, onCreate }) {
  // Which answer is missing, said under the form.
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [dir, setDir] = useState(defaultDir || '');
  const [type, setType] = useState(DEFAULT_PROJECT_TYPE);
  const help = projectHelp(type);

  const chooseFolder = useCallback(async () => {
    try {
      const chosen = await window.api.chooseDirectory();
      if (chosen) {
        setDir(chosen);
        setError('');
      }
    } catch {}
  }, []);

  const submit = (event) => {
    event.preventDefault();
    const problem = createSiteProblem({ name, dir });
    if (problem) {
      setError(problem);
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
            help={<><span>{help.about}</span><span>{help.lasting}</span></>}
            value={type}
            disabled={submitting}
            onChange={(value) => { if (value) setType(value); }}
          >
            {projectChoices().map((project) => (
              <ToggleGroupControlOption key={project.value} value={project.value} label={project.label} />
            ))}
          </ToggleGroupControl>
          <FolderField
            label={__('Location')}
            description={__('Choose the parent folder where you want this new site created. A new subdirectory will be created for the site.')}
            value={dir}
            disabled={submitting}
            onChoose={chooseFolder}
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
 * The message under the form is the dialog's own complaint about a missing
 * answer. Why a setup failed is not said here: the dialog that asked for it
 * closed as it began, and the window says it in its corner (#557), whether
 * or not a dialog happens to be open by then.
 *
 * @param {Object}   props
 * @param {boolean}  props.open         Whether the dialog is open.
 * @param {boolean}  props.submitting   A setup is running.
 * @param {?string}  [props.defaultDir] The folder the settings say new sites go in, if any.
 * @param {Function} props.onCreate     Given `{ name, dir, projectType }` once every answer is there.
 * @param {Function} props.onClose      Asked for by the close button, Escape, or a press outside.
 */
export function CreateSiteDialog({ open, submitting, defaultDir = null, onCreate, onClose }) {
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
        <CreateSiteForm formId={formId} submitting={submitting} defaultDir={defaultDir} onCreate={onCreate} />
      </Dialog.Popup>
    </Dialog.Root>
  );
}
