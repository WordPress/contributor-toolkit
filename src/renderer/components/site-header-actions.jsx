import { createSlotFill } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { drawerRight, moreVertical } from '@wordpress/icons';
import { IconButton, Menu } from '@wordpress/ui';
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

// One thing the menu does. Its place in the list is its key, which holds as
// long as site-menu.cjs keeps the list's order fixed, as it does.
function MenuAction({ item, onAction }) {
  return (
    <Menu.Item disabled={item.disabled} onClick={() => onAction(item)}>
      <Menu.ItemLabel>{item.label}</Menu.ItemLabel>
    </Menu.Item>
  );
}

/**
 * The open site's actions: the button that shows and hides its details, and
 * its menu. Rendered by the site's view, and only by the one that is open.
 *
 * @param {Object}   props
 * @param {boolean}  props.detailsOpen     Whether the details are showing.
 * @param {string}   props.detailsId       The id of the element the details are in.
 * @param {Function} props.onToggleDetails
 * @param {Object}   props.menu            What `siteMenuItems` takes.
 * @param {Function} props.onMenuOpen      Called as the menu opens, to look for applications.
 * @param {Function} props.onAction        Called with the chosen item.
 */
export function SiteHeaderActions({ detailsOpen, detailsId, onToggleDetails, menu, onMenuOpen, onAction }) {
  const items = siteMenuItems(menu);
  return (
    <Fill>
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
                  {item.items.map((child, childIndex) => (
                    <MenuAction key={`${child.id}-${child.path || childIndex}`} item={child} onAction={onAction} />
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
