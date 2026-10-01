import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Modal, RadioControl, TextControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { PROJECT_TYPES, DEFAULT_PROJECT_TYPE } from '../../project-type.cjs';
import { directoryFromFileEntry } from '../site-folder.cjs';

const CREATE_SITE_NAME_INPUT_ID = 'create-site-name-input';
const CREATE_SITE_LOCATION_INPUT_ID = 'create-site-location-input';
const CREATE_SITE_LOCATION_HELP_ID = 'create-site-location-help';
// What the create-site dialog offers under "Contribute to", read off the
// registry so the copy and the order live in one place. Core is first, and
// the default.
// A function, not a constant: each description is translated when it is read,
// which has to be after the locale has loaded.
const createSiteTypeOptions = () => Object.values(PROJECT_TYPES).map((t) => ({ label: t.wizardLabel, value: t.id, description: t.description }));
const CREATE_SITE_MODAL_STYLE_ID = 'create-site-modal-theme';

// The dialog a site is created from: its name, the project it is a checkout
// of, and the folder it goes in. It owns those three answers and the sentence
// that says one is missing, and is mounted while it is open and not otherwise,
// so it opens empty every time, on Core, however the last one was left.
//
// It does not create anything. `onCreate({ name, dir, projectType })` is
// called once every answer is there, with the name trimmed, and the caller
// closes the dialog and runs the setup, which outlives it by minutes.
// `submitting` is that setup still running: the dialog can be opened during
// one, from the notice on a site the old engine made, and is then inert.
// `initialError` is what it opens showing, which is how a setup that failed
// after the dialog closed gets said in the dialog at all.
export function CreateSiteModal({ submitting, initialError = '', onCreate, onClose }) {
  const createDirInputRef = useRef(null);
  const [createSiteName, setCreateSiteName] = useState('');
  const [createSiteDir, setCreateSiteDir] = useState('');
  const [createSiteType, setCreateSiteType] = useState(DEFAULT_PROJECT_TYPE);
  const [createSiteError, setCreateSiteError] = useState(initialError);

  useEffect(() => {
    let styleEl = document.getElementById(CREATE_SITE_MODAL_STYLE_ID);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = CREATE_SITE_MODAL_STYLE_ID;
      styleEl.textContent = `
.create-site-modal .components-modal__header-heading { color: #1d2327; }
.create-site-modal .components-modal__header { border-bottom: 1px solid #e2e4e7; }
.create-site-modal .components-modal__content { color: #1d2327; }
`;
      document.head.appendChild(styleEl);
    }
  }, []);

  useEffect(() => {
    const input = document.getElementById(CREATE_SITE_NAME_INPUT_ID);
    if (input) {
      input.focus();
      if (typeof input.select === 'function') input.select();
    }
  }, []);

  const openDirectoryPicker = useCallback(async () => {
    try {
      const dir = await window.api.chooseDirectory();
      if (dir) {
        setCreateSiteDir(dir);
        setCreateSiteError('');
      }
    } catch {}
  }, []);

  const handleCreateDirInputChange = useCallback((event) => {
    const inputEl = event.target;
    createDirInputRef.current = inputEl;
    const files = inputEl.files;
    if (!files || files.length === 0) {
      inputEl.value = '';
      return;
    }

    const resolved = directoryFromFileEntry(files[0], inputEl.value);
    setCreateSiteDir(resolved);
    // Clearing the error only when there is a directory: a selection that
    // resolved to nothing has not fixed anything the message was about.
    if (resolved) setCreateSiteError('');
    inputEl.value = '';
  }, [setCreateSiteDir, setCreateSiteError]);

  const handleCreateSiteSubmit = useCallback(() => {
    const nameTrimmed = createSiteName.trim();
    if (!nameTrimmed) {
      setCreateSiteError(__('Please provide a site name.'));
      return;
    }
    if (!createSiteDir) {
      setCreateSiteError(__('Please choose where to create the site.'));
      return;
    }
    onCreate({ name: nameTrimmed, dir: createSiteDir, projectType: createSiteType });
  }, [createSiteDir, createSiteName, createSiteType, onCreate]);

  const closeCreateModal = useCallback(() => {
    if (submitting) return;
    onClose();
  }, [submitting, onClose]);

  const handleCreateModalSubmit = useCallback((event) => {
    event.preventDefault();
    handleCreateSiteSubmit();
  }, [handleCreateSiteSubmit]);

  const handleCreateModalKeyDown = useCallback((event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeCreateModal();
    }
  }, [closeCreateModal]);

  const handleCreateDirInputClick = useCallback((event) => {
    event.preventDefault();
    void openDirectoryPicker();
  }, [openDirectoryPicker]);

  return (
    <Modal
      className="create-site-modal"
      title={__('Create a site')}
      onRequestClose={closeCreateModal}
      shouldCloseOnClickOutside={!submitting}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape-to-close/Enter-to-submit on the modal form is standard, intentional behavior. */}
      <form
        onSubmit={handleCreateModalSubmit}
        onKeyDown={handleCreateModalKeyDown}
        style={{ display: 'flex', flexDirection: 'column', gap: 16, color: '#1d2327', colorScheme: 'light' }}
      >
        <TextControl
          id={CREATE_SITE_NAME_INPUT_ID}
          label={__('Site name')}
          value={createSiteName}
          onChange={(value) => setCreateSiteName(value)}
          disabled={submitting}
          placeholder={__('My WordPress site')}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional: this is the first field of a just-opened modal.
          autoFocus
        />
        <RadioControl
          label={__('Contribute to')}
          help={__('What this site is a checkout of: which repository it clones, and how it builds and runs. It cannot be changed later.')}
          selected={createSiteType}
          options={createSiteTypeOptions()}
          onChange={(value) => setCreateSiteType(value)}
          disabled={submitting}
        />
        <label htmlFor={CREATE_SITE_LOCATION_INPUT_ID} style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em', color: '#1d2327' }}>{__('Site location')}</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <input
            ref={createDirInputRef}
            id={CREATE_SITE_LOCATION_INPUT_ID}
            type="file"
            webkitdirectory=""
            // eslint-disable-next-line react/no-unknown-property -- non-standard but required alongside webkitdirectory for cross-browser directory pickers.
            directory=""
            multiple
            onChange={handleCreateDirInputChange}
            onClick={handleCreateDirInputClick}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                void openDirectoryPicker();
              }
            }}
            disabled={submitting}
            aria-describedby={CREATE_SITE_LOCATION_HELP_ID}
            style={{ height: 40, color: '#1d2327', background: '#fff', border: '1px solid #8c8f94', borderRadius: 4, padding: '6px 10px' }}
          />
          <span style={{ fontSize: 12, color: '#3c434a' }}>{createSiteDir || __('No folder selected yet.')}</span>
        </div>
        <div id={CREATE_SITE_LOCATION_HELP_ID} style={{ fontSize: 12, color: '#3c434a', marginTop: -4 }}>
          {__('Choose the parent folder where you want this new site created. We\'ll add a new directory inside it for the project.')}
        </div>
        {createSiteError ? (
          <div style={{ color: '#d63638', fontSize: 12 }}>{createSiteError}</div>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button type="button" variant="secondary" onClick={closeCreateModal} disabled={submitting}>{__('Cancel')}</Button>
          <Button type="submit" variant="primary" isBusy={submitting} disabled={submitting}>{__('Create site')}</Button>
        </div>
      </form>
    </Modal>
  );
}
