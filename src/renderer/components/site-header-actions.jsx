import { createSlotFill } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { Icon, chevronDown, drawerRight, moreVertical } from '@wordpress/icons';
import { Button, IconButton, Menu } from '@wordpress/ui';
import { siteMenuItems } from '../site-menu.cjs';

// The page's header belongs to the window, and what goes in it belongs to the
// site that is open (#556). The window leaves a slot in the header, and the
// open site's view fills it, so the buttons are drawn where the design puts
// them and still call that site's own functions.
const { Fill, Slot } = createSlotFill('SiteHeaderActions');

/**
 * Where the open site's actions are drawn. The window puts this in the page's
 * header.
 */
export function SiteHeaderActionsSlot() {
  return <Slot bubblesVirtually className="site-header-actions" />;
}

// One thing the menu does.
function MenuAction({ item, onAction }) {
  return (
    <Menu.Item disabled={item.disabled} onClick={() => onAction(item)}>
      <Menu.ItemLabel>{item.label}</Menu.ItemLabel>
    </Menu.Item>
  );
}

/**
 * A process's dot: what it is doing, as a colour. The words beside it say the
 * same, so the dot is for the eye only.
 *
 * @param {Object} props
 * @param {string} props.status 'online', 'busy', 'failed' or 'offline'.
 */
export function ProcessStatus({ status }) {
  return <span className={`process-status is-${status}`} aria-hidden="true" />;
}

// One of the site's two processes, in the header (#557): what it is doing, and
// under it what can be done about that. For the server that is also where
// the running site can be gone to, since the details, which say the same and
// more, can be put away. What it says is decided in site-processes.cjs.
function ProcessMenu({ process, onToggle, links = [], onOpenLink = null }) {
  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button className="process-menu-trigger" variant="minimal" tone="neutral" size="compact" title={process.label}>
            <ProcessStatus status={process.status} />
            {/* The words give way to the dot when the header is short of
                room (shell.css); they are still the button's name. */}
            <span className="header-wide-only">{process.label}</span>
            <Icon icon={chevronDown} size={16} />
          </Button>
        }
      />
      <Menu.Popup>
        {links.map((link) => (
          <Menu.Item key={link.id} onClick={() => onOpenLink(link.href)}>
            <Menu.ItemLabel>{link.label}</Menu.ItemLabel>
          </Menu.Item>
        ))}
        {links.length ? <Menu.Separator /> : null}
        <Menu.Item disabled={process.disabled} onClick={onToggle}>
          <Menu.ItemLabel>{process.action}</Menu.ItemLabel>
        </Menu.Item>
      </Menu.Popup>
    </Menu.Root>
  );
}

/**
 * The open site's actions: its two processes and the way to its changes, once
 * its setup is done; the button that shows and hides its details; and its
 * menu. Rendered by the site's view, and only by the one that is open.
 *
 * The next-action cue (#252) can point at the server's menu or at the review
 * button. Each takes the props the site's view makes for the step it is, which
 * put the glow on it when it is the next one.
 *
 * @param {Object}   props
 * @param {boolean}  props.detailsOpen     Whether the details are showing.
 * @param {string}   props.detailsId       The id of the element the details are in.
 * @param {Function} props.onToggleDetails
 * @param {Object}   props.menu            What `siteMenuItems` takes.
 * @param {Function} props.onMenuOpen      Called as the menu opens, to look for applications.
 * @param {Function} props.onAction        Called with the chosen item.
 * @param {Object}   [props.work]          The processes and the review, or null while the site's setup is not done: `{ server, watch, onToggleServer, onToggleWatch, serverLinks, onOpenLink, onReview, reviewDisabled, serverCue, reviewCue }`.
 */
export function SiteHeaderActions({ detailsOpen, detailsId, onToggleDetails, menu, onMenuOpen, onAction, work = null }) {
  const items = siteMenuItems(menu);
  return (
    <Fill>
      {work ? (
        <>
          <span {...work.serverCue}>
            <ProcessMenu process={work.server} onToggle={work.onToggleServer} links={work.serverLinks} onOpenLink={work.onOpenLink} />
          </span>
          <ProcessMenu process={work.watch} onToggle={work.onToggleWatch} />
          <span {...work.reviewCue}>
            {/* One name, of which the header shows the first word when it is
                short of room. */}
            <Button variant="solid" tone="brand" size="compact" disabled={work.reviewDisabled} onClick={work.onReview} aria-label={__('Review & submit changes')}>
              <span className="header-narrow-only" aria-hidden="true">{__('Review')}</span>
              <span className="header-wide-only" aria-hidden="true">{__('Review & submit changes')}</span>
            </Button>
          </span>
        </>
      ) : null}
      {/* It says what pressing it does, and that is the one place its state
          is said, as with the button that hides the sites list. */}
      <IconButton
        className="site-details-toggle"
        icon={drawerRight}
        label={detailsOpen ? __('Hide details') : __('Show details')}
        variant="minimal"
        tone="neutral"
        size="compact"
        aria-expanded={detailsOpen}
        aria-controls={detailsId}
        onClick={onToggleDetails}
      />
      <Menu.Root onOpenChange={(open) => { if (open) onMenuOpen(); }}>
        <Menu.Trigger
          render={
            <IconButton
              className="site-menu-trigger"
              icon={moreVertical}
              label={__('Site actions')}
              variant="minimal"
              tone="neutral"
              size="compact"
            />
          }
        />
        <Menu.Popup>
          {items.flatMap((item, index) => [
            item.separated ? <Menu.Separator key={`separator-${index}`} /> : null,
            item.items ? (
              <Menu.SubmenuRoot key={item.id}>
                <Menu.SubmenuTrigger>
                  <Menu.ItemLabel>{item.label}</Menu.ItemLabel>
                </Menu.SubmenuTrigger>
                <Menu.Popup>
                  {/* An application is keyed by where it is, and the two rows
                      that are not applications by what they are, so a row
                      keeps its identity, and the focus on it, when the list
                      around it changes. */}
                  {item.items.map((child) => (
                    <MenuAction key={child.path || child.id} item={child} onAction={onAction} />
                  ))}
                </Menu.Popup>
              </Menu.SubmenuRoot>
            ) : (
              <MenuAction key={item.id} item={item} onAction={onAction} />
            )
          ])}
        </Menu.Popup>
      </Menu.Root>
    </Fill>
  );
}
