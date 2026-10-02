import { __, sprintf } from '@wordpress/i18n';
import { Button, Stack, Text, VisuallyHidden } from '@wordpress/ui';
import { siteDetailsRows } from '../site-details.cjs';

/**
 * The details of the open site (#556), beside the cards. What they say is
 * decided in site-details.cjs; this draws it. They can be put away; hidden,
 * they are out of the tab order and the accessibility tree as well as out of
 * sight.
 *
 * @param {Object}   props
 * @param {string}   props.id         The element's id, which the button that shows and hides it names.
 * @param {boolean}  props.open
 * @param {string}   props.siteName   For the region's name.
 * @param {Object}   props.facts      What `siteDetailsRows` takes.
 * @param {boolean}  props.pathCopied The path has just been copied with the button here.
 * @param {Function} props.onCopyPath
 */
export function SiteDetails({ id, open, siteName, facts, pathCopied, onCopyPath }) {
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
            {siteDetailsRows(facts).map((row) => {
              const fact = (
                <Stack key={row.id} direction="column" className={row.copyable ? 'path-meta' : undefined}>
                  <Text variant="body-md" className="muted-label">{row.label}</Text>
                  <Text variant="body-md" className={row.copyable ? 'path-value' : undefined}>{row.value}</Text>
                  {row.note ? <Text variant="body-sm" className="site-details-note">{row.note}</Text> : null}
                </Stack>
              );
              if (!row.copyable) return fact;
              // The button says the copy worked on itself, for the eye. For
              // a screen reader it is said by the region beside it, which
              // holds the word only while it is true: the button's name
              // changing back a moment later is not news, and a live button
              // would announce that too.
              return (
                <Stack key={row.id} direction="row" align="end" justify="space-between" gap="sm">
                  {fact}
                  <Button variant="minimal" tone="neutral" size="compact" onClick={() => onCopyPath()}>
                    {pathCopied ? __('Copied') : __('Copy')}
                  </Button>
                  <VisuallyHidden role="status" aria-live="polite">{pathCopied ? __('Copied') : ''}</VisuallyHidden>
                </Stack>
              );
            })}
          </Stack>
        </Stack>
      </aside>
    </div>
  );
}
