import { useState, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Dialog } from 'radix-ui'
import { XIcon, DownloadIcon } from 'lucide-react'
import type { Attachment } from '../api'
import { CopyButton } from '../ui'
import { Button } from './ui/button'
const fileUrl = (path: string) => `/api/files/${path.split('/').map(encodeURIComponent).join('/')}`
function textOf(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node && typeof node === 'object' && 'props' in node)
    return textOf((node.props as { children: ReactNode }).children)
  return ''
}
export function RichMessage({ body }: { body: string }) {
  return (
    <div className="chat-markdown min-w-0 wrap-anywhere">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        skipHtml
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ alt }) => <span>{alt ? `[Image: ${alt}]` : '[Image]'}</span>,
          pre: ({ children }) => (
            <div className="my-3 min-w-0 overflow-hidden rounded-xl border bg-muted/60">
              <div className="flex justify-end border-b">
                <CopyButton text={textOf(children)} label="Copy code" />
              </div>
              <pre tabIndex={0} className="scroller overflow-x-auto p-4 text-[13px]">
                {children}
              </pre>
            </div>
          ),
          table: ({ children }) => (
            <div className="scroller my-3 overflow-x-auto">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {body}
      </Markdown>
    </div>
  )
}
export function FilePreview({ file }: { file: Attachment }) {
  const [open, setOpen] = useState(false)
  const url = fileUrl(file.path)
  const image = file.mime?.startsWith('image/') && file.mime !== 'image/svg+xml'
  return (
    <div className="min-w-0 rounded-xl border bg-card p-2 text-card-foreground">
      {image && (
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger asChild>
            <button
              type="button"
              className="block min-h-11 w-full rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
              aria-label={`Enlarge ${file.name}`}
            >
              <img src={url} alt={file.name} loading="lazy" className="max-h-52 w-full rounded-lg object-contain" />
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-50 bg-black/80" />
            <Dialog.Content className="fixed inset-4 z-50 flex flex-col items-center justify-center gap-3 rounded-xl bg-background p-4">
              <Dialog.Title className="max-w-full truncate text-sm">{file.name}</Dialog.Title>
              <Dialog.Description className="sr-only">Image preview</Dialog.Description>
              <img src={url} alt={file.name} className="min-h-0 max-w-full flex-1 object-contain" />
              <Dialog.Close asChild>
                <Button variant="secondary" className="min-h-11">
                  <XIcon />
                  Close
                </Button>
              </Dialog.Close>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
      {(file.kind === 'video' || file.mime?.startsWith('video/')) && (
        <video controls preload="metadata" src={url} className="max-h-64 w-full rounded-lg">
          <track kind="captions" />
        </video>
      )}
      {(file.kind === 'voice' || file.kind === 'audio' || file.mime?.startsWith('audio/')) && (
        <audio controls preload="metadata" src={url} className="w-full" />
      )}
      <a href={url} download className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted">
        <DownloadIcon className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{file.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{Math.max(1, Math.ceil(file.size / 1024))} KB</span>
      </a>
    </div>
  )
}
