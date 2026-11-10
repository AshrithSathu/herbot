// A topic's workspace: every file it was sent or made, as one aligned list.
// Hundreds of files, deep folders, unicode and 200-character names, files
// claiming to be 100 GB: the list stays scannable, and a filter finds one.
import { useDeferredValue, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FolderOpenIcon, SearchIcon, XIcon } from 'lucide-react'
import { getFiles, type Attachment } from '../api'
import { EmptyState, ErrorNote, StaleWarning } from '../ui'
import { FilePreview, formatBytes } from './rich-message'
import { Button } from './ui/button'
import { Skeleton } from './ui/skeleton'

/** "chat_-100…/topic_7/files/out/report.pdf" → "out" (the folder under files/). */
function folderOf(path: string): string {
  const parts = path.split('/')
  const files = parts.indexOf('files')
  const inside = files >= 0 ? parts.slice(files + 1, -1) : parts.slice(0, -1)
  return inside.join('/')
}

function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()
}

type Sort = 'name' | 'size' | 'folder'

export function TopicFiles({ id }: { id: number }) {
  const query = useQuery({
    queryKey: ['files', id],
    queryFn: () => getFiles({ data: id }),
    refetchInterval: 10_000,
  })
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<Sort>('folder')
  const wanted = fold(useDeferredValue(filter).trim())

  const files = useMemo(() => {
    const all = (query.data ?? []).map((f) => ({ file: f, folder: folderOf(f.path) }))
    const shown = wanted ? all.filter((f) => fold(`${f.folder}/${f.file.name}`).includes(wanted)) : all
    const byName = (a: { file: Attachment }, b: { file: Attachment }) =>
      a.file.name.localeCompare(b.file.name, undefined, { numeric: true, sensitivity: 'base' })
    return shown.sort((a, b) =>
      sort === 'size'
        ? b.file.size - a.file.size
        : sort === 'folder'
          ? a.folder.localeCompare(b.folder) || byName(a, b)
          : byName(a, b),
    )
  }, [query.data, wanted, sort])

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading files">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
    )
  }
  if (query.isError && !query.data) {
    return (
      <ErrorNote title="Couldn’t load files">
        {query.error.message}{' '}
        <Button variant="link" className="h-auto p-0" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </ErrorNote>
    )
  }
  const total = query.data!.length
  if (total === 0) {
    return (
      <EmptyState icon={FolderOpenIcon} title="No files yet">
        Files you send this agent and files it makes show up here.
      </EmptyState>
    )
  }
  const bytes = query.data!.reduce((n, f) => n + (Number.isFinite(f.size) ? f.size : 0), 0)

  return (
    <section aria-label="Files" className="flex flex-col gap-3">
      <StaleWarning error={query.error} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <label htmlFor={`files-filter-${id}`} className="sr-only">
            Filter files
          </label>
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            id={`files-filter-${id}`}
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setFilter('')}
            placeholder={`Filter ${total.toLocaleString('en-GB')} files`}
            autoComplete="off"
            spellCheck={false}
            className="h-10 w-full rounded-lg border border-input bg-background pr-10 pl-9 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 pointer-coarse:h-11 sm:text-sm [&::-webkit-search-cancel-button]:hidden"
          />
          {filter && (
            <button
              type="button"
              onClick={() => setFilter('')}
              aria-label="Clear filter"
              className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-4" aria-hidden />
            </button>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Sort by
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="h-10 rounded-lg border border-input bg-background px-2.5 text-base text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 pointer-coarse:h-11 sm:text-sm"
          >
            <option value="folder">Folder</option>
            <option value="name">Name</option>
            <option value="size">Size</option>
          </select>
        </label>
      </div>
      <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
        {wanted
          ? `${files.length.toLocaleString('en-GB')} of ${total.toLocaleString('en-GB')} files match`
          : `${total.toLocaleString('en-GB')} ${total === 1 ? 'file' : 'files'} · ${formatBytes(bytes)}`}
      </p>
      {files.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No file matches “{filter.trim()}”.{' '}
          <Button variant="link" className="h-auto p-0" onClick={() => setFilter('')}>
            Clear the filter
          </Button>
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {files.map(({ file, folder }) => (
            // Off-screen rows skip layout and paint, so hundreds stay cheap.
            <li key={file.path} className="[contain-intrinsic-size:auto_3.5rem] [content-visibility:auto]">
              <FilePreview
                file={file}
                detail={
                  folder ? (
                    <>
                      {' · '}
                      <span dir="auto" className="user-text font-mono">
                        {folder}/
                      </span>
                    </>
                  ) : null
                }
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
