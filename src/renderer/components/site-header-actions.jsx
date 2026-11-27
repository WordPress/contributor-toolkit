import { useEffect, useMemo } from 'react';
import { createSlotFill } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { Icon, cancelCircleFilled, drawerRight, moreVertical, pending, published } from '@wordpress/icons';
import { Button, IconButton, Menu } from '@wordpress/ui';
import { openInItems, siteMenuItems } from '../site-menu.cjs';
import { processTip } from '../site-processes.cjs';

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

// One thing the menu does. An item that is held for a reason says it under
// its name, where it is read with the item: the menu wires it as the item's
// description, and a held item can still be reached with the keyboard.
function MenuAction({ item, onAction }) {
  return (
    <Menu.Item disabled={item.disabled} onClick={() => onAction(item)}>
      <Menu.ItemLabel>{item.label}</Menu.ItemLabel>
      {item.description ? <Menu.ItemDescription>{item.description}</Menu.ItemDescription> : null}
    </Menu.Item>
  );
}

// The contents shared by the header button and the context menu in the sites
// list. Keeping one rendering of the model means both entry points offer the
// same actions, in the same order, and acquire detected applications alike.
function SiteMenuItems({ menu, onAction }) {
  return siteMenuItems(menu).flatMap((item, index) => [
    item.separated ? <Menu.Separator key={`separator-${index}`} /> : null,
    item.items ? (
      <Menu.SubmenuRoot key={item.id}>
        <Menu.SubmenuTrigger>
          <Menu.ItemLabel>{item.label}</Menu.ItemLabel>
        </Menu.SubmenuTrigger>
        <Menu.Popup>
          {/* An application is keyed by where it is, and the two rows that
              are not applications by what they are, so a row keeps its
              identity, and the focus on it, when the list around it changes. */}
          {item.items.map((child) => (
            <MenuAction key={child.path || child.id} item={child} onAction={onAction} />
          ))}
        </Menu.Popup>
      </Menu.SubmenuRoot>
    ) : (
      <MenuAction key={item.id} item={item} onAction={onAction} />
    )
  ]);
}

/**
 * Which application a file under "Changed files" opens in, asked beside the
 * file when no editor is chosen in Settings and detection found one or
 * more (#738). The items are the site menu's "Open in", so the two offer the
 * same applications in the same order, under an "Open in" label of their own
 * since nothing else on screen says what the list is for. Focus goes back to the file when the
 * menu closes, chosen or dismissed.
 *
 * @param {Object}      props
 * @param {HTMLElement} props.anchor   The file's button, which the menu opens beside.
 * @param {Array}       props.editors  Detected applications, `{ name, path }`.
 * @param {Function}    props.onAction Called with the chosen item: `open-in` with a `path`, or `open-in-other`.
 * @param {Function}    props.onClose  Called when the menu closes.
 */
export function OpenFileInMenu({ anchor, editors, onAction, onClose }) {
  return (
    <Menu.Root defaultOpen onOpenChange={(open) => { if (!open) { onClose(); anchor.focus(); } }}>
      <Menu.Trigger
        render={
          <button
            type="button"
            className="site-context-menu-trigger"
            aria-label={__('Open in')}
          />
        }
      />
      <Menu.Popup positioner={<Menu.Positioner anchor={anchor} align="start" />}>
        <Menu.Group>
          <Menu.GroupLabel>{__('Open in')}</Menu.GroupLabel>
          {openInItems({ editors }).map((item) => <MenuAction key={`${item.id}:${item.path || ''}`} item={item} onAction={onAction} />)}
        </Menu.Group>
      </Menu.Popup>
    </Menu.Root>
  );
}

/**
 * The same site actions beside a site in the list. The fixed, invisible
 * trigger gives the menu library the pointer (or keyboard-derived) position
 * to anchor to; the popup itself supplies focus management and dismissal.
 *
 * @param {Object}   props
 * @param {Object}   props.position   The viewport point to open beside.
 * @param {Object}   props.menu       What `siteMenuItems` takes.
 * @param {Function} props.onMenuOpen Called as the menu opens, to look for applications.
 * @param {Function} props.onAction   Called with the chosen item.
 * @param {Function} props.onClose    Called when the menu is dismissed.
 */
