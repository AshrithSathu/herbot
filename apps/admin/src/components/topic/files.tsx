// A topic's files (docs/design/DECISIONS.md, "Files": Browser). Every file
// under the topic's files/ folder as an aligned ledger (name, folder, kind,
// size) with a filter, sort and folder chips; images get a small thumbnail;
// picking one opens a preview beside the list on wide screens (over it
// below 68.75rem): the image, video or audio itself, or the first 64 KB of
// a text file.
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronLeftIcon,
  DownloadIcon,
  FileArchiveIcon,
  FileAudioIcon,
  FileCodeIcon,
  FileIcon,
  FileImageIcon,
  FileTextIcon,
  FileVideoIcon,
  XIcon,
} from 'lucide-react'
import { getFiles, type Attachment } from '../../api'
import { fold } from '@/components/hb/agent-list'
import { Button, SearchInput } from '@/components/hb/controls'
import { InPlaceEmpty, InPlaceError, ListSkeleton } from '@/components/hb/feedback'
import { LedgerTable, type Column } from '@/components/hb/rows'
import { fileUrl, formatBytes } from '@/components/rich-message'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'

type Kind = 'image' | 'video' | 'audio' | 'text' | 'code' | 'archive' | 'other'

function kindOf(file: Pick<Attachment, 'kind' | 'mime' | 'name'>): Kind {
  const mime = file.mime ?? ''
  const ext = file.name.includes('.') ? (file.name.split('.').pop()?.toLowerCase() ?? '') : ''
  if (file.kind === 'photo' || (mime.startsWith('image/') && mime !== 'image/svg+xml')) return 'image'
  if (file.kind === 'video' || mime.startsWith('video/')) return 'video'
  if (file.kind === 'voice' || file.kind === 'audio' || mime.startsWith('audio/')) return 'audio'
  if (['zip', 'gz', 'tar', 'rar', '7z'].includes(ext)) return 'archive'
  if (['json', 'ts', 'tsx', 'js', 'rs', 'py', 'sh', 'toml', 'yaml', 'yml', 'html', 'css'].includes(ext)) return 'code'
  if (mime.startsWith('text/') || ['md', 'txt', 'csv', 'pdf', 'docx', 'doc'].includes(ext)) return 'text'
  return 'other'
}

const KIND_ICON: Record<Kind, typeof FileIcon> = {
  image: FileImageIcon,
  video: FileVideoIcon,
  audio: FileAudioIcon,
  text: FileTextIcon,
  code: FileCodeIcon,
  archive: FileArchiveIcon,
  other: FileIcon,
}

const KIND_LABEL: Record<Kind, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  text: 'Document',
  code: 'Code',
  archive: 'Archive',
  other: 'Other file',
}

/** "chat_-100…/topic_7/files/out/report.pdf" → "out" (the folder under files/). */
function folderOf(path: string): string {
  const parts = path.split('/')
  const i = parts.indexOf('files')
  return (i >= 0 ? parts.slice(i + 1, -1) : parts.slice(0, -1)).join('/')
}

const folderLabel = (folder: string) => (folder ? `files/${folder}/` : 'files/')

type Entry = { file: Attachment; folder: string; kind: Kind; key: string }
type Sort = 'name' | 'size'

/** Natural, case-insensitive order: "report-2" before "report-10". */
const byName = (a: Entry, b: Entry) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true, sensitivity: 'base' })

function useFiles(topicId: number) {
  const query = useQuery({ queryKey: ['files', topicId], queryFn: () => getFiles({ data: topicId }), refetchInterval: 10_000 })
  const entries = useMemo<Entry[]>(
    () => (query.data ?? []).map((file, i) => ({ file, folder: folderOf(file.path), kind: kindOf(file), key: `${file.path}#${i}` })),
    [query.data],
  )
  return { query, entries }
}

const size = (n: number) => (Number.isFinite(n) ? n : 0)
const totalBytes = (list: Entry[]) => list.reduce((n, e) => n + size(e.file.size), 0)

