// The "Quiet" control kit (docs/design/DECISIONS.md, "Form controls"):
// segmented choices with the chosen option's description underneath (a menu
// on phones), light buttons, labels above fields, destructive actions as
// quiet red text that always confirm elsewhere.
import { useId, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { Slot, Tabs as TabsPrimitive } from 'radix-ui'
import { cva, type VariantProps } from 'class-variance-authority'
import { ChevronDownIcon, LoaderIcon, SearchIcon, XIcon } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

const button = cva(
  // The hit area is bigger than the visual: an invisible ::before reaches
  // 40px on desktop (Polish), and touch screens get 44px boxes outright.
  // Disabled reads as a muted token, never as opacity (which fails contrast
  // on some surfaces and passes on others).
  "relative inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg text-[14px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow,scale] duration-150 ease-out outline-none select-none before:absolute before:content-[''] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-pane active:scale-[0.96] disabled:pointer-events-none disabled:text-faint [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: 'bg-accent-strong text-accent-ink hover:bg-[color-mix(in_oklch,var(--accent-strong)_88%,black)] disabled:bg-sunken disabled:shadow-[inset_0_0_0_var(--hair)_var(--line)]',
        secondary: 'bg-sunken text-ink shadow-[inset_0_0_0_var(--hair)_var(--line)] hover:bg-[color-mix(in_oklch,var(--sunken)_92%,var(--ink))]',
        ghost: 'text-mute hover:bg-sunken hover:text-ink',
        /** Quiet red text: the action is always confirmed in a dialog. */
        danger: 'text-destructive hover:bg-destructive-soft',
      },
      size: {
        sm: 'h-8 px-2.5 before:inset-x-0 before:-inset-y-1 pointer-coarse:h-11 pointer-coarse:before:inset-y-0',
        md: 'h-9 px-3.5 before:inset-x-0 before:-inset-y-0.5 pointer-coarse:h-11 pointer-coarse:before:inset-y-0',
        icon: 'size-9 before:-inset-0.5 pointer-coarse:size-11 pointer-coarse:before:inset-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof button> & {
    asChild?: boolean
    /** Shows a spinner, keeps the label, and blocks repeat presses. */
    pending?: boolean
  }

export function Button({ variant, size, asChild = false, pending = false, disabled, className, children, type = 'button', ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      type={asChild ? undefined : type}
      disabled={asChild ? undefined : disabled || pending}
      aria-busy={pending || undefined}
      className={cn(button({ variant, size }), className)}
      {...props}
    >
      {pending && !asChild ? (
        <>
          <LoaderIcon aria-hidden className="motion-safe:animate-spin" />
          {children}
        </>
      ) : (
        children
      )}
    </Comp>
  )
}
export { button as buttonVariants }

type FieldProps = {
  label: ReactNode
  /** Associates the label; defaults to a generated id passed to children. */
  id?: string
  hint?: ReactNode
  error?: ReactNode
  /** Shown alongside an error, not instead of it (Caps Lock is on). */
  warning?: ReactNode
  /** Code-point count against a limit, shown near the limit. */
  counter?: { count: number; max: number }
  children: (props: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode
  className?: string
}

/** Label above, the control, then the warning, and the error or hint. */
export function Field({ label, id, hint, error, warning, counter, children, className }: FieldProps) {
  const auto = useId()
  const fieldId = id ?? auto
  const noteId = `${fieldId}-note`
  const warnId = `${fieldId}-warn`
  const describedBy = [warning ? warnId : null, error || hint ? noteId : null].filter(Boolean).join(' ') || undefined
  const near = counter && counter.count > counter.max * 0.8
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={fieldId} className="text-[13px] font-medium text-ink">
          {label}
        </label>
        {near && (
          <span className={cn('text-[12px] tabular-nums', counter.count > counter.max ? 'font-medium text-destructive' : 'text-mute')}>
            {counter.count.toLocaleString('en-GB')} / {counter.max.toLocaleString('en-GB')}
          </span>
        )}
      </div>
      {children({ id: fieldId, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {warning && (
        <p id={warnId} className="text-[12.5px] text-warning">
          {warning}
        </p>
      )}
      {(error || hint) && (
        <p id={noteId} className={cn('text-[12.5px]', error ? 'text-destructive' : 'text-mute')}>
          {error ?? hint}
        </p>
      )}
    </div>
  )
}

const control =
  'w-full min-w-0 rounded-lg bg-sunken px-3 text-base text-ink shadow-[inset_0_0_0_var(--hair)_var(--line)] outline-none transition-[box-shadow] duration-150 ease-out placeholder:text-faint focus-visible:shadow-[inset_0_0_0_1px_var(--mute)] aria-invalid:shadow-[inset_0_0_0_1px_var(--destructive)] disabled:text-faint pointer-fine:text-[14px]'

export function TextInput({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(control, 'h-10', className)} {...props} />
}

export function TextArea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea dir="auto" className={cn(control, 'min-h-28 resize-y py-2.5 leading-relaxed', className)} {...props} />
}

export type Choice<V extends string> = { value: V; label: string; hint?: string }

type SegmentedProps<V extends string> = {
  label: string
  value: V
  options: readonly Choice<V>[]
  onValueChange: (value: V) => void
  disabled?: boolean
  className?: string
}

/** A segmented radio group with the chosen option's description under it.
 * When its labels don't fit its own width (a phone, a narrow pane, a long
 * count), it becomes a native select instead of truncating them: the choice
 * is decided by measuring, not by the window's breakpoint. Before the first
 * measurement (server render) it follows `md`. */
export function Segmented<V extends string>({ label, value, options, onValueChange, disabled, className }: SegmentedProps<V>) {
  const id = useId()
  const current = options.find((o) => o.value === value)
  const index = options.findIndex((o) => o.value === value)
  const box = useRef<HTMLDivElement>(null)
  const natural = useRef<HTMLDivElement>(null)
  const [fits, setFits] = useState<boolean | null>(null)
  useLayoutEffect(() => {
    const el = box.current
    const ruler = natural.current
    if (!el || !ruler) return
    const measure = () => {
      if (el.clientWidth === 0) return // hidden pane: keep the last answer
      // Segments share the row equally, so the widest label decides.
      const widths = Array.from(ruler.children, (c) => (c as HTMLElement).offsetWidth)
      const widest = Math.max(0, ...widths)
      setFits(widest * widths.length + 4 <= el.clientWidth)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [options])
  const segments = fits === null ? 'hidden md:flex' : fits ? 'flex' : 'hidden'
  const select = fits === null ? 'md:hidden' : fits ? 'hidden' : ''
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <span id={`${id}-label`} className="text-[13px] font-medium text-ink">
        {label}
      </span>
      <div ref={box} className="relative min-w-0">
        {/* The labels at their natural width, never shown (clipped, so the
            ruler can't widen any scroller): what "fits" means. */}
        <div aria-hidden className="pointer-events-none invisible absolute inset-0 overflow-hidden">
          <div ref={natural} className="flex w-max">
            {options.map((o) => (
              <span key={o.value} className="px-2 text-[13px] font-medium whitespace-nowrap">
                {o.label}
              </span>
            ))}
          </div>
        </div>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        aria-describedby={current?.hint ? `${id}-hint` : undefined}
        className={cn('min-w-0 rounded-lg bg-sunken p-0.5 shadow-[inset_0_0_0_var(--hair)_var(--line)]', segments)}
        onKeyDown={(e) => {
          const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
          if (!step || disabled) return
          e.preventDefault()
          const next = options[(index + step + options.length) % options.length]
          onValueChange(next.value)
          ;(e.currentTarget.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus()
        }}
      >
        {options.map((o) => {
          const on = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              data-value={o.value}
              tabIndex={on ? 0 : -1}
              disabled={disabled}
              onClick={() => onValueChange(o.value)}
              className={cn(
                // Weight never changes with selection: colour and surface only.
                "relative h-8 min-w-0 flex-1 rounded-md px-2 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-150 ease-out before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] focus-visible:ring-2 focus-visible:ring-ring disabled:text-faint pointer-coarse:h-11 pointer-coarse:before:inset-y-0",
                on ? 'bg-pane text-ink shadow-raised' : 'text-mute hover:text-ink',
              )}
            >
              {/* Truncation lives inside: on the button it would clip the hit area. */}
              <span className="block truncate">{o.label}</span>
            </button>
          )
        })}
      </div>
      <div className={cn('relative', select)}>
        <select
          aria-labelledby={`${id}-label`}
          value={value}
          disabled={disabled}
          onChange={(e) => onValueChange(e.target.value as V)}
          className={cn(control, 'h-11 appearance-none pr-9')}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDownIcon aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-mute" />
      </div>
      </div>
      {current?.hint && (
        <p id={`${id}-hint`} className="text-[12.5px] text-mute">
          {current.hint}
        </p>
      )}
    </div>
  )
}

type SwitchRowProps = {
  label: ReactNode
  description?: ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  pending?: boolean
  error?: ReactNode
  disabled?: boolean
}

/** A whole row that toggles: label, description, the switch; no dead zones. */
export function SwitchRow({ label, description, checked, onCheckedChange, pending, error, disabled }: SwitchRowProps) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center justify-between gap-4">
        <span className="flex min-w-0 flex-col">
          <span className="text-[14px] text-ink">{label}</span>
          {description && <span className="text-[12.5px] text-mute">{description}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {pending && <LoaderIcon aria-label="Saving" className="size-3.5 text-mute motion-safe:animate-spin" />}
          <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled || pending} />
        </span>
      </label>
      {error && <p className="text-[12.5px] text-destructive">{error}</p>}
    </div>
  )
}

type SearchInputProps = Omit<ComponentProps<'input'>, 'type' | 'value' | 'onChange'> & {
  /** Visible label for screen readers (the field has no visible label). */
  label: string
  value: string
  onValueChange: (value: string) => void
}

/** A search field: icon inside, a clear button that refocuses, Escape
 * clears. 16px text on touch screens (no iOS zoom), 14px with a mouse. */
export function SearchInput({ label, value, onValueChange, className, id, onKeyDown, ...props }: SearchInputProps) {
  const auto = useId()
  const fieldId = id ?? auto
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className={cn('relative', className)}>
      <label htmlFor={fieldId} className="sr-only">
        {label}
      </label>
      <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
      <input
        ref={input}
        id={fieldId}
        type="search"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault()
            e.stopPropagation()
            onValueChange('')
          }
          onKeyDown?.(e)
        }}
        autoComplete="off"
        spellCheck={false}
        {...props}
        className="h-10 w-full rounded-lg bg-sunken pr-10 pl-9 text-base text-ink outline-none placeholder:text-faint focus-visible:shadow-[inset_0_0_0_1px_var(--mute)] pointer-fine:text-[14px] [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onValueChange('')
            input.current?.focus()
          }}
          aria-label="Clear"
          className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-md text-faint hover:text-ink pointer-coarse:size-11"
        >
          <XIcon className="size-4" aria-hidden />
        </button>
      )}
    </div>
  )
}

