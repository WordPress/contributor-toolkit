import { __, _n, sprintf } from '@wordpress/i18n';
import { Button, Stack, Text } from '@wordpress/ui';

// One fact about the site: what it is, over what it says.
function Detail({ label, children }) {
  return (
    <Stack direction="column">
      <Text variant="body-md" className="muted-label">{label}</Text>
      {children}
    </Stack>
  );
}

/**
 * The details of the open site (#556): the facts about the checkout that do
 * not change while a contributor works, beside the cards that do. It can be
 * put away; hidden, it is out of the tab order and the accessibility tree as
 * well as out of sight.
 *
 * @param {Object}   props
 * @param {string}   props.id          The element's id, which the button that shows and hides it names.
 * @param {boolean}  props.open
 * @param {string}   props.siteName    For the region's name.
 * @param {boolean}  props.initialized Whether the first-run setup has finished.
 * @param {string}   props.created     When the site was made, as text, or ''.
 * @param {Object}   props.trunk       From `trunkAgeInfo`.
 * @param {string}   props.path        Where the checkout is.
 * @param {boolean}  props.pathCopied  The path has just been copied.
 * @param {Function} props.onCopyPath
 * @param {string}   props.checkout    The project's name.
 */
export function SiteDetails({ id, open, siteName, initialized, created, trunk, path, pathCopied, onCopyPath, checkout }) {
  return (
    <div id={id} className="dashboard-sidebar-slot" inert={open ? undefined : ''}>
      <aside
        className="dashboard-sidebar"
        aria-hidden={!open}
        // translators: %s: the name of a site.
        aria-label={sprintf(__('Details of %s'), siteName)}
      >
        <Stack direction="column" gap="md">
          <Text variant="heading-lg" render={<h2 />}>{__('Details')}</Text>
          <Stack direction="column" gap="md">
            <Detail label={__('Setup')}>
              <Text variant="body-md">{initialized ? __('Initialized') : __('Uninitialized')}</Text>
            </Detail>
            {created ? (
              <Detail label={__('Created')}>
                <Text variant="body-md">{created}</Text>
              </Detail>
            ) : null}
            {trunk.known ? (
              <Detail label={__('Trunk as of')}>
                <Text variant="body-md">{trunk.dateLabel}</Text>
                {trunk.stale ? (
                  <Text variant="body-sm" className="site-details-stale">
                    {
                      // translators: %d: how many days old the site's copy of the WordPress code is.
                      sprintf(_n('%d day old', '%d days old', trunk.ageDays), trunk.ageDays)
                    }
                  </Text>
                ) : null}
              </Detail>
            ) : null}
            <Stack direction="row" align="end" justify="space-between" gap="sm">
              <Stack direction="column" className="path-meta">
                <Text variant="body-md" className="muted-label">{__('Local path')}</Text>
                <Text variant="body-md" className="path-value">{path}</Text>
              </Stack>
              <Button variant="minimal" tone="neutral" size="compact" aria-live="polite" onClick={onCopyPath}>
                {pathCopied ? __('Copied') : __('Copy')}
              </Button>
            </Stack>
            <Detail label={__('Checkout')}>
              <Text variant="body-md">{checkout}</Text>
            </Detail>
          </Stack>
        </Stack>
      </aside>
    </div>
  );
}
