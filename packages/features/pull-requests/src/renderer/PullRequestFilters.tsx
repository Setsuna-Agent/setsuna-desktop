import { Button, Dialog, Dropdown, IconButton, TextField, type MenuItem } from '@setsuna-desktop/renderer-ui';
import { CircleCheck, FolderGit2, ListFilter, Search, UserRound } from 'lucide-react';
import { useId, useState } from 'react';
import type { PullRequestFilters as Filters, PullRequestRepository } from '../contracts/index.js';
import { usePrText } from './context.js';

type FilterSelection = { repository: string; filters: Filters };
type Props = {
  value: FilterSelection;
  repositories: PullRequestRepository[];
  authors: string[];
  onChange(value: FilterSelection): void;
};

export function PullRequestFilters({ value, repositories, authors, onChange }: Props) {
  const t = usePrText();
  const { repository, filters } = value;
  const [authorDraft, setAuthorDraft] = useState<string | null>(null);
  const formId = useId();
  const active = Boolean(repository || filters.author || filters.state !== 'all');
  const changeFilters = (patch: Partial<Filters>) => onChange({ repository, filters: { ...filters, ...patch } });
  // Keep an explicitly chosen author available when a filtered result is empty.
  const availableAuthors = [...new Set([...authors, filters.author].filter(Boolean))].sort();
  const items: MenuItem[] = [
    {
      key: 'status', label: t('status'), icon: <CircleCheck size={14} />,
      children: (['all', 'open', 'draft', 'merged', 'closed'] as const).map((state) => ({
        key: `state:${state}`, label: t(state), onClick: () => changeFilters({ state }),
      })),
    },
    {
      key: 'repository', label: t('repository'), icon: <FolderGit2 size={14} />,
      children: [
        { key: 'repository:', label: t('allRepositories'), onClick: () => onChange({ ...value, repository: '' }) },
        ...repositories.map((repo) => ({
          key: `repository:${repo.id}`, label: <span className="pr-filter-option" title={repo.fullName}>{repo.fullName}</span>,
          onClick: () => onChange({ ...value, repository: repo.id }),
        })),
      ],
    },
    {
      key: 'author', label: t('author'), icon: <UserRound size={14} />,
      children: [
        { key: 'author:', label: t('allAuthors'), onClick: () => changeFilters({ author: '' }) },
        ...availableAuthors.map((author) => ({
          key: `author:${author}`, label: author, onClick: () => changeFilters({ author }),
        })),
        { type: 'divider' },
        { key: 'custom-author', label: t('customAuthor'), onClick: () => setAuthorDraft(filters.author) },
      ],
    },
    { type: 'divider' },
    {
      key: 'clear', label: t('clearFilters'), disabled: !active,
      onClick: () => onChange({ repository: '', filters: { ...filters, state: 'all', author: '' } }),
    },
  ];
  return <>
    <div className="pr-filters">
      <TextField
        aria-label={t('search')} placeholder={t('searchPlaceholder')} leadingIcon={<Search size={14} />}
        maxLength={200} value={filters.search} onChange={(event) => changeFilters({ search: event.currentTarget.value })}
      />
      <Dropdown placement="bottomRight" menu={{ items, selectedKeys: [`state:${filters.state}`, `repository:${repository}`, `author:${filters.author}`] }}>
        <IconButton
          size="small" label={t('filters')} title={active ? t('filtersActive') : t('filters')}
          className={`pr-filters__trigger${active ? ' is-active' : ''}`}
        ><ListFilter size={16} /></IconButton>
      </Dropdown>
    </div>
    {authorDraft !== null ? <Dialog
      title={t('customAuthor')} width={360} onClose={() => setAuthorDraft(null)}
      footer={<><Button onClick={() => setAuthorDraft(null)}>{t('cancel')}</Button><Button variant="primary" type="submit" form={formId}>{t('applyFilter')}</Button></>}
    >
      <form id={formId} className="pr-author-filter" onSubmit={(event) => {
        event.preventDefault();
        changeFilters({ author: authorDraft.trim().replace(/^@/u, '') });
        setAuthorDraft(null);
      }}>
        <TextField autoFocus aria-label={t('author')} placeholder={t('authorPlaceholder')} maxLength={100} value={authorDraft} onChange={(event) => setAuthorDraft(event.currentTarget.value)} />
      </form>
    </Dialog> : null}
  </>;
}