/**
 * Tabs that behave like tabs (Radix): ←/→ move between them (Home/End to the
 * ends), only the selected tab is in the Tab order, and each tab labels its
 * panel. Controlled with `value` + `onValueChange` (keep it in the URL).
 * 40px tall to point at, 44px on touch; the selected tab is ink with a 2px
 * rule, unselected ones are muted, and weight never changes.
 *
 *   <Tabs value={tab} onValueChange={setTab}>
 *     <TabList label="Topic views"><Tab value="chat">Chat</Tab><Tab value="files">Files</Tab></TabList>
 *     <TabPanel value="chat">…</TabPanel>
 *   </Tabs>
 */
export function Tabs<V extends string>({ value, onValueChange, children, className }: { value: V; onValueChange: (value: V) => void; children: ReactNode; className?: string }) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={(v) => onValueChange(v as V)} className={cn('flex min-h-0 min-w-0 flex-col', className)}>
      {children}
    </TabsPrimitive.Root>
  )
}

export function TabList({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <TabsPrimitive.List aria-label={label} className={cn('flex min-w-0 shrink-0 items-stretch gap-1', className)}>
      {children}
    </TabsPrimitive.List>
  )
}

export function Tab({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return (
    <TabsPrimitive.Trigger
      value={value}
      className={cn(
        'relative inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-[13.5px] font-medium text-mute outline-none transition-[color,background-color] duration-150 ease-out hover:text-ink focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:text-ink pointer-coarse:h-11',
        "after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent after:content-[''] data-[state=active]:after:bg-ink",
        className,
      )}
    >
      {children}
    </TabsPrimitive.Trigger>
  )
}

export function TabPanel({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return (
    <TabsPrimitive.Content value={value} tabIndex={-1} className={cn('flex min-h-0 min-w-0 flex-1 flex-col outline-none', className)}>
      {children}
    </TabsPrimitive.Content>
  )
}

/** "Show all / Show less" inside content (a clamped memory, a folded message,
 * a long prompt, AGENTS.md): one look everywhere, accent text, a neutral
 * focus ring, a 40px hit area on desktop (44px on touch) around a small label.
 * Pass aria-controls for the region it opens. */
export function DisclosureButton({ open, className, children, ...rest }: ComponentProps<'button'> & { open: boolean }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      {...rest}
      className={cn(
        "relative self-start rounded-sm text-[13px] font-medium text-accent-strong outline-none before:absolute before:-inset-x-2 before:-inset-y-3 before:content-[''] hover:underline hover:underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-pane pointer-coarse:before:-inset-y-3.5",
        className,
      )}
    >
      {children}
    </button>
  )
}
