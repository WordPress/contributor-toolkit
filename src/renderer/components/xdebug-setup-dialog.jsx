import { useCallback, useEffect, useRef, useState } from 'react';
import { __, sprintf } from '@wordpress/i18n';
import { Button, Dialog, Stack, Tabs, Text, VisuallyHidden } from '@wordpress/ui';
import { XDEBUG_PORT } from '../xdebug.cjs';

// A button that copies a text and says so on itself for a moment, and to a
// screen reader through the region beside it. `onCopy` says why when the
// copy did not work.
function CopyButton({ text, label, onCopy }) {
  const [copied, setCopied] = useState(false);
  const timeout = useRef(null);
  useEffect(() => () => clearTimeout(timeout.current), []);
  const copy = useCallback(async () => {
    if (!(await onCopy(text))) return;
    setCopied(true);
    clearTimeout(timeout.current);
    timeout.current = setTimeout(() => setCopied(false), 1500);
  }, [onCopy, text]);
  return (
    <>
      <Button variant="outline" tone="neutral" size="compact" onClick={() => copy()}>
        {copied ? __('Copied') : label}
      </Button>
      <VisuallyHidden role="status" aria-live="polite">{copied ? __('Copied') : ''}</VisuallyHidden>
    </>
  );
}

// VS Code reads its debug setup from a file in the project, so it gets the
// whole file to paste.
function VsCodePanel({ config, onCopy }) {
  return (
    <Stack direction="column" gap="lg">
      <ol className="xdebug-setup-steps">
        <li><Text variant="body-md">{__('Install the PHP Debug extension by Xdebug.')}</Text></li>
        <li><Text variant="body-md">{__('Open the site’s folder, and put this in .vscode/launch.json:')}</Text></li>
      </ol>
      <pre className="xdebug-launch-config">{config}</pre>
      <Stack direction="row" justify="end">
        <CopyButton text={config} label={__('Copy launch.json')} onCopy={onCopy} />
      </Stack>
      <ol className="xdebug-setup-steps" start={3}>
        <li><Text variant="body-md">{__('In Run and Debug, start “Listen for Xdebug”, set a breakpoint, and load the site.')}</Text></li>
      </ol>
    </Stack>
  );
}

// PhpStorm keeps its debug setup in its own settings, so it gets the values
// to enter there, each by the name of its field.
function PhpStormPanel({ values, onCopy }) {
  return (
    <Stack direction="column" gap="lg">
      <ol className="xdebug-setup-steps">
        <li>
          <Text variant="body-md">
            {sprintf(
              // translators: %d: the port Xdebug connects to.
              __('In Settings → PHP → Debug, make sure Debug port includes %d, and turn off both “Force break at first line” options.'),
              XDEBUG_PORT
            )}
          </Text>
        </li>
        <li><Text variant="body-md">{__('In Settings → PHP → Servers, add a server with Xdebug as its debugger, turn on “Use path mappings”, and enter:')}</Text></li>
      </ol>
      <dl className="xdebug-values">
        {values.map((value) => (
          <div key={value.id} className="xdebug-value">
            <dt><Text variant="body-md" className="muted-label">{value.label}</Text></dt>
            <dd><code>{value.value}</code></dd>
            <dd><CopyButton text={value.value} label={__('Copy')} onCopy={onCopy} /></dd>
          </div>
        ))}
      </dl>
      <ol className="xdebug-setup-steps" start={3}>
        <li><Text variant="body-md">{__('Turn on Run → Start Listening for PHP Debug Connections, set a breakpoint, and load the site.')}</Text></li>
      </ol>
      <Text variant="body-sm" className="muted-label">{__('If the site starts on another port, PhpStorm asks which server it is; update the Port above.')}</Text>
    </Stack>
  );
}

/**
 * How to stop on breakpoints while the site's server has Xdebug (#723), for
 * each editor the app knows: VS Code, with the launch.json it needs, and
 * PhpStorm, with the values its settings need. The app shows and copies
 * them, and never writes them into the checkout, where they would end up in
 * a patch.
 *
 * @param {Object}   props
 * @param {boolean}  props.open
 * @param {string}   props.config   The launch.json, from `xdebugLaunchConfig`.
 * @param {Array}    props.phpStorm The PhpStorm values, from `phpStormSettings`.
 * @param {Function} props.onCopy   Copies a text, resolving to whether it worked; says why when it did not.
 * @param {Function} props.onClose
 */
export function XdebugSetupDialog({ open, config, phpStorm, onCopy, onClose }) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Popup size="medium" className="xdebug-setup-dialog">
        <Dialog.Header>
          <Dialog.Title>{__('Set up your editor')}</Dialog.Title>
          <Dialog.CloseIcon />
        </Dialog.Header>
        <Dialog.Content>
          <Stack direction="column" gap="lg">
            <Tabs.Root defaultValue="vscode" render={<Stack direction="column" gap="lg" />}>
              <Tabs.List variant="minimal">
                <Tabs.Tab value="vscode">{__('VS Code')}</Tabs.Tab>
                <Tabs.Tab value="phpstorm">{__('PhpStorm')}</Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="vscode" tabIndex={-1}>
                <VsCodePanel config={config} onCopy={onCopy} />
              </Tabs.Panel>
              <Tabs.Panel value="phpstorm" tabIndex={-1}>
                <PhpStormPanel values={phpStorm} onCopy={onCopy} />
              </Tabs.Panel>
            </Tabs.Root>
            <Text variant="body-sm" className="muted-label">
              {sprintf(
                // translators: %d: the port Xdebug connects to.
                __('Every site’s server sends Xdebug to port %d, so your editor can follow only one running site at a time.'),
                XDEBUG_PORT
              )}
            </Text>
          </Stack>
        </Dialog.Content>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
