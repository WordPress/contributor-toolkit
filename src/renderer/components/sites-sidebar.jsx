import { useMemo, useState } from 'react';
import { Page } from '@wordpress/admin-ui';
import { DataViews, filterSortAndPaginate } from '@wordpress/dataviews';
import { __ } from '@wordpress/i18n';
import { Icon, wordpress } from '@wordpress/icons';
import { Button, VisuallyHidden } from '@wordpress/ui';

// The list's two fields: the name, which is the row's title and so its
// accessible name, and the line under it. A site with something to report
// (#94) wears a dot before its name, and says what the dot means in words a
// screen reader gets as part of the name. Built on first render and not as
// the module loads, which is before the locale has.
const buildFields = () => [
  {
    id: 'name',
    type: 'text',
    label: __('Name'),
    enableHiding: false,
    render: ({ item }) => (
      <span className="sites-sidebar-name">
        {item.attention ? (
          <>
            <span className={`sites-sidebar-dot is-${item.attention.kind}`} title={item.attention.text} aria-hidden="true" />
            <VisuallyHidden render={<span />}>{`${item.attention.text}. `}</VisuallyHidden>
          </>
        ) : null}
        {/* A site on its way out says so as part of its name too: pressing
            its entry opens nothing. In front of the name, like the dot's
            text, so the name reads as a sentence and then the site. */}
        {item.deleting ? <VisuallyHidden render={<span />}>Deleting. </VisuallyHidden> : null}
        <span className="sites-sidebar-name-text">{item.name}</span>
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

// A plain list: every site on one page, the name over the project, and
// nothing to configure.
const VIEW = {
  type: 'list',
  search: '',
  page: 1,
  perPage: 100,
  titleField: 'name',
  descriptionField: 'description',
  showMedia: false,
  fields: [],
  layout: { density: 'balanced' }
};
const LAYOUTS = { list: { layout: { density: 'balanced' } } };
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
  const [view, setView] = useState(VIEW);
  const fields = useMemo(buildFields, []);
  const { data, paginationInfo } = useMemo(() => filterSortAndPaginate(rows, view, fields), [rows, view, fields]);
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
          data={data}
          fields={fields}
          view={view}
          onChangeView={setView}
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