export function TopicFiles({ topicId }: { topicId: number }) {
  const { query, entries } = useFiles(topicId)
  const [folder, setFolder] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort>('name')
  const [open, setOpen] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const wanted = fold(useDeferredValue(q).trim())
  useEffect(() => {
    setOpen(null)
    setFolder(null)
    setQ('')
  }, [topicId])

  const folders = useMemo(() => {
    const counts = new Map<string, number>()
    entries.forEach((e) => counts.set(e.folder, (counts.get(e.folder) ?? 0) + 1))
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [entries])
  const inFolder = useMemo(() => {
    const list = folder === null ? entries.slice() : entries.filter((e) => e.folder === folder)
    return list.sort(sort === 'size' ? (a, b) => size(b.file.size) - size(a.file.size) || byName(a, b) : byName)
  }, [entries, folder, sort])
  const shown = useMemo(() => (wanted ? inFolder.filter((e) => fold(`${e.folder}/${e.file.name}`).includes(wanted)) : inFolder), [inFolder, wanted])
  const selected = entries.find((e) => e.key === open) ?? null

  const columns: Column<Entry>[] = [
    {
      id: 'name',
      header: 'Name',
      width: 'minmax(12rem,1fr)',
      phone: 'title',
      cell: (e) => (
        <button
          type="button"
          onClick={() => setOpen(e.key)}
          aria-pressed={open === e.key}
          className="flex w-full min-w-0 items-center gap-2.5 text-left outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:shadow-[inset_0_0_0_2px_var(--ring)]"
        >
          <Thumb entry={e} />
          <UserText className="text-[14px] font-medium" fallback="Unnamed file">
            {e.file.name}
          </UserText>
        </button>
      ),
    },
    {
      id: 'folder',
      header: 'Folder',
      width: 'minmax(6rem,0.5fr)',
      phone: 'below',
      cell: (e) => (
        <UserText className="text-[13px] text-mute" fallback="files/">
          {folderLabel(e.folder)}
        </UserText>
      ),
    },
    { id: 'kind', header: 'Kind', width: '7rem', phone: 'hide', cell: (e) => <span className="text-[13px] text-mute">{KIND_LABEL[e.kind]}</span> },
    {
      id: 'size',
      header: 'Size',
      width: '5.5rem',
      numeric: true,
      phone: 'aside',
      cell: (e) => (
        <span className="text-[13px] text-mute" title={`${size(e.file.size).toLocaleString('en-GB')} bytes`}>
          {formatBytes(size(e.file.size))}
        </span>
      ),
    },
  ]

  const folderBytes = folder === null ? totalBytes(entries) : totalBytes(inFolder)
  const count = (n: number) => `${n.toLocaleString('en-GB')} ${n === 1 ? 'file' : 'files'}`

  return (
    // The preview sits beside the list only when the files area itself is
    // wide (it shares the window with the agents and details panes);
    // otherwise it covers the list, with "‹ Files" to go back.
    <div className="@container/files relative flex min-h-0 flex-1">
      <div data-hb-scroll className={cn('scroller min-h-0 flex-1 overflow-y-auto overscroll-contain', selected && '@max-[52rem]/files:hidden')}>
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-3 py-4 md:px-5">
          {query.isPending ? (
            <ListSkeleton rows={8} lines={1} />
          ) : query.error && !query.data ? (
            <InPlaceError title="Couldn’t load the files" error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} />
          ) : entries.length === 0 ? (
            <InPlaceEmpty title="No files yet">Files you send this agent, and files it makes, show up here.</InPlaceEmpty>
          ) : (
            <>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <SearchInput label="Filter files" value={q} onValueChange={setQ} placeholder={`Filter ${count(inFolder.length)}`} className="flex-1" />
                <label className="flex shrink-0 items-center gap-2 text-[13px] text-mute">
                  Sort
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as Sort)}
                    className="h-11 rounded-lg bg-sunken px-2.5 text-base text-ink outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--mute)] pointer-fine:h-10 pointer-fine:text-[14px]"
                  >
                    <option value="name">Name</option>
                    <option value="size">Largest first</option>
                  </select>
                </label>
              </div>
              {folders.length > 1 && (
                <div role="group" aria-label="Folders" className="flex flex-wrap gap-1.5">
                  <Chip active={folder === null} onClick={() => setFolder(null)}>
                    All <span className="text-faint tabular-nums">{entries.length.toLocaleString('en-GB')}</span>
                  </Chip>
                  {folders.map(([f, n]) => (
                    <Chip key={f} active={folder === f} onClick={() => setFolder(f)}>
                      <UserText className="max-w-[14rem]" fallback="files/">
                        {folderLabel(f)}
                      </UserText>
                      <span className="text-faint tabular-nums">{n.toLocaleString('en-GB')}</span>
                    </Chip>
                  ))}
                </div>
              )}
              <p className="text-[12.5px] text-mute tabular-nums" aria-live="polite">
                {wanted ? `${shown.length.toLocaleString('en-GB')} of ${count(inFolder.length)} match` : `${count(inFolder.length)} · ${formatBytes(folderBytes)}`}
              </p>
              {shown.length === 0 ? (
                <InPlaceEmpty
                  title="No file matches"
                  action={
                    <Button size="sm" onClick={() => setQ('')}>
                      Clear filter
                    </Button>
                  }
                />
              ) : (
                <LedgerTable label="Files" rows={shown} columns={columns} rowKey={(e) => e.key} selectedKey={open ?? undefined} estimate={44} />
              )}
            </>
          )}
        </div>
      </div>
      {selected && <Preview entry={selected} onClose={() => setOpen(null)} />}
    </div>
  )
}

