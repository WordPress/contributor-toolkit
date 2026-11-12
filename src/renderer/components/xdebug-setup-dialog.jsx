import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { speak } from '@wordpress/a11y';
import { createInterpolateElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { check as checkIcon, copy as copyIcon, error as errorIcon } from '@wordpress/icons';
import { Button, Dialog, Notice, Stack, Text } from '@wordpress/ui';
import { XDEBUG_PORT } from '../xdebug.cjs';

// The notes are there from the dialog's first moment, and read with it.
const SILENT = '';

// The words of a step, with the names of menus and settings in bold and file
// names as code.
const STEP_MARKUP = { b: <strong />, code: <code /> };

// A button that copies a text, following the design system's pattern for
// copying: the button keeps its name, shows how it went with its icon for two
// seconds after each copy, and says so to a screen reader. `onCopy` resolves
// to whether the copy worked. `describedBy` names what it copies, where
// several share the one name.
function CopyButton({ text, label = __('Copy'), describedBy, onCopy }) {
  const [result, setResult] = useState(null);
  const timeout = useRef(null);
  useEffect(() => () => clearTimeout(timeout.current), []);
  const copy = useCallback(async () => {
    const copied = await onCopy(text);
    setResult(copied ? 'copied' : 'failed');
    speak(copied ? __('Copied to clipboard') : __('Couldn’t copy to clipboard.'), 'polite');
    clearTimeout(timeout.current);
    timeout.current = setTimeout(() => setResult(null), 2000);
  }, [onCopy, text]);
  const icons = { copied: checkIcon, failed: errorIcon };
  const icon = icons[result] || copyIcon;
  return (
    <Button variant="minimal" tone="neutral" size="compact" aria-describedby={describedBy} onClick={() => copy()}>
      <Button.Icon icon={icon} />
      {label}
    </Button>
  );
}

// One numbered step: its words, and what goes with them, under the words.
function Step({ children, words }) {
  return (
    <li className="xdebug-setup-step">
      <Stack direction="column" gap="md">
        <Text variant="body-md">{createInterpolateElement(words, STEP_MARKUP)}</Text>
        {children}
      </Stack>
    </li>
  );
}

function OneSiteNote() {
  return (
    <Notice.Root intent="info" spokenMessage={SILENT}>
      <Notice.Description>
        {sprintf(
          // translators: %d: the port Xdebug connects to.
          __('Every site’s server sends Xdebug to port %d, so only one running site has Xdebug at a time: the first one started with it.'),
          XDEBUG_PORT
        )}
      </Notice.Description>
    </Notice.Root>
  );
}

// VS Code reads its debug setup from a file in the project, so it gets the
// whole file to paste.
function VsCodeSteps({ config, onCopy }) {
  return (
    <ol className="xdebug-setup-steps">
      <Step words={__('Install the <b>PHP Debug</b> extension by Xdebug.')} />
      <Step words={__('Open the site’s folder, and put this in <code>.vscode/launch.json</code>:')}>
        <div className="xdebug-launch-config-box">
          <pre className="xdebug-launch-config">{config}</pre>
          <Stack direction="row" justify="end">
            <CopyButton text={config} label={__('Copy launch.json')} onCopy={onCopy} />
          </Stack>
        </div>
      </Step>
      <Step words={__('In <b>Run and Debug</b>, start “Listen for Xdebug”, set a breakpoint, and load the site.')} />
    </ol>
  );
}

// Zed reads its debug setup from a file in the project as well, a list of
// scenarios for its PHP extension's Xdebug adapter.
function ZedSteps({ config, onCopy }) {
  return (
    <>
      <ol className="xdebug-setup-steps">
        <Step words={__('Run <b>zed: extensions</b> from the command palette, and install <b>PHP</b>. Its Xdebug adapter is what Zed debugs PHP with.')} />
        <Step words={__('Open the site’s folder, and put this in <code>.zed/debug.json</code>:')}>
          <div className="xdebug-launch-config-box">
            <pre className="xdebug-launch-config">{config}</pre>
            <Stack direction="row" justify="end">
              <CopyButton text={config} label={__('Copy debug.json')} onCopy={onCopy} />
            </Stack>
          </div>
        </Step>
        <Step words={__('Run <b>debugger: start</b> from the command palette, choose “Listen for Xdebug”, set a breakpoint, and load the site.')} />
      </ol>
      {/* Zed hides a scenario whose adapter it does not have, and says only that there are none. */}
      <Notice.Root intent="info" spokenMessage={SILENT}>
        <Notice.Description>{__('If Zed says no debug tasks were found, the PHP extension is not installed.')}</Notice.Description>
      </Notice.Root>
    </>
  );
}

// A value for PhpStorm's settings: its field's name over it, and its copy
// button at the end, described by that name.
function PhpStormValue({ value, onCopy }) {
  const labelId = useId();
  return (
    <div className="xdebug-value">
      <dt id={labelId} className="xdebug-value-label"><Text variant="body-sm" className="muted-label">{value.label}</Text></dt>
      <dd className="xdebug-value-text"><code>{value.value}</code></dd>
      <dd className="xdebug-value-copy"><CopyButton text={value.value} describedBy={labelId} onCopy={onCopy} /></dd>
    </div>
  );
}

// PhpStorm keeps its debug setup in its own settings, so it gets the values
// to enter there, each by the name of its field.
function PhpStormSteps({ values, onCopy }) {
  return (
    <ol className="xdebug-setup-steps">
      <Step
        words={sprintf(
          // translators: %d: the port Xdebug connects to. <b> marks the name of a settings page.
          __('In <b>Settings → PHP → Debug</b>, make sure Debug port includes %d, turn off both “Force break at first line” options, and turn off “Can accept external connections”, so only this computer can connect.'),
          XDEBUG_PORT
        )}
      />
      <Step words={__('In <b>Settings → PHP → Servers</b>, add a server with Xdebug as its debugger, turn on “Use path mappings”, and enter:')}>
        <dl className="xdebug-values">
          {values.map((value) => <PhpStormValue key={value.id} value={value} onCopy={onCopy} />)}
        </dl>
      </Step>
      <Step words={__('Turn on <b>Run → Start Listening for PHP Debug Connections</b>, set a breakpoint, and load the site.')} />
    </ol>
  );
}

/**
 * How to stop on breakpoints while the site's server has Xdebug (#723), for
 * one editor, picked from the Debugging row's menu: VS Code or Cursor, with
 * the launch.json they need, Zed, with its debug.json, or PhpStorm, with the
 * values its settings need. The
 * app shows and copies them, and never writes them into the checkout, where
 * they would end up in a patch.
 *
 * @param {Object}   props
 * @param {?Object}  props.editor   The editor while open, from `xdebugEditors`: `{id, name, setup}`; or null.
 * @param {string}   props.config   The launch.json, from `xdebugLaunchConfig`.
 * @param {string}   props.zed      The debug.json, from `zedDebugConfig`.
 * @param {Array}    props.phpStorm The PhpStorm values, from `phpStormSettings`.
 * @param {Function} props.onCopy   Copies a text, resolving to whether it worked.
 * @param {Function} props.onClose
 */
export function XdebugSetupDialog({ editor, config, zed, phpStorm, onCopy, onClose }) {
  // The editor stays drawn while the dialog closes, when `editor` is already
  // null.
  const [shown, setShown] = useState(editor);
  if (editor && editor !== shown) setShown(editor);
  const drawn = editor || shown;
  const setup = drawn ? drawn.setup : null;
  const phpStormShown = setup === 'phpstorm';
  const steps = {
    phpstorm: <PhpStormSteps values={phpStorm} onCopy={onCopy} />,
    zed: <ZedSteps config={zed} onCopy={onCopy} />
  };
  return (
    <Dialog.Root open={Boolean(editor)} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Popup size="medium" className="xdebug-setup-dialog">
        <Dialog.Header>
          <Dialog.Title>{sprintf(
            // translators: %s: an editor's name, such as VS Code or PhpStorm.
            __('Set up %s'),
            drawn ? drawn.name : ''
          )}</Dialog.Title>
          <Dialog.CloseIcon />
        </Dialog.Header>
        <Dialog.Content>
          <Stack direction="column" gap="lg">
            {steps[setup] || <VsCodeSteps config={config} onCopy={onCopy} />}
            {phpStormShown ? (
              <Notice.Root intent="info" spokenMessage={SILENT}>
                <Notice.Description>{__('If the site starts on another port, PhpStorm asks which server it is; update the Host above.')}</Notice.Description>
              </Notice.Root>
            ) : null}
            <OneSiteNote />
          </Stack>
        </Dialog.Content>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
