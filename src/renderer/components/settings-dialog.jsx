import { useEffect, useId, useMemo, useState } from 'react';
// The segmented control the design has for a choice of a few. The design
// system has no other, and documents this one under these names: it is
// stable in use and has not been given its final export yet.
// eslint-disable-next-line @wordpress/no-unsafe-wp-apis -- see above.
import { __experimentalToggleGroupControl as ToggleGroupControl, __experimentalToggleGroupControlOption as ToggleGroupControlOption } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { Button, Dialog, InputControl, Notice, SelectControl, Stack, SwitchControl, Tabs, Text } from '@wordpress/ui';
import { githubAccountLine, newSiteLocationNote, languageItems, languageValue, languageChanged, SYSTEM_LANGUAGE } from '../settings-view.cjs';
import { FolderField } from './folder-field.jsx';

// A notice here is read by its role, and is not also spoken: the dialog it
// is in is open and being read.
const SILENT = '';

// The language the app shows, from the ones the build has a catalog for.
// Main applies a catalog as it starts, so a change is shown after a relaunch,
// which the control offers once what is set is no longer what the window is
// in. The relaunch is a quit: running servers and builds stop, as on any.
function LanguageControl({ settings, loaded, onChange }) {
  const [languages, setLanguages] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    window.api.listLanguages()
      .then((res) => { if (!cancelled && res?.ok) setLanguages(res.languages); })
      .catch(() => { if (!cancelled) setLanguages([]); });
    return () => { cancelled = true; };
  }, []);

  // The entries are drawn here, each with its tag as its value, and the
  // list is also handed over for the names: handed the list alone, the
  // control takes each entry as its own value and tells them apart by
  // identity, which a value kept elsewhere cannot match. The entries are
  // made from the language the window started in and not the one set, so
  // that a choice does not change them: an entry taken away under the
  // control while it is choosing is reported as a second choice, of none.
  const locale = settings ? settings.locale : null;
  const started = loaded ? loaded.locale : null;
  const items = useMemo(() => languageItems(languages, started), [languages, started]);

  const choose = async (value) => {
    const result = await onChange('locale', languageValue(value));
    setError(result?.ok ? '' : (result?.error || __('Could not keep that language.')));
  };
  const relaunch = () => {
    window.api.relaunch().catch(() => setError(__('The app could not relaunch. Quit it and open it again.')));
  };

  return (
    <Stack direction="column" gap="md">
      <SelectControl
        label={__('Language')}
        description={__('Which language the app is shown in. A change applies after a relaunch.')}
        items={items}
        value={locale || SYSTEM_LANGUAGE}
        disabled={!settings || !languages}
        onValueChange={choose}
      >
        {items.map((item) => (
          <SelectControl.Item key={item.value} value={item.value} label={item.label}>
            <SelectControl.ItemLabel>{item.label}</SelectControl.ItemLabel>
          </SelectControl.Item>
        ))}
      </SelectControl>
      {error ? (
        <Notice.Root intent="error" role="alert" spokenMessage={SILENT}>
          <Notice.Description>{error}</Notice.Description>
        </Notice.Root>
      ) : null}
      {languageChanged(settings, loaded) ? (
        <Notice.Root intent="info" role="status" spokenMessage={SILENT}>
          <Notice.Description>{__('The app shows the new language once it has relaunched. Running servers and builds stop, as they do when the app quits.')}</Notice.Description>
          <Notice.Actions>
            <Button variant="outline" size="compact" onClick={relaunch}>{__('Relaunch now')}</Button>
          </Notice.Actions>
        </Notice.Root>
      ) : null}
    </Stack>
  );
}

// The folder new sites go in. The system's dialog chooses it, main checks
// it, and what main then holds is what is shown: a folder it refused is
// said under the field and nothing changes.
function GeneralTab({ settings, loaded, onChange }) {
  const [error, setError] = useState('');
  const location = settings ? settings.newSiteLocation : null;

  const keep = async (value) => {
    const result = await onChange('newSiteLocation', value);
    setError(result?.ok ? '' : (result?.error || __('Could not keep that folder.')));
  };
  const choose = async () => {
    let chosen = null;
    try {
      chosen = await window.api.chooseDirectory();
    } catch {
      return;
    }
    if (chosen) await keep(chosen);
  };

  return (
    <Stack direction="column" gap="2xl">
      <Stack direction="column" gap="xl">
        <Text variant="heading-lg" render={<h3 />}>{__('Appearance')}</Text>
        <LanguageControl settings={settings} loaded={loaded} onChange={onChange} />
      </Stack>
      <Stack direction="column" gap="xl">
        <Text variant="heading-lg" render={<h3 />}>{__('New sites')}</Text>
        <FolderField
          label={__('New sites go here')}
          description={__('Each new site is created in a subfolder of this location.')}
          value={location}
          empty={newSiteLocationNote(settings)}
          disabled={!settings}
          onChoose={choose}
        />
        {location ? (
          <div>
            <Button variant="minimal" tone="neutral" size="compact" onClick={() => keep(null)}>{__('Forget this folder')}</Button>
          </div>
        ) : null}
        {error ? (
          <Notice.Root intent="error" role="alert" spokenMessage={SILENT}>
            <Notice.Description>{error}</Notice.Description>
          </Notice.Root>
        ) : null}
      </Stack>
    </Stack>
  );
}

