// Agent and user messages as Markdown, and files as compact cards. Both are
// built for hostile content: 2,500-character words, 120-line code blocks,
// 16-column tables, raw HTML, any script or direction, files that are gone
// from disk or claim to be 100 GB.
import { useState, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Dialog } from 'radix-ui'
import {
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
import type { Attachment } from '../api'
import { CopyButton } from '@/components/hb/feedback'
import { Button } from '@/components/hb/controls'
import { cn } from '@/lib/utils'

export const fileUrl = (path: string) => `/api/files/${path.split('/').map(encodeURIComponent).join('/')}`

/** 1,536 → "1.5 KB"; 99,999,999,999 → "93.1 GB". Binary units, one decimal. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node && typeof node === 'object' && 'props' in node)
    return textOf((node.props as { children: ReactNode }).children)
  return ''
}

/** The language a fenced block declared (`language-ts`), for its header. */
function languageOf(node: ReactNode): string | null {
  const child = Array.isArray(node) ? node[0] : node
  if (child && typeof child === 'object' && 'props' in child) {
    const className = (child.props as { className?: string }).className ?? ''
    const match = /language-([\w+-]+)/.exec(className)
    return match?.[1] ?? null
  }
  return null
}

export function RichMessage({ body }: { body: string }) {
  return (
    <div dir="auto" className="chat-markdown min-w-0 wrap-anywhere">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        // Raw HTML in a message is text, never markup.
        skipHtml
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="break-all">
              {children}
            </a>
          ),
          // Agents link images by path; they arrive as file cards instead.
          img: ({ alt }) => <span className="text-muted-foreground">{alt ? `[Image: ${alt}]` : '[Image]'}</span>,
          h1: ({ children }) => <p className="mt-3 mb-1 text-[1.15em] font-semibold">{children}</p>,
          h2: ({ children }) => <p className="mt-3 mb-1 text-[1.08em] font-semibold">{children}</p>,
          h3: ({ children }) => <p className="mt-3 mb-1 font-semibold">{children}</p>,
          pre: ({ children }) => {
            const language = languageOf(children)
            return (
              <div className="my-3 min-w-0 overflow-hidden rounded-lg border bg-muted/60" dir="ltr">
                <div className="flex min-h-11 items-center justify-between gap-2 border-b pl-3 text-xs text-muted-foreground">
                  <span className="truncate font-mono">{language ?? 'code'}</span>
                  <CopyButton value={textOf(children)} label="Copy code" />
                </div>
                <pre tabIndex={0} className="scroller max-h-[28rem] overflow-auto p-3 text-[13px] leading-relaxed">
                  {children}
                </pre>
              </div>
            )
          },
          table: ({ children }) => (
            <div tabIndex={0} className="scroller my-3 max-w-full overflow-x-auto rounded-lg border" dir="auto">
              <table className="w-max min-w-full border-collapse text-sm">{children}</table>
            </div>
          ),
        }}
      >
        {body}
      </Markdown>
    </div>
  )
}

type Kind = 'image' | 'video' | 'audio' | 'text' | 'code' | 'archive' | 'other'

function kindOf(file: Pick<Attachment, 'kind' | 'mime' | 'name'>): Kind {
  const mime = file.mime ?? ''
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (file.kind === 'photo' || (mime.startsWith('image/') && mime !== 'image/svg+xml')) return 'image'
  if (file.kind === 'video' || mime.startsWith('video/')) return 'video'
  if (file.kind === 'voice' || file.kind === 'audio' || mime.startsWith('audio/')) return 'audio'
  if (['zip', 'gz', 'tar', 'rar', '7z'].includes(ext)) return 'archive'
  if (['json', 'ts', 'tsx', 'js', 'rs', 'py', 'sh', 'toml', 'yaml', 'yml', 'html', 'css'].includes(ext)) return 'code'
  if (mime.startsWith('text/') || ['md', 'txt', 'csv', 'pdf', 'docx', 'doc'].includes(ext)) return 'text'
  return 'other'
}

const ICON: Record<Kind, typeof FileIcon> = {
  image: FileImageIcon,
  video: FileVideoIcon,
  audio: FileAudioIcon,
  text: FileTextIcon,
  code: FileCodeIcon,
  archive: FileArchiveIcon,
  other: FileIcon,
}

