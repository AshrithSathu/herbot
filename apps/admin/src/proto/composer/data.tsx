// Throwaway prototype state for the composer variants (emil-prototype).
// Production's limits, real worst-case attachments, and a local "send" that
// never leaves the page: it takes ~1s, and fails (as Telegram does in the
// stress setup) whenever the text contains "fail".
import { useCallback, useRef, useState } from 'react'
import { formatBytes } from '@/components/rich-message'

export const MAX_CHARS = 3500
export const MAX_FILES = 10
export const MAX_FILE_BYTES = 20 * 1024 * 1024

export const MODES = [
  { id: 'auto', label: 'Auto', hint: 'Balanced: thinks as hard as the question needs' },
  { id: 'fast', label: 'Fast', hint: 'Quick answer, light reasoning' },
  { id: 'think', label: 'Think', hint: 'Thinks carefully before answering' },
  { id: 'heavy', label: 'Heavy', hint: 'Several sub-agents in parallel' },
  { id: 'deepsearch', label: 'DeepSearch', hint: 'Researches across the web, with sources' },
] as const
export type Mode = (typeof MODES)[number]['id']

export type DraftFile = { id: string; name: string; size: number; type: string }
export type Sent = { id: string; text: string; files: DraftFile[]; mode: Mode; status: 'sending' | 'sent' | 'failed'; error?: string }

/** Counted the way herbot-core counts: code points, not UTF-16 units. */
export const chars = (text: string) => Array.from(text).length

const SEED: DraftFile[] = [
  { id: 's1', name: `${'very_long_file_name_'.repeat(10)}.pdf`, size: 1_843_200, type: 'application/pdf' },
  { id: 's2', name: '名前のファイル 🦀 notes.md', size: 4_096, type: 'text/markdown' },
  { id: 's3', name: 'تقرير الأبحاث الشهري.docx', size: 312_000, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { id: 's4', name: 'screen-recording 2026-11-10 at 14.32.07.mov', size: 99_999_999_999, type: 'video/quicktime' },
]

export function fileProblem(f: DraftFile): string | null {
  return f.size > MAX_FILE_BYTES ? `${formatBytes(f.size)} is over the 20 MB limit` : null
}

export function useComposer() {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<DraftFile[]>(SEED)
  const [mode, setMode] = useState<Mode>('auto')
  const [sent, setSent] = useState<Sent[]>([])
  const counter = useRef(0)

  const count = chars(text)
  const over = count > MAX_CHARS
  const badFiles = files.filter((f) => fileProblem(f))
  const tooMany = files.length > MAX_FILES
  const sending = sent.some((s) => s.status === 'sending')
  const empty = !text.trim() && files.length === 0
  const problem = over
    ? `Shorten it by ${(count - MAX_CHARS).toLocaleString('en-GB')} characters to send`
    : badFiles.length
      ? `Remove ${badFiles.length === 1 ? 'the file' : `${badFiles.length} files`} over 20 MB to send`
      : tooMany
        ? `Up to ${MAX_FILES} files per message`
        : null
  const canSend = !empty && !problem && !sending

  const deliver = useCallback((id: string, failing: boolean) => {
    setTimeout(() => {
      setSent((all) =>
        all.map((s) =>
          s.id !== id
            ? s
            : failing
              ? { ...s, status: 'failed', error: 'E-4005: Telegram is disabled; chat and topic creation need the running bot' }
              : { ...s, status: 'sent' },
        ),
      )
    }, 1000)
  }, [])

  const send = useCallback(() => {
    if (!canSend) return false
    const id = `local-${++counter.current}`
    setSent((all) => [...all, { id, text: text.trim(), files, mode, status: 'sending' }])
    deliver(id, /fail/i.test(text))
    setText('')
    setFiles([])
    setMode('auto')
    return true
  }, [canSend, deliver, files, mode, text])

  const retry = useCallback(
    (id: string) => {
      setSent((all) => all.map((s) => (s.id === id ? { ...s, status: 'sending', error: undefined } : s)))
      deliver(id, true)
    },
    [deliver],
  )

  const addFiles = useCallback((list: FileList | null) => {
    if (!list) return
    const added = Array.from(list).map((f) => ({ id: `f-${++counter.current}`, name: f.name, size: f.size, type: f.type }))
    setFiles((all) => [...all, ...added])
  }, [])

  return {
    text,
    setText,
    files,
    removeFile: (id: string) => setFiles((all) => all.filter((f) => f.id !== id)),
    addFiles,
    mode,
    setMode,
    sent,
    retry,
    discard: (id: string) => setSent((all) => all.filter((s) => s.id !== id)),
    send,
    count,
    over,
    nearLimit: count > MAX_CHARS * 0.8,
    problem,
    canSend,
    sending,
  }
}
export type ComposerState = ReturnType<typeof useComposer>

/** Grows a textarea with its content between `min` and `max` lines. */
export function autoGrow(el: HTMLTextAreaElement | null, maxPx: number) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`
}

export const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
