// Variant 2 "Browser": interaction axis. Files take the main pane as a
// browser: folder chips, sort, an aligned ledger of every file, and a
// preview beside it (images, video, audio, the start of text files). On
// narrow screens the preview opens over the list with "‹ Files".
import { useEffect, useMemo, useState } from 'react'
import { ChevronLeftIcon, DownloadIcon } from 'lucide-react'
import { Button } from '@/components/hb/controls'
import { InPlaceEmpty, InPlaceError, ListSkeleton } from '@/components/hb/feedback'
import { LedgerTable, type Column } from '@/components/hb/rows'
import { fileUrl, formatBytes } from '@/components/rich-message'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'
import { Frame, useTopicParam } from '../topic/shared'
import { byName, FilterBox, KIND_ICON, KIND_LABEL, summary, useFiles, useFilter, type Entry } from './shared'
import { TopicViews } from './views'

type Sort = 'name' | 'size'

export function BrowserVariant() {
  const [id, select] = useTopicParam()
  return (
    <Frame topicId={id} onSelect={select}>
      <TopicViews topicId={id} files={(header) => <Browser id={id} header={header} />} />
    </Frame>
  )
}

function Browser({ id, header }: { id: number; header: React.ReactNode }) {
  const { query, entries, bytes } = useFiles(id)
  const [folder, setFolder] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort>('name')
  const [open, setOpen] = useState<string | null>(null)
  const folders = useMemo(() => {
    const counts = new Map<string, number>()
    entries.forEach((e) => counts.set(e.folder, (counts.get(e.folder) ?? 0) + 1))
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [entries])
  const inFolder = useMemo(() => {
    const list = folder === null ? entries.slice() : entries.filter((e) => e.folder === folder)
    return list.sort(sort === 'size' ? (a, b) => b.file.size - a.file.size || byName(a, b) : byName)
  }, [entries, folder, sort])
  const { q, setQ, shown, filtering } = useFilter(inFolder)
  const selected = entries.find((e) => e.key === open) ?? null
  useEffect(() => setOpen(null), [id])

  const columns: Column<Entry>[] = [
    {
      id: 'name',
      header: 'Name',
      width: 'minmax(12rem,1fr)',
      phone: 'title',
      cell: (e) => {
        const Icon = KIND_ICON[e.kind]
        return (
          <button type="button" onClick={() => setOpen(e.key)} aria-pressed={open === e.key} className="flex w-full min-w-0 items-center gap-2.5 text-left outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:shadow-[inset_0_0_0_2px_var(--ring)]">
            <Icon aria-hidden className="size-4 shrink-0 text-faint" />
            <UserText className="text-[14px] font-medium" fallback="Unnamed file">{e.file.name}</UserText>
          </button>
        )
      },
    },
    { id: 'folder', header: 'Folder', width: 'minmax(6rem,0.5fr)', phone: 'below', cell: (e) => <UserText className="text-[13px] text-mute" fallback="files/">{e.folder ? `files/${e.folder}/` : 'files/'}</UserText> },
    { id: 'kind', header: 'Kind', width: '7rem', phone: 'hide', cell: (e) => <span className="text-[13px] text-mute">{KIND_LABEL[e.kind].replace(/s$/, '')}</span> },
    { id: 'size', header: 'Size', width: '5.5rem', numeric: true, phone: 'aside', cell: (e) => <span className="text-[13px] text-mute" title={`${e.file.size.toLocaleString('en-GB')} bytes`}>{formatBytes(e.file.size)}</span> },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <div className="relative flex min-h-0 flex-1">
        <div data-hb-scroll className={cn('scroller min-h-0 flex-1 overflow-y-auto overscroll-contain', selected && 'max-wide:hidden')}>
          <div className="flex flex-col gap-3 px-3 py-4 md:px-5">
            {query.isPending ? (
              <ListSkeleton rows={8} lines={1} />
            ) : query.error && !query.data ? (
              <InPlaceError title="Couldn’t load the files" error={query.error} onRetry={() => query.refetch()} />
            ) : entries.length === 0 ? (
              <InPlaceEmpty title="No files yet">Files you send this agent and files it makes show up here.</InPlaceEmpty>
            ) : (
              <>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <FilterBox id={`browse-${id}`} q={q} setQ={setQ} total={inFolder.length} className="flex-1" />
                  <label className="flex shrink-0 items-center gap-2 text-[13px] text-mute">
                    Sort
                    <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-10 rounded-lg bg-sunken px-2.5 text-base text-ink outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--mute)] md:text-[14px] pointer-coarse:h-11">
                      <option value="name">Name</option>
                      <option value="size">Largest first</option>
                    </select>
                  </label>
                </div>
                {folders.length > 1 && (
                  <div role="group" aria-label="Folders" className="flex flex-wrap gap-1.5">
                    <Chip active={folder === null} onClick={() => setFolder(null)}>
                      All <span className="tabular-nums text-faint">{entries.length}</span>
                    </Chip>
                    {folders.map(([f, n]) => (
                      <Chip key={f} active={folder === f} onClick={() => setFolder(f)}>
                        <UserText className="max-w-[14rem]" fallback="files/">{f ? `${f}/` : 'files/'}</UserText>
                        <span className="tabular-nums text-faint">{n}</span>
                      </Chip>
                    ))}
                  </div>
                )}
                <p className="text-[12.5px] text-mute tabular-nums" aria-live="polite">
                  {summary(inFolder.length, folder === null ? bytes : inFolder.reduce((n, e) => n + e.file.size, 0), filtering ? shown.length : undefined)}
                </p>
                {shown.length === 0 ? (
                  <InPlaceEmpty title="No file matches" action={<Button size="sm" onClick={() => setQ('')}>Clear filter</Button>} />
                ) : (
                  <LedgerTable label="Files" rows={shown} columns={columns} rowKey={(e) => e.key} estimate={44} />
                )}
              </>
            )}
          </div>
        </div>
        {selected && <Preview entry={selected} onClose={() => setOpen(null)} />}
      </div>
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn('flex h-8 min-w-0 items-center gap-1.5 rounded-full px-3 text-[13px] transition-[background-color,color] duration-150 ease-out pointer-coarse:h-10', active ? 'bg-ink text-pane' : 'bg-sunken text-mute hover:text-ink')}
    >
      {children}
    </button>
  )
}

