// Variant 3 "Gallery": content-type axis. Media first (images and videos as
// a thumbnail grid you can open), then everything else grouped by kind
// (Documents, Code, Other files), each group folded past 8 files.
import { useMemo, useState } from 'react'
import { Dialog } from 'radix-ui'
import { PlayIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/hb/controls'
import { InPlaceEmpty, InPlaceError, ListSkeleton } from '@/components/hb/feedback'
import { fileUrl, formatBytes } from '@/components/rich-message'
import { UserText } from '@/components/user-text'
import { Frame, useTopicParam } from '../topic/shared'
import { byName, FileRow, FilterBox, KIND_LABEL, summary, useFiles, useFilter, type Entry, type Kind } from './shared'
import { TopicViews } from './views'

const GROUPS: Kind[] = ['text', 'code', 'audio', 'archive', 'other']
const FOLD = 8

export function GalleryVariant() {
  const [id, select] = useTopicParam()
  return (
    <Frame topicId={id} onSelect={select}>
      <TopicViews topicId={id} files={(header) => <Gallery id={id} header={header} />} />
    </Frame>
  )
}

function Gallery({ id, header }: { id: number; header: React.ReactNode }) {
  const { query, entries, bytes } = useFiles(id)
  const sorted = useMemo(() => entries.slice().sort(byName), [entries])
  const { q, setQ, shown, filtering } = useFilter(sorted)
  const media = shown.filter((e) => e.kind === 'image' || e.kind === 'video')
  const [viewing, setViewing] = useState<Entry | null>(null)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <div data-hb-scroll className="scroller min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-3 py-4 md:px-6">
          {query.isPending ? (
            <ListSkeleton rows={8} lines={1} />
          ) : query.error && !query.data ? (
            <InPlaceError title="Couldn’t load the files" error={query.error} onRetry={() => query.refetch()} />
          ) : entries.length === 0 ? (
            <InPlaceEmpty title="No files yet">Photos, videos and documents you send this agent, and files it makes, show up here.</InPlaceEmpty>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <FilterBox id={`gallery-${id}`} q={q} setQ={setQ} total={entries.length} />
                <p className="text-[12.5px] text-mute tabular-nums" aria-live="polite">
                  {summary(entries.length, bytes, filtering ? shown.length : undefined)}
                </p>
              </div>
              {shown.length === 0 && <InPlaceEmpty title="No file matches" action={<Button size="sm" onClick={() => setQ('')}>Clear filter</Button>} />}
              {media.length > 0 && (
                <section aria-labelledby="g-media" className="flex flex-col gap-2">
                  <h2 id="g-media" className="text-[11px] font-medium tracking-[0.06em] text-mute uppercase">
                    Photos and videos <span className="tabular-nums text-faint">{media.length}</span>
                  </h2>
                  <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {media.map((e) => (
                      <li key={e.key}>
                        <Tile entry={e} onOpen={() => setViewing(e)} />
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {GROUPS.map((k) => {
                const group = shown.filter((e) => e.kind === k)
                return group.length > 0 ? <Group key={k} kind={k} entries={group} /> : null
              })}
            </>
          )}
        </div>
      </div>
      <Viewer entry={viewing} onClose={() => setViewing(null)} />
    </div>
  )
}

function Tile({ entry: e, onOpen }: { entry: Entry; onOpen: () => void }) {
  const [failed, setFailed] = useState(false)
  return (
    <button type="button" onClick={onOpen} className="group flex w-full flex-col gap-1.5 text-left outline-none">
      <span className="relative grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-xl bg-sunken shadow-[inset_0_0_0_var(--hair)_var(--line)] transition-[scale] duration-150 ease-out group-focus-visible:shadow-[0_0_0_2px_var(--ring)] group-active:scale-[0.98]">
        {e.kind === 'image' && !failed ? (
          <img src={fileUrl(e.file.path)} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} className="size-full object-cover" />
        ) : (
          <span className="grid size-11 place-items-center rounded-full bg-pane text-ink shadow-raised">
            <PlayIcon className="ml-0.5 size-4" aria-hidden />
          </span>
        )}
      </span>
      <UserText className="text-[13px] font-medium" fallback="Unnamed file">{e.file.name}</UserText>
      <span className="text-[12px] text-faint tabular-nums">{formatBytes(e.file.size)}</span>
    </button>
  )
}

function Group({ kind, entries }: { kind: Kind; entries: Entry[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? entries : entries.slice(0, FOLD)
  return (
    <section aria-labelledby={`g-${kind}`} className="flex flex-col gap-1">
      <h2 id={`g-${kind}`} className="text-[11px] font-medium tracking-[0.06em] text-mute uppercase">
        {KIND_LABEL[kind]} <span className="tabular-nums text-faint">{entries.length}</span>
      </h2>
      <ul className="flex flex-col border-t border-line">
        {shown.map((e) => (
          <li key={e.key} className="border-b border-line [content-visibility:auto] [contain-intrinsic-size:auto_56px]">
            <FileRow entry={e} />
          </li>
        ))}
      </ul>
      {entries.length > FOLD && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setAll((a) => !a)}>
            {all ? 'Show fewer' : `Show all ${entries.length.toLocaleString('en-GB')}`}
          </Button>
        </div>
      )}
    </section>
  )
}

function Viewer({ entry, onClose }: { entry: Entry | null; onClose: () => void }) {
  return (
    <Dialog.Root open={!!entry} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[oklch(0_0_0/0.7)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-180 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200" />
        <Dialog.Content aria-describedby={undefined} className="hb fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-transparent p-4 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.97] data-[state=open]:duration-200">
          {entry && (
            <>
              <div className="flex w-full max-w-4xl items-center gap-2 text-[oklch(0.95_0_0)]">
                <Dialog.Title className="min-w-0 flex-1 text-[14px] font-medium">
                  <UserText fallback="Unnamed file">{entry.file.name}</UserText>
                </Dialog.Title>
                <Dialog.Close asChild>
                  <button type="button" aria-label="Close" className="grid size-11 place-items-center rounded-full hover:bg-[oklch(1_0_0/0.12)]">
                    <XIcon className="size-5" aria-hidden />
                  </button>
                </Dialog.Close>
              </div>
              {entry.kind === 'image' ? (
                <img src={fileUrl(entry.file.path)} alt={entry.file.name} className="max-h-[80dvh] max-w-full rounded-lg object-contain" />
              ) : (
                <video src={fileUrl(entry.file.path)} controls playsInline preload="metadata" className="aspect-video max-h-[80dvh] w-full max-w-4xl rounded-lg bg-black" />
              )}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
