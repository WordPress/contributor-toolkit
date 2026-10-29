import { useCallback, useEffect, useRef, useState } from 'react';
import { __, sprintf } from '@wordpress/i18n';
import { Button, Dialog, Stack, Text, VisuallyHidden } from '@wordpress/ui';
import { XDEBUG_PORT } from '../xdebug.cjs';

/**
 * How to stop on breakpoints in VS Code while the site's server has Xdebug
 * (#723): the steps, and the launch.json they need, which the app shows and
 * copies but never writes into the checkout, where it would end up in a
 * patch.
 *
 * @param {Object}   props
 * @param {boolean}  props.open
 * @param {string}   props.config  The launch.json, from `xdebugLaunchConfig`.
 * @param {Function} props.onCopy  Copies a text, resolving to whether it worked; says why when it did not.
 * @param {Function} props.onClose
 */
export function XdebugSetupDialog({ open, config, onCopy, onClose }) {
  const [copied, setCopied] = useState(false);
  const timeout = useRef(null);
  useEffect(() => () => clearTimeout(timeout.current), []);
  const copy = useCallback(async () => {
    if (!(await onCopy(config))) return;
    setCopied(true);
    clearTimeout(timeout.current);
    timeout.current = setTimeout(() => setCopied(false), 1500);
  }, [onCopy, config]);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Popup size="medium" className="xdebug-setup-dialog">
        <Dialog.Header>
          <Dialog.Title>{__('Debug in VS Code')}</Dialog.Title>
          <Dialog.CloseIcon />
        </Dialog.Header>
        <Dialog.Content>
          <Stack direction="column" gap="lg">
            <ol className="xdebug-setup-steps">
              <li><Text variant="body-md">{__('Install the PHP Debug extension by Xdebug.')}</Text></li>
              <li><Text variant="body-md">{__('Open the site’s folder, and put this in .vscode/launch.json:')}</Text></li>
            </ol>
            <pre className="xdebug-launch-config">{config}</pre>
            <Stack direction="row" justify="end">
              <Button variant="outline" tone="neutral" size="compact" onClick={() => copy()}>
                {copied ? __('Copied') : __('Copy launch.json')}
              </Button>
              <VisuallyHidden role="status" aria-live="polite">{copied ? __('Copied') : ''}</VisuallyHidden>
            </Stack>
            <ol className="xdebug-setup-steps" start={3}>
              <li><Text variant="body-md">{__('In Run and Debug, start “Listen for Xdebug”, set a breakpoint, and load the site.')}</Text></li>
            </ol>
            <Text variant="body-sm" className="muted-label">
              {sprintf(
                // translators: %d: the port Xdebug connects to.
                __('Every site’s server sends Xdebug to port %d, so VS Code can follow only one running site at a time.'),
                XDEBUG_PORT
              )}
            </Text>
          </Stack>
        </Dialog.Content>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