// What a site's development server runs with: the PHP it runs on, from the
// versions the bundled Playground has, and the two debug constants that can
// be turned off. Applied the next time a server starts; one that is running
// keeps what it started with until it is started again.
function SitesTab({ settings, onChange }) {
  const [versions, setVersions] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    window.api.listPhpVersions()
      .then((res) => { if (!cancelled && res?.ok) setVersions(res.versions); })
      .catch(() => { if (!cancelled) setVersions([]); });
    return () => { cancelled = true; };
  }, []);

  const keep = async (key, value) => {
    const result = await onChange(key, value);
    setError(result?.ok ? '' : (result?.error || __('Could not keep that.')));
  };
  // The version set is offered even where the list does not have it, so
  // the control shows what is set rather than nothing.
  const offered = versions && settings && !versions.includes(settings.phpVersion) ? [settings.phpVersion, ...versions] : versions;

  return (
    <Stack direction="column" gap="xl">
      <Text variant="heading-lg" render={<h3 />}>{__('Development server')}</Text>
      <Text variant="body-sm">{__('Applies the next time a site’s server starts. A server that is running keeps what it started with.')}</Text>
      <ToggleGroupControl
        __nextHasNoMarginBottom
        __next40pxDefaultSize
        isBlock
        label={__('PHP version')}
        value={settings ? settings.phpVersion : undefined}
        disabled={!settings || !offered}
        onChange={(value) => { if (value) keep('phpVersion', value); }}
      >
        {(offered || []).map((version) => (
          <ToggleGroupControlOption key={version} value={version} label={version} />
        ))}
      </ToggleGroupControl>
      <SwitchControl
        label={__('Show PHP errors (WP_DEBUG)')}
        description={__('Notices, warnings and deprecations are reported, written to debug.log and shown in the browser. Off, the debug.log tab has nothing new to show.')}
        checked={settings ? settings.wpDebug : true}
        disabled={!settings}
        onCheckedChange={(checked) => keep('wpDebug', checked)}
      />
      <SwitchControl
        label={__('Use unminified scripts (SCRIPT_DEBUG)')}
        description={__('Core serves its JavaScript and CSS unminified, so they can be read and stepped through in the browser.')}
        checked={settings ? settings.scriptDebug : true}
        disabled={!settings}
        onCheckedChange={(checked) => keep('scriptDebug', checked)}
      />
      {error ? (
        <Notice.Root intent="error" role="alert" spokenMessage={SILENT}>
          <Notice.Description>{error}</Notice.Description>
        </Notice.Root>
      ) : null}
    </Stack>
  );
}