export function SiteContextMenu({ position, menu, onMenuOpen, onAction, onClose }) {
  useEffect(() => { onMenuOpen(); }, [onMenuOpen]);
  const anchor = useMemo(() => ({
    getBoundingClientRect: () => ({
      x: position.x,
      y: position.y,
      top: position.y,
      left: position.x,
      right: position.x,
      bottom: position.y,
      width: 0,
      height: 0,
      toJSON: () => ({})
    })
  }), [position]);

  return (
    <Menu.Root defaultOpen onOpenChange={(open) => { if (!open) onClose(); }}>
      <Menu.Trigger
        render={
          <button
            type="button"
            className="site-context-menu-trigger"
            aria-label={__('Site actions')}
          />
        }
      />
      <Menu.Popup positioner={<Menu.Positioner anchor={anchor} />}>
        <SiteMenuItems menu={menu} onAction={onAction} />
      </Menu.Popup>
    </Menu.Root>
  );
}

// A stopped process: the ring the other three are drawn in, empty. The icon
// library has no plain circle, and "not allowed" would put a warning on every
// site that is simply not running.
const STOPPED = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M12 19.25C16.0041 19.25 19.25 16.0041 19.25 12C19.25 7.99594 16.0041 4.75 12 4.75C7.99594 4.75 4.75 7.99594 4.75 12C4.75 16.0041 7.99594 19.25 12 19.25Z" vectorEffect="non-scaling-stroke" />
  </svg>
);

// One shape for each state, so that the state can be told without its colour
// (#776): a tick for running, a ring part filled for busy, a cross for
// failed, and the ring alone for stopped.
const STATUS_ICONS = { online: published, busy: pending, failed: cancelCircleFilled, offline: STOPPED };

/**
 * A process's status: what it is doing, as a shape and a colour. The words
 * beside it say the same, so it is for the eye only.
 *
 * @param {Object} props
 * @param {string} props.status  'online', 'busy', 'failed' or 'offline'.
 * @param {string} [props.title] What it stands for, for a pointer over it; the words beside it say it everywhere else.
 */
export function ProcessStatus({ status, title }) {
  return (
    <span className={`process-status is-${status}`} title={title} aria-hidden="true">
      <Icon icon={STATUS_ICONS[status] || STOPPED} size={16} />
    </span>
  );
}

// One of the site's two processes, in the header (#557): a button that says
// what pressing it does, with the status icon beside the words saying what the
// process is doing, and both in words for a pointer over it. One press
// starts or stops it (#741); where the running site can be gone to is in the
// details. What it says is decided in site-processes.cjs.
function ProcessToggle({ process, onToggle }) {
  return (
    <Button className="process-toggle" variant="minimal" tone="neutral" size="compact" title={processTip(process)} disabled={process.disabled} onClick={onToggle} aria-label={process.toggle}>
      {/* The icon and the words are one line, so that the icon can sit on
          the words' x-height (shell.css). The words give way to the icon
          when the header is short of room, and the tooltip still says both
          what the process is doing and what a press does. */}
      <span className="process-toggle-state">
        <ProcessStatus status={process.status} />
        <span className="header-wide-only" aria-hidden="true">{process.toggle}</span>
      </span>
    </Button>
  );
}

/**
 * The open site's actions: its two processes and the way to its changes, once
 * its setup is done; the button that shows and hides its details; and its
 * menu. Rendered by the site's view, and only by the one that is open.
 *
 * The next-action cue (#252) can point at the server's button or at the review
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
 * @param {Object}   [props.work]          The processes and the review, or null while the site's setup is not done: `{ server, watch, onToggleServer, onToggleWatch, onReview, reviewDisabled, serverCue, reviewCue }`.
 */
export function SiteHeaderActions({ detailsOpen, detailsId, onToggleDetails, menu, onMenuOpen, onAction, work = null }) {
  return (
    <Fill>
      {work ? (
        <>
          <span {...work.serverCue}>
            <ProcessToggle process={work.server} onToggle={work.onToggleServer} />
          </span>
          <ProcessToggle process={work.watch} onToggle={work.onToggleWatch} />
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
          <SiteMenuItems menu={menu} onAction={onAction} />
        </Menu.Popup>
      </Menu.Root>
    </Fill>
  );
}
