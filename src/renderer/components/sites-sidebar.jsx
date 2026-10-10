import { useMemo } from 'react';
import { Page } from '@wordpress/admin-ui';
import { DataViews } from '@wordpress/dataviews';
import { __, sprintf } from '@wordpress/i18n';
import { Icon, wordpress } from '@wordpress/icons';
import { Button, VisuallyHidden } from '@wordpress/ui';
import { ProcessStatus } from './site-header-actions.jsx';

// The list's two fields: the name, which is the row's title and so its
// accessible name, and the line under it. Every site wears its server's dot
// before its name, the one the page header draws for the open site, so that
// which site is running can be seen without opening each: grey until the
// view has said otherwise. A site with something to report (#94) wears a
// second dot after it. Both say what they mean in words after the name, so
// that the name is what a screen reader says first, and the server's only
// when it is not the grey every site starts with. A site on its way out says
// so the same way, since pressing its entry opens nothing. Built on first
// render and not as the module loads, which is before the locale has.
const buildFields = () => [
  {
    id: 'name',
    type: 'text',
    label: __('Name'),
    enableHiding: false,
    render: ({ item }) => (
      <span className="sites-sidebar-name">
        <ProcessStatus status={item.server.status} title={item.server.text || undefined} />
        {item.attention ? <span className={`sites-sidebar-dot is-${item.attention.kind}`} title={item.attention.text} aria-hidden="true" /> : null}
        <span className="sites-sidebar-name-text">{item.name}</span>
        {item.server.text ? (
          <VisuallyHidden render={<span />}>
            {
              // translators: %s: what a site's server is doing, such as "Server running". It follows the site's name.
              sprintf(__('(%s)'), item.server.text)
            }
          </VisuallyHidden>
        ) : null}
        {item.attention ? (
          <VisuallyHidden render={<span />}>
            {
              // translators: %s: what a site has to report, such as that its update is incomplete. It follows the site's name.
              sprintf(__('(%s)'), item.attention.text)
            }
          </VisuallyHidden>
        ) : null}
        {item.deleting ? <VisuallyHidden render={<span />}>{__('(Deleting)')}</VisuallyHidden> : null}
      </span>
    )
  },
  {
    id: 'description',
    type: 'text',
    label: __('Project'),
    render: ({ item }) => <span className="sites-sidebar-description">{item.description}</span>
  }
];

// A plain list: every site, the name over the project, and nothing to
// configure. No control that could change the view is drawn, so the view is a
// constant, and the list is given every row: there is no second page for a
// site to be left on.
const VIEW = {
  type: 'list',
  titleField: 'name',
  descriptionField: 'description',
  showMedia: false,
  fields: [],
  layout: { density: 'balanced' }
};
const LAYOUTS = { list: { layout: { density: 'balanced' } } };
const keepView = () => {};
const getItemId = (item) => item.id;

/**
 * The sites list (#555): every site the app knows, the one that is open
 * marked, and the way to make another.
 *
 * @param {Object}   props
 * @param {Array}    props.rows              From `sitesListRows`.
 * @param {string}   props.selectedId        The open site's row id.
 * @param {Function} props.onChangeSelection Called with the ids the list reports.
 * @param {Function} props.onCreateSite
 * @param {boolean}  props.creating          A site is being created, so another cannot be started.
 */
export function SitesSidebar({ rows, selectedId, onChangeSelection, onCreateSite, creating = false }) {
  const fields = useMemo(buildFields, []);
  const paginationInfo = useMemo(() => ({ totalItems: rows.length, totalPages: 1 }), [rows.length]);
  const selection = useMemo(() => (selectedId ? [selectedId] : []), [selectedId]);

  return (
    <Page
      className="sites-sidebar"
      visual={<Icon icon={wordpress} size={24} />}
      title={__('My sites')}
      actions={
        <Button
          variant="outline"
          tone="brand"
          size="compact"
          onClick={onCreateSite}
          disabled={creating}
          title={creating ? __('Finish creating the current site first') : undefined}
        >
          {__('Create new site')}
        </Button>
      }
      showSidebarToggle={false}
      hasPadding={false}
      ariaLabel={__('My sites')}
    >
      <div className="sites-sidebar-list">
        <DataViews
          data={rows}
          fields={fields}
          view={VIEW}
          onChangeView={keepView}
          paginationInfo={paginationInfo}
          defaultLayouts={LAYOUTS}
          getItemId={getItemId}
          selection={selection}
          onChangeSelection={onChangeSelection}
        >
          <DataViews.Layout />
        </DataViews>
      </div>
    </Page>
  );
}