/** A 24px thumbnail for images (lazy), the kind's icon for everything else. */
function Thumb({ entry: e }: { entry: Entry }) {
  const [broken, setBroken] = useState(false)
  if (e.kind === 'image' && !broken) {
    return (
      <img
        src={fileUrl(e.file.path)}
        alt=""
        width={24}
        height={24}
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
        className="size-6 shrink-0 rounded bg-sunken object-cover"
      />
    )
  }
  const Icon = KIND_ICON[e.kind]
  return (
    <span aria-hidden className="grid size-6 shrink-0 place-items-center">
      <Icon className="size-4 text-faint" />
    </span>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex h-8 min-w-0 items-center gap-1.5 rounded-full px-3 text-[13px] transition-[background-color,color] duration-150 ease-out pointer-coarse:h-11',
        active ? 'bg-ink text-pane' : 'bg-sunken text-mute hover:text-ink',
      )}
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
        setText({ body: body.slice(0, TEXT_LIMIT), cut: body.length >= TEXT_LIMIT || size(e.file.size) > TEXT_LIMIT })
      })
      .catch((err: Error) => {
        if (err.name !== 'AbortError') setText('error')
      })
    return () => ctrl.abort()
  }, [url, textual, e.file.size])
  const name = e.file.name || 'file'
  return (
    <aside
      aria-label={`Preview of ${name}`}
      onKeyDown={(k) => k.key === 'Escape' && onClose()}
      className="absolute inset-0 z-10 flex min-h-0 flex-col bg-pane @min-[52rem]/files:static @min-[52rem]/files:w-[22rem] @min-[52rem]/files:shrink-0 @min-[52rem]/files:border-l @min-[52rem]/files:border-line"
    >
      <header className="flex min-h-14 shrink-0 items-center gap-1 border-b border-line px-2">
        <Button variant="ghost" size="sm" onClick={onClose} className="@min-[52rem]/files:hidden">
          <ChevronLeftIcon aria-hidden />
          Files
        </Button>
        <UserText className="min-w-0 flex-1 px-1 text-[14px] font-semibold" fallback="Unnamed file">
          {e.file.name}
        </UserText>
        <Button variant="ghost" size="icon" asChild>
          <a href={url} download={e.file.name || true} aria-label={`Download ${name}`}>
            <DownloadIcon aria-hidden />
          </a>
        </Button>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close preview" className="hidden @min-[52rem]/files:inline-flex">
          <XIcon aria-hidden />
        </Button>
      </header>
      <div className="scroller min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
          <dt className="text-mute">Size</dt>
          <dd className="tabular-nums">
            {formatBytes(size(e.file.size))} <span className="text-faint">({size(e.file.size).toLocaleString('en-GB')} bytes)</span>
          </dd>
          <dt className="text-mute">Kind</dt>
          <dd className="min-w-0">
            <UserText fallback="Unknown">{e.file.mime}</UserText>
          </dd>
          <dt className="text-mute">Folder</dt>
          <dd className="min-w-0">
            <UserText>{folderLabel(e.folder)}</UserText>
          </dd>
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
              <pre dir="auto" className="scroller max-h-[60dvh] overflow-auto rounded-lg bg-sunken p-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
                {text.body}
              </pre>
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
