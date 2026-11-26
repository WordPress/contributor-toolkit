import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { speak } from '@wordpress/a11y';
import { ExternalLink } from '@wordpress/components';
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
function Step({ children, words, markup = STEP_MARKUP }) {
  return (
    <li className="xdebug-setup-step">
      <Stack direction="column" gap="md">
        <Text variant="body-md">{createInterpolateElement(words, markup)}</Text>
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

const PHP_DEBUG_EXTENSION_URL = 'https://marketplace.visualstudio.com/items?itemName=xdebug.php-debug';

// VS Code reads its debug setup from a file in the project. The app can create
// it when missing, and opens an existing file without replacing its contents.
function VsCodeSteps({ config, onCopy, sitePath, editorPath, editorName, isOpen }) {
  const [fileStatus, setFileStatus] = useState('checking');
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState('');

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    setFileStatus('checking');
    window.api.xdebugLaunchConfigFile(sitePath, config, false)
      .then((result) => {
        if (cancelled) return;
        if (result?.ok) setFileStatus(result.exists ? 'exists' : 'missing');
        else setFileStatus('unknown');
      })
      .catch((error) => {
        if (!cancelled) {
          setFileStatus('unknown');
          // eslint-disable-next-line no-console -- reaches the log file through spyRendererConsole.
          console.error('Could not check the Xdebug launch file:', error);
        }
      });
    return () => { cancelled = true; };
  }, [config, isOpen, sitePath]);

  const openLaunchFile = useCallback(async () => {
    setFileBusy(true);
    setFileError('');
    try {
      const prepared = await window.api.xdebugLaunchConfigFile(sitePath, config, true);
      if (!prepared?.ok) {
        setFileError(__('Could not create .vscode/launch.json. You can still copy the configuration below.'));
        return;
      }
      setFileStatus('exists');
      const opened = await window.api.openInEditor(sitePath, editorPath, '.vscode/launch.json');
      if (!opened?.ok) {
        setFileError(sprintf(
          // translators: %s: an editor's name, such as VS Code.
          __('The file is ready, but %s could not open it. Open .vscode/launch.json from the site folder instead.'),
          editorName
        ));
      }
    } catch (error) {
      // eslint-disable-next-line no-console -- reaches the log file through spyRendererConsole.
      console.error('Could not create or open the Xdebug launch file:', error);
      setFileError(__('Could not create or open .vscode/launch.json. You can still copy the configuration below.'));
    } finally {
      setFileBusy(false);
    }
  }, [config, editorName, editorPath, sitePath]);

  const fileButtonLabel = () => {
    if (fileStatus === 'checking') return __('Checking launch.json…');
    if (fileStatus === 'exists') {
      return sprintf(
        // translators: %s: an editor's name, such as VS Code.
        __('Open launch.json in %s to edit'),
        editorName
      );
    }
    if (fileStatus === 'unknown') {
      return sprintf(
        // translators: %s: an editor's name, such as VS Code.
        __('Add or open launch.json in %s'),
        editorName
      );
    }
    return sprintf(
      // translators: %s: an editor's name, such as VS Code.
      __('Add launch.json and open in %s'),
      editorName
    );
  };
  const extensionLink = (
    <ExternalLink
      href={PHP_DEBUG_EXTENSION_URL}
      onClick={(event) => { event.preventDefault(); window.api.openExternal(PHP_DEBUG_EXTENSION_URL); }}
    />
  );

  return (
    <ol className="xdebug-setup-steps">
      <Step words={__('Install the <link>PHP Debug</link> extension for VS Code.')} markup={{ ...STEP_MARKUP, link: extensionLink }} />
      <Step words={__('Open the site’s folder, and put this in <code>.vscode/launch.json</code>:')}>
        <div className="xdebug-launch-config-box">
          <pre className="xdebug-launch-config">{config}</pre>
          <Stack direction="row" justify="space-between" gap="sm">
            <Button variant="outline" tone="neutral" size="compact" disabled={fileBusy || fileStatus === 'checking' || !editorPath} onClick={() => openLaunchFile()}>
              {fileBusy ? __('Opening…') : fileButtonLabel()}
            </Button>
            <CopyButton text={config} label={__('Copy launch.json')} onCopy={onCopy} />
          </Stack>
          {fileError ? <Text variant="body-sm" className="error-text" role="status">{fileError}</Text> : null}
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

// Sublime Text debugs PHP with the Debugger package, a third-party package
// whose setup is its own README's to say (#758). The dialog gives only what
// this site needs, and names the Node.js the PHP adapter needs, which the
// README does not. It deliberately leaves out the fix for a Sublime opened
// from the macOS Dock not finding an nvm or Homebrew Node (the package's
// `node` setting): the README does not cover that either, and the app does
// not troubleshoot a third-party package.
const SUBLIME_DEBUGGER_URL = 'https://github.com/daveleroy/SublimeDebugger';

function SublimeSteps({ config, onCopy }) {
  // A real link, so it is announced as one and its address can be copied;
  // the browser opens it, not the window.
  const link = (
    <ExternalLink
      href={SUBLIME_DEBUGGER_URL}
      onClick={(event) => { event.preventDefault(); window.api.openExternal(SUBLIME_DEBUGGER_URL); }}
    />
  );
  return (
    <>
      <Text variant="body-md">{createInterpolateElement(
        __('Sublime Text debugs PHP with the <b>Debugger</b> package and its PHP adapter, which needs Node.js. If you haven’t set them up, follow the <link>Debugger package’s setup guide</link>.'),
        { ...STEP_MARKUP, link }
      )}</Text>
      <ol className="xdebug-setup-steps">
        <Step words={__('Save this in the site’s folder as <code>xdebug.sublime-project</code>, and open it with <b>Project → Open Project</b>:')}>
          <div className="xdebug-launch-config-box">
            <pre className="xdebug-launch-config">{config}</pre>
            <Stack direction="row" justify="end">
              <CopyButton text={config} label={__('Copy project file')} onCopy={onCopy} />
            </Stack>
          </div>
        </Step>
        <Step words={__('Press the Debugger’s play button, choose “Listen for Xdebug”, then press play again. Set a breakpoint, and load the site.')} />
      </ol>
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
          __('In <b>Settings → PHP → Debug</b>, make sure Debug port includes %d, and turn off both “Force break at first line” options.'),
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
 * the launch.json they need, Zed, with its debug.json, Sublime Text, with its
 * project file, or PhpStorm, with the values its settings need. The app
 * shows and copies them; for VS Code it can add the launch file if it is
 * missing, but never replaces one already there.
 *
 * @param {Object}   props
 * @param {?Object}  props.editor     The editor while open, from `xdebugEditors`: `{id, name, setup}`; or null.
 * @param {string}   props.config     The launch.json, from `xdebugLaunchConfig`.
 * @param {string}   props.sitePath   The site's folder.
 * @param {?string}  props.editorPath The detected application path to open the setup file in.
 * @param {string}   props.zed        The debug.json, from `zedDebugConfig`.
 * @param {string}   props.sublime    The .sublime-project, from `sublimeProjectConfig`.
 * @param {Array}    props.phpStorm   The PhpStorm values, from `phpStormSettings`.
 * @param {Function} props.onCopy     Copies a text, resolving to whether it worked.
 * @param {Function} props.onClose
 */
export function XdebugSetupDialog({ editor, config, zed, sublime, phpStorm, sitePath, editorPath, onCopy, onClose }) {
  // The editor stays drawn while the dialog closes, when `editor` is already
  // null.
  const [shown, setShown] = useState(editor);
  if (editor && editor !== shown) setShown(editor);
  const drawn = editor || shown;
  const setup = drawn ? drawn.setup : null;
  const phpStormShown = setup === 'phpstorm';
  const steps = {
    phpstorm: <PhpStormSteps values={phpStorm} onCopy={onCopy} />,
    zed: <ZedSteps config={zed} onCopy={onCopy} />,
    sublime: <SublimeSteps config={sublime} onCopy={onCopy} />
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
            {steps[setup] || <VsCodeSteps config={config} onCopy={onCopy} sitePath={sitePath} editorPath={editorPath} editorName={drawn ? drawn.name : ''} isOpen={Boolean(editor)} />}
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