/** A thumbnail that falls back to the file's icon when the image is missing. */
function Thumb({ file, kind }: { file: Attachment; kind: Kind }) {
  const [failed, setFailed] = useState(false)
  const Icon = ICON[kind]
  if (kind === 'image' && !failed) {
    return (
      <img
        src={fileUrl(file.path)}
        alt=""
        width={40}
        height={40}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="size-10 shrink-0 rounded-md border bg-muted object-cover"
      />
    )
  }
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
      <Icon className="size-5" aria-hidden />
    </span>
  )
}

/** One file as a row: thumbnail or icon, name, size, and what you can do with
 * it. Images and videos open in a viewer; everything downloads. */
export function FilePreview({ file, detail, className }: { file: Attachment; detail?: ReactNode; className?: string }) {
  const kind = kindOf(file)
  const url = fileUrl(file.path)
  const viewable = kind === 'image' || kind === 'video'
  return (
    <div
      className={cn(
        'flex min-h-14 min-w-0 items-center gap-3 rounded-lg border bg-card py-2 pr-1 pl-2 text-card-foreground',
        className,
      )}
    >
      <Thumb file={file} kind={kind} />
      <div className="min-w-0 flex-1">
        {viewable ? (
          <Viewer file={file} kind={kind}>
            <button
              type="button"
              className="block w-full min-w-0 cursor-pointer rounded text-left text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span dir="auto" title={file.name} className="user-text block truncate">
                {file.name || 'Unnamed file'}
              </span>
            </button>
          </Viewer>
        ) : (
          <span dir="auto" title={file.name} className="user-text block truncate text-sm font-medium">
            {file.name || 'Unnamed file'}
          </span>
        )}
        <span className="block truncate text-xs text-muted-foreground tabular-nums">
          {formatBytes(file.size)}
          {detail}
        </span>
        {kind === 'audio' && (
          <audio controls preload="none" src={url} className="mt-1.5 h-9 w-full max-w-80">
            <track kind="captions" />
          </audio>
        )}
      </div>
      <Button variant="ghost" size="icon" asChild className="size-11 shrink-0 text-muted-foreground">
        <a href={url} download={file.name || true} aria-label={`Download ${file.name || 'file'}`}>
          <DownloadIcon aria-hidden />
        </a>
      </Button>
    </div>
  )
}

/** Full-size image or video, in a dialog; only loaded when opened. */
function Viewer({ file, kind, children }: { file: Attachment; kind: Kind; children: ReactNode }) {
  const [failed, setFailed] = useState(false)
  const url = fileUrl(file.path)
  return (
    <Dialog.Root onOpenChange={(open) => open && setFailed(false)}>
      <Dialog.Trigger asChild>{children}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/80 duration-150 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed inset-[max(1rem,env(safe-area-inset-top))_max(1rem,env(safe-area-inset-right))_max(1rem,env(safe-area-inset-bottom))_max(1rem,env(safe-area-inset-left))] z-50 flex flex-col gap-3 rounded-xl bg-background p-3 shadow-lg outline-none duration-150 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]">
          <div className="flex min-w-0 items-center gap-2">
            <Dialog.Title dir="auto" className="user-text min-w-0 flex-1 truncate pl-1 text-sm font-medium">
              {file.name || 'Unnamed file'}
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              {kind === 'image' ? 'Image preview' : 'Video preview'}, {formatBytes(file.size)}
            </Dialog.Description>
            <Button variant="ghost" size="icon" asChild className="size-11">
              <a href={url} download={file.name || true} aria-label="Download">
                <DownloadIcon aria-hidden />
              </a>
            </Button>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" className="size-11" aria-label="Close">
                <XIcon aria-hidden />
              </Button>
            </Dialog.Close>
          </div>
          <div className="grid min-h-0 flex-1 place-items-center overflow-hidden rounded-lg bg-muted/50">
            {failed ? (
              <p className="max-w-[40ch] p-6 text-center text-sm text-muted-foreground">
                This file couldn’t be loaded. It may have been moved or deleted from the topic’s folder.
              </p>
            ) : kind === 'image' ? (
              <img src={url} alt={file.name} onError={() => setFailed(true)} className="max-h-full max-w-full object-contain" />
            ) : (
              <video controls autoPlay={false} playsInline preload="metadata" src={url} onError={() => setFailed(true)} className="max-h-full max-w-full">
                <track kind="captions" />
              </video>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
