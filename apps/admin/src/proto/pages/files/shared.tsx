// Shared parts of the /proto/page-files variants: the files query, kinds,
// folders, filtering and one file row. The variants differ in where files
// live and how they're browsed. Throwaway: deleted with src/proto.
import { useDeferredValue, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DownloadIcon, FileArchiveIcon, FileAudioIcon, FileCodeIcon, FileIcon, FileImageIcon, FileTextIcon, FileVideoIcon, SearchIcon, XIcon } from 'lucide-react'
import { getFiles, type Attachment } from '../../../api'
import { fileUrl, formatBytes } from '@/components/rich-message'
import { fold } from '@/components/hb/agent-list'
import { UserText } from '@/components/user-text'
import { cn } from '@/lib/utils'

export type Kind = 'image' | 'video' | 'audio' | 'text' | 'code' | 'archive' | 'other'

export function kindOf(file: Pick<Attachment, 'kind' | 'mime' | 'name'>): Kind {
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

export const KIND_ICON: Record<Kind, typeof FileIcon> = {
  image: FileImageIcon,
  video: FileVideoIcon,
  audio: FileAudioIcon,
  text: FileTextIcon,
  code: FileCodeIcon,
  archive: FileArchiveIcon,
  other: FileIcon,
}

export const KIND_LABEL: Record<Kind, string> = {
  image: 'Images',
  video: 'Videos',
  audio: 'Audio',
  text: 'Documents',
  code: 'Code',
  archive: 'Archives',
  other: 'Other files',
}

/** "chat_-100…/topic_7/files/out/report.pdf" → "out" (the folder under files/). */
export function folderOf(path: string): string {
  const parts = path.split('/')
  const i = parts.indexOf('files')
  return (i >= 0 ? parts.slice(i + 1, -1) : parts.slice(0, -1)).join('/')
}

export type Entry = { file: Attachment; folder: string; kind: Kind; key: string }

export function useFiles(topicId: number) {
  const query = useQuery({ queryKey: ['files', topicId], queryFn: () => getFiles({ data: topicId }), refetchInterval: 10_000 })
  const entries = useMemo<Entry[]>(
    () =>
      (query.data ?? []).map((file, i) => ({ file, folder: folderOf(file.path), kind: kindOf(file), key: `${file.path}#${i}` })),
    [query.data],
  )
  const bytes = useMemo(() => entries.reduce((n, e) => n + (Number.isFinite(e.file.size) ? e.file.size : 0), 0), [entries])
  return { query, entries, bytes }
}

/** Natural, case-insensitive order: "report-2" before "report-10". */
export const byName = (a: Entry, b: Entry) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true, sensitivity: 'base' })

export function useFilter(entries: Entry[]) {
  const [q, setQ] = useState('')
  const wanted = fold(useDeferredValue(q).trim())
  const shown = useMemo(() => (wanted ? entries.filter((e) => fold(`${e.folder}/${e.file.name}`).includes(wanted)) : entries), [entries, wanted])
  return { q, setQ, shown, filtering: wanted.length > 0 }
}

export function FilterBox({ id, q, setQ, total, className }: { id: string; q: string; setQ: (q: string) => void; total: number; className?: string }) {
  return (
    <div className={cn('relative', className)}>
      <label htmlFor={id} className="sr-only">
        Filter files
      </label>
      <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
      <input
        id={id}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setQ('')}
        placeholder={`Filter ${total.toLocaleString('en-GB')} files`}
        autoComplete="off"
        spellCheck={false}
        className="h-10 w-full rounded-lg bg-sunken pr-10 pl-9 text-base text-ink outline-none placeholder:text-faint focus-visible:shadow-[inset_0_0_0_1px_var(--mute)] md:text-[14px] pointer-coarse:h-11 [&::-webkit-search-cancel-button]:hidden"
      />
      {q && (
        <button
          type="button"
          onClick={() => setQ('')}
          aria-label="Clear filter"
          className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-md text-faint hover:text-ink pointer-coarse:size-11"
        >
          <XIcon className="size-4" aria-hidden />
        </button>
      )}
    </div>
  )
}

/** One file: kind icon, name (any script, any length), folder, size, and a
 * download that's always visible. `onOpen` makes the name a button. */
export function FileRow({ entry: e, selected = false, onOpen, dense = false }: { entry: Entry; selected?: boolean; onOpen?: () => void; dense?: boolean }) {
  const Icon = KIND_ICON[e.kind]
  const name = <UserText className="text-[14px] font-medium" fallback="Unnamed file">{e.file.name}</UserText>
  return (
    <div className={cn('group relative flex min-w-0 items-center gap-3 px-3', dense ? 'min-h-11' : 'min-h-14', selected && 'bg-sunken shadow-[inset_3px_0_0_var(--ink)]')}>
      <Icon aria-hidden className="size-4 shrink-0 text-faint" />
      <div className="flex min-w-0 flex-1 flex-col py-1.5">
        {onOpen ? (
          <button type="button" onClick={onOpen} aria-pressed={selected} className="min-w-0 text-left outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:shadow-[inset_0_0_0_2px_var(--ring)]">
            {name}
          </button>
        ) : (
          name
        )}
        {!dense && (
          <span className="flex min-w-0 gap-1.5 text-[12px] text-faint">
            <UserText className="min-w-0" fallback="files/">{e.folder ? `files/${e.folder}/` : 'files/'}</UserText>
          </span>
        )}
      </div>
      <span className="shrink-0 text-[12.5px] text-mute tabular-nums" title={`${e.file.size.toLocaleString('en-GB')} bytes`}>
        {formatBytes(e.file.size)}
      </span>
      <a
        href={fileUrl(e.file.path)}
        download={e.file.name || true}
        aria-label={`Download ${e.file.name || 'file'}`}
        className="relative z-10 grid size-9 shrink-0 place-items-center rounded-md text-faint transition-[background-color,color] duration-150 ease-out hover:bg-sunken hover:text-ink pointer-coarse:size-11"
      >
        <DownloadIcon className="size-4" aria-hidden />
      </a>
    </div>
  )
}

export function summary(count: number, bytes: number, shown?: number) {
  return shown !== undefined && shown !== count
    ? `${shown.toLocaleString('en-GB')} of ${count.toLocaleString('en-GB')} files match`
    : `${count.toLocaleString('en-GB')} ${count === 1 ? 'file' : 'files'} · ${formatBytes(bytes)}`
}