const TEXT_LIMIT = 64 * 1024

/** Beside the list (wide screens) or over it: the file itself. */
function Preview({ entry: e, onClose }: { entry: Entry; onClose: () => void }) {
  const url = fileUrl(e.file.path)
  const [text, setText] = useState<{ body: string; cut: boolean } | 'error' | null>(null)
  const textual = (e.kind === 'text' || e.kind === 'code') && !/\.(pdf|docx?)$/i.test(e.file.name)
  useEffect(() => {
    setText(null)
    if (!textual) return
    const ctrl = new AbortController()
    fetch(url, { signal: ctrl.signal, headers: { range: `bytes=0-${TEXT_LIMIT - 1}` } })
      .then(async (r) => {
        if (!r.ok && r.status !== 206) throw new Error(String(r.status))
        const body = await r.text()
        setText({ body: body.slice(0, TEXT_LIMIT), cut: body.length >= TEXT_LIMIT || e.file.size > TEXT_LIMIT })
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setText('error')
      })
    return () => ctrl.abort()
  }, [url, textual, e.file.size])
  return (
    <aside
      aria-label={`Preview of ${e.file.name || 'file'}`}
      onKeyDown={(k) => k.key === 'Escape' && onClose()}
      className="absolute inset-0 z-10 flex min-h-0 flex-col bg-pane wide:static wide:w-[24rem] wide:shrink-0 wide:border-l wide:border-line"
    >
      <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-line px-2">
        <Button variant="ghost" size="sm" onClick={onClose} className="wide:hidden">
          <ChevronLeftIcon aria-hidden />
          Files
        </Button>
        <UserText className="min-w-0 flex-1 px-1 text-[14px] font-semibold" fallback="Unnamed file">{e.file.name}</UserText>
        <Button variant="ghost" size="icon" asChild>
          <a href={url} download={e.file.name || true} aria-label={`Download ${e.file.name || 'file'}`}>
            <DownloadIcon aria-hidden />
          </a>
        </Button>
      </header>
      <div className="scroller min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
          <dt className="text-mute">Size</dt>
          <dd className="tabular-nums">{formatBytes(e.file.size)} <span className="text-faint">({e.file.size.toLocaleString('en-GB')} bytes)</span></dd>
          <dt className="text-mute">Kind</dt>
          <dd>{e.file.mime ?? 'Unknown'}</dd>
          <dt className="text-mute">Folder</dt>
          <dd className="min-w-0"><UserText>{e.folder ? `files/${e.folder}/` : 'files/'}</UserText></dd>
        </dl>
        {e.kind === 'image' ? (
          <img src={url} alt={e.file.name} className="max-h-[60dvh] w-full rounded-lg bg-sunken object-contain" />
        ) : e.kind === 'video' ? (
          <video src={url} controls playsInline preload="metadata" className="aspect-video w-full rounded-lg bg-ink" />
        ) : e.kind === 'audio' ? (
          <audio src={url} controls preload="none" className="w-full" />
        ) : textual ? (
          text === null ? (
            <ListSkeleton rows={5} lines={1} />
          ) : text === 'error' ? (
            <p className="text-[13px] text-mute">Couldn’t read this file. Download it to open it.</p>
          ) : text.body.length === 0 ? (
            <p className="text-[13px] text-mute">This file is empty.</p>
          ) : (
            <>
              <pre dir="auto" className="scroller max-h-[60dvh] overflow-auto rounded-lg bg-sunken p-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{text.body}</pre>
              {text.cut && <p className="mt-2 text-[12.5px] text-faint">Showing the first 64 KB. Download it for the rest.</p>}
            </>
          )
        ) : (
          <p className="text-[13px] text-mute">No preview for this kind of file. Download it to open it.</p>
        )}
      </div>
    </aside>
  )
}
