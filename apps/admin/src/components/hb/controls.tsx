// The "Quiet" control kit (docs/design/DECISIONS.md, "Form controls"):
// segmented choices with the chosen option's description underneath (a menu
// on phones), light buttons, labels above fields, destructive actions as
// quiet red text that always confirm elsewhere.
import { useId, type ComponentProps, type ReactNode } from 'react'
import { Slot } from 'radix-ui'
import { cva, type VariantProps } from 'class-variance-authority'
import { ChevronDownIcon, LoaderIcon } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

const button = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg text-[14px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow,scale] duration-150 ease-out outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-pane active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-accent-strong text-accent-ink hover:bg-[color-mix(in_oklch,var(--accent-strong)_88%,black)]',
        secondary: 'bg-sunken text-ink shadow-[inset_0_0_0_var(--hair)_var(--line)] hover:bg-[color-mix(in_oklch,var(--sunken)_92%,var(--ink))]',
        ghost: 'text-mute hover:bg-sunken hover:text-ink',
        /** Quiet red text: the action is always confirmed in a dialog. */
        danger: 'text-destructive hover:bg-destructive-soft',
      },
      size: {
        sm: 'h-8 px-2.5 pointer-coarse:h-11',
        md: 'h-9 px-3.5 pointer-coarse:h-11',
        icon: 'size-9 pointer-coarse:size-11',
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
  /** Code-point count against a limit, shown near the limit. */
  counter?: { count: number; max: number }
  children: (props: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode
  className?: string
}

/** Label above, the control, then the error or hint next to it. */
export function Field({ label, id, hint, error, counter, children, className }: FieldProps) {
  const auto = useId()
  const fieldId = id ?? auto
  const noteId = `${fieldId}-note`
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
      {children({ id: fieldId, 'aria-invalid': error ? true : undefined, 'aria-describedby': error || hint ? noteId : undefined })}
      {(error || hint) && (
        <p id={noteId} className={cn('text-[12.5px]', error ? 'text-destructive' : 'text-mute')}>
          {error ?? hint}
        </p>
      )}
    </div>
  )
}

const control =
  'w-full min-w-0 rounded-lg bg-sunken px-3 text-base text-ink shadow-[inset_0_0_0_var(--hair)_var(--line)] outline-none transition-[box-shadow] duration-150 ease-out placeholder:text-faint focus-visible:shadow-[inset_0_0_0_1px_var(--mute)] aria-invalid:shadow-[inset_0_0_0_1px_var(--destructive)] disabled:opacity-60 md:text-[14px]'

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
 * Below `md` it becomes a native select (the phone's own picker): five
 * segments don't fit a phone. */
export function Segmented<V extends string>({ label, value, options, onValueChange, disabled, className }: SegmentedProps<V>) {
  const id = useId()
  const current = options.find((o) => o.value === value)
  const index = options.findIndex((o) => o.value === value)
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <span id={`${id}-label`} className="text-[13px] font-medium text-ink">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        aria-describedby={current?.hint ? `${id}-hint` : undefined}
        className="hidden min-w-0 rounded-lg bg-sunken p-0.5 shadow-[inset_0_0_0_var(--hair)_var(--line)] md:flex"
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
                'h-8 min-w-0 flex-1 truncate rounded-md px-2 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring',
                on ? 'bg-pane text-ink shadow-raised' : 'text-mute hover:text-ink',
              )}
            >
              {o.label}
            </button>
          )
        })}
      </div>
      <div className="relative md:hidden">
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
