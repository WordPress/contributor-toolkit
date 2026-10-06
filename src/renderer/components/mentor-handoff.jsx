import { useState } from 'react';
import { Button, TextControl } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { Text } from '@wordpress/ui';
import { Destination } from './destination.jsx';

// "Hand it to a mentor": the one destination for a patch that needs no account
// anywhere. The patch is saved carrying the contributor's WordPress.org
// username and the event they are at, so whoever pushes it knows whose props
// it is.
//
// `wporg` is what the app remembers about the contributor and how to change it
// (useContributorProvenance): held once for the window, because the answer is
// about the person and not about a checkout. This component owns the form that
// asks, what is typed in it, and whether it is showing. It is rendered only
// while the destinations are, so the form is empty and closed each time the
// dialog opens, and after a discard that leaves nothing to send: a name typed
// and abandoned is not waiting there.
//
// `onSave` writes the file; `saveDisabled` is the caller knowing the patch is
// not the contributor's own to hand over.
export function MentorHandoff({ wporg, saveDisabled, onSave }) {
  const [handleInput, setHandleInput] = useState('');
  const [eventInput, setEventInput] = useState('');
  const [handleError, setHandleError] = useState('');
  const [handleSaving, setHandleSaving] = useState(false);
  const [editingHandle, setEditingHandle] = useState(false);

  // Both fields are written in one go, because they are asked in one form. The
  // event is optional: an empty box means "not at an event", which is also how
  // it is cleared once the WordCamp is over.
  const rememberContributor = async () => {
    if (!wporg) return;
    setHandleSaving(true);
    setHandleError('');
    try {
      const named = await wporg.rememberHandle(handleInput);
      if (!named?.ok) {
        setHandleError(named?.error || __('Could not save that username.'));
        return;
      }
      const at = await wporg.rememberEvent(eventInput);
      if (!at?.ok) {
        setHandleError(at?.error || __('Could not save that event.'));
        return;
      }
      setHandleInput('');
      setEventInput('');
      setEditingHandle(false);
    } finally {
      setHandleSaving(false);
    }
  };

  return (
    <Destination
      title={__('Hand it to a mentor')}
      cost={__('No accounts at all. The patch carries your WordPress.org username, and the event you are at.')}
      after={__('Someone else pushes it; the props still land on you.')}
    >
      {wporg?.handle && !editingHandle ? (
        <>
          <Button variant="primary" onClick={onSave} disabled={saveDisabled}>
            {
              // translators: %s: the contributor's WordPress.org username.
              sprintf(__('Save patch as %s'), wporg.handle)
            }
          </Button>
          {/*
            The event is shown on every save rather than only when
            it is set: a remembered WordCamp from last year would
            otherwise keep stamping patches with nobody seeing it.
          */}
          <Text variant="body-sm" className="muted-label">
            {wporg.event
              ? createInterpolateElement(
                // translators: <event /> is the name of the event the contributor is at, such as WordCamp Europe 2026.
                __('The patch will say it was written at <strong><event /></strong>.'),
                // The name goes in as an element, not into the string: it is
                // free text, and a `<` in it would be read as markup.
                { strong: <strong />, event: <>{wporg.event}</> }
              )
              : __('No event on the patch.')}
          </Text>
          <Text variant="body-sm">
            <Button
              variant="link"
              onClick={() => {
                setHandleInput(wporg.handle);
                setEventInput(wporg.event || '');
                setHandleError('');
                setEditingHandle(true);
              }}
            >{__('Change these')}</Button>
          </Text>
        </>
      ) : (
        <>
          <Text variant="body-sm" className="muted-label">
            {__('Asked once and remembered for every site — these are facts about you, not about this checkout.')}
          </Text>
          <TextControl
            value={handleInput}
            onChange={(value) => { setHandleInput(value); setHandleError(''); }}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); rememberContributor(); } }}
            disabled={handleSaving}
            placeholder={__('WordPress.org username, e.g. janedoe')}
            aria-label={__('WordPress.org username')}
          />
          <TextControl
            value={eventInput}
            onChange={(value) => { setEventInput(value); setHandleError(''); }}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); rememberContributor(); } }}
            disabled={handleSaving}
            placeholder={__('Event, e.g. WordCamp Europe 2026 (optional)')}
            aria-label={__('Event this patch was written at')}
          />
          <Button
            variant="secondary"
            onClick={rememberContributor}
            isBusy={handleSaving}
            // Empty is a valid answer only when there is
            // something to clear — a shared laptop at a
            // contributor day, the next person taking over.
            // Before the first answer it would just be a button
            // that does nothing.
            disabled={handleSaving || (!handleInput.trim() && !wporg?.handle)}
          >{__('Remember this')}</Button>
          {handleError ? <Text variant="body-sm" className="problem-text" role="alert">{handleError}</Text> : null}
        </>
      )}
    </Destination>
  );
}