// Who the contributor is, as the mentor handoff asks it (#166) and through
// the same answers (useContributorProvenance), so that the two never
// disagree; and the GitHub account the app acts for (#167), which is signed
// in to where it is used and can be signed out of here.
function AccountTab({ wporg }) {
  const formId = useId();
  const [handle, setHandle] = useState(wporg?.handle || '');
  const [event, setEvent] = useState(wporg?.event || '');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [account, setAccount] = useState(null);

  useEffect(() => {
    let cancelled = false;
    window.api.getGithubAccount()
      .then((res) => { if (!cancelled) setAccount(res && res.ok ? res : { login: null, configured: false }); })
      .catch(() => { if (!cancelled) setAccount({ login: null, configured: false }); });
    return () => { cancelled = true; };
  }, []);

  // Both fields are written in one go, because they are asked in one form.
  // An empty one forgets what it held: the event, once the WordCamp is over.
  const save = async (submit) => {
    submit.preventDefault();
    if (!wporg) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const named = await wporg.rememberHandle(handle);
      if (!named?.ok) {
        setError(named?.error || __('Could not save that username.'));
        return;
      }
      const at = await wporg.rememberEvent(event);
      if (!at?.ok) {
        setError(at?.error || __('Could not save that event.'));
        return;
      }
      // As main kept them: a pasted profile link is kept as the username.
      setHandle(named.handle || '');
      setEvent(at.event || '');
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const signOut = async () => {
    try {
      await window.api.signOutOfGithub();
    } catch {}
    setAccount((prev) => ({ ...(prev || { configured: true }), login: null }));
  };

  const github = githubAccountLine(account);
  const edit = (set) => (change) => {
    set(change.currentTarget.value);
    setSaved(false);
    setError('');
  };

  return (
    <Stack direction="column" gap="2xl">
      <form id={formId} onSubmit={save} noValidate>
        <Stack direction="column" gap="xl">
          <Text variant="heading-lg" render={<h3 />}>{__('How you contribute')}</Text>
          <InputControl
            label={__('WordPress.org username')}
            description={__('Goes on a patch you hand to a mentor, so the props land on you.')}
            value={handle}
            disabled={saving}
            onChange={edit(setHandle)}
          />
          <InputControl
            label={__('Event')}
            description={__('Where you are contributing from, if you are at an event. Leave it empty otherwise.')}
            value={event}
            disabled={saving}
            onChange={edit(setEvent)}
          />
          {error ? (
            <Notice.Root intent="error" role="alert" spokenMessage={SILENT}>
              <Notice.Description>{error}</Notice.Description>
            </Notice.Root>
          ) : null}
          {saved ? (
            <Notice.Root intent="success" role="status" spokenMessage={SILENT}>
              <Notice.Description>{__('Saved.')}</Notice.Description>
            </Notice.Root>
          ) : null}
          <div>
            <Button type="submit" form={formId} loading={saving} loadingAnnouncement={__('Saving')}>{__('Save')}</Button>
          </div>
        </Stack>
      </form>
      <Stack direction="column" gap="md">
        <Text variant="heading-lg" render={<h3 />}>{__('GitHub')}</Text>
        <Text variant="body-md">{github.text}</Text>
        {github.canSignOut ? (
          <div>
            <Button variant="outline" onClick={signOut}>{__('Sign out')}</Button>
          </div>
        ) : null}
      </Stack>
    </Stack>
  );
}

// The tabs and what is on each. Inside the dialog's popup, which is there
// while the dialog is open and not otherwise, so every opening starts on
// General with nothing typed and not yet saved.
function SettingsPanels({ settings, loaded, onChange, wporg }) {
  const [tab, setTab] = useState('general');
  return (
    <Dialog.Content>
      <Tabs.Root value={tab} onValueChange={setTab} render={<Stack direction="column" gap="md" />}>
        <div className="settings-tabs-bar">
          <Tabs.List variant="minimal" className="settings-tabs">
            <Tabs.Tab value="general">{__('General')}</Tabs.Tab>
            <Tabs.Tab value="sites">{__('Sites')}</Tabs.Tab>
            <Tabs.Tab value="account">{__('Account')}</Tabs.Tab>
          </Tabs.List>
          <hr className="card-divider" />
        </div>
        <Tabs.Panel value="general" tabIndex={-1} className="settings-panel">
          <GeneralTab settings={settings} loaded={loaded} onChange={onChange} />
        </Tabs.Panel>
        <Tabs.Panel value="sites" tabIndex={-1} className="settings-panel">
          <SitesTab settings={settings} onChange={onChange} />
        </Tabs.Panel>
        <Tabs.Panel value="account" tabIndex={-1} className="settings-panel">
          <AccountTab wporg={wporg} />
        </Tabs.Panel>
      </Tabs.Root>
    </Dialog.Content>
  );
}

/**
 * The settings dialog (#559): the app's settings, on tabs, opened from the
 * footer's cog or the menu's "Settings…".
 *
 * It holds no setting itself. `settings` is what main holds (useSettings),
 * null while it has not answered, and `onChange(key, value)` asks main to
 * change one and resolves to its answer. `wporg` is what the app remembers
 * about the contributor (useContributorProvenance), which the mentor handoff
 * shares.
 *
 * @param {Object}   props
 * @param {boolean}  props.open     Whether the dialog is open.
 * @param {?Object}  props.settings The settings, or null while they are read.
 * @param {?Object}  props.loaded   The settings as the window first read them, for what takes a relaunch.
 * @param {Function} props.onChange Changes one setting; resolves to `{ ok, settings }` or `{ ok: false, error }`.
 * @param {Object}   props.wporg    The contributor's details and how to change them.
 * @param {Function} props.onClose  Asked for by the close button, Escape, or a press outside.
 */
export function SettingsDialog({ open, settings, loaded, onChange, wporg, onClose }) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Popup size="medium" className="settings-dialog">
        <Dialog.Header>
          <Dialog.Title>{__('Settings')}</Dialog.Title>
          <Dialog.CloseIcon />
        </Dialog.Header>
        <SettingsPanels settings={settings} loaded={loaded} onChange={onChange} wporg={wporg} />
      </Dialog.Popup>
    </Dialog.Root>
  );
}
