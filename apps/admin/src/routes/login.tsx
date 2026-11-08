import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { login } from '../api'
import { keys, sessionQuery } from '../queries'
import { ErrorNote } from '../ui'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

export const Route = createFileRoute('/login')({
  beforeLoad: async ({ context }) => {
    const { signedIn } = await context.queryClient.fetchQuery({ ...sessionQuery, staleTime: 0 })
    if (signedIn) throw redirect({ to: '/' })
  },
  head: () => ({ meta: [{ title: 'Sign in · Herbot admin' }] }),
  component: Login,
})

function Login() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  // Uncontrolled on purpose: whatever was typed before the page finished
  // loading (hydrating) is kept, and read from the form on submit.
  const [missing, setMissing] = useState(false)

  // Focus the field for mouse and keyboard users; on a phone, don't pop the
  // keyboard up before they've seen the page.
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) input.current?.focus()
  }, [])

  const signIn = useMutation({
    mutationFn: (pw: string) => login({ data: { password: pw } }),
    onSuccess: async (result) => {
      if (!result.ok) {
        input.current?.select()
        return
      }
      queryClient.setQueryData(keys.session, { signedIn: true })
      await router.navigate({ to: '/' })
    },
  })
  const wrong = signIn.data && !signIn.data.ok ? `${signIn.data.error} Try again.` : null
  const problem = missing ? 'Enter your password.' : wrong

  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/40 px-4 py-12">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <img src="/favicon.svg" alt="" width={40} height={40} className="size-10 rounded-xl" />
        <Card className="w-full shadow-sm">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">
              <h1>Herbot admin</h1>
            </CardTitle>
            <CardDescription>Only you can sign in here.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (signIn.isPending) return
                const password = String(new FormData(e.currentTarget).get('password') ?? '')
                if (!password) {
                  setMissing(true)
                  input.current?.focus()
                  return
                }
                signIn.mutate(password)
              }}
            >
              <FieldGroup>
                <Field data-invalid={problem ? true : undefined}>
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  <Input
                    ref={input}
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    name="password"
                    aria-invalid={problem ? true : undefined}
                    aria-describedby={problem ? 'password-error' : undefined}
                    onChange={() => {
                      setMissing(false)
                      if (wrong) signIn.reset()
                    }}
                  />
                  {problem && <FieldError id="password-error">{problem}</FieldError>}
                </Field>
                {signIn.isError && <ErrorNote title="Couldn’t sign in">{signIn.error.message}</ErrorNote>}
                <Field>
                  <Button type="submit" className="w-full" disabled={signIn.isPending}>
                    {signIn.isPending && <Spinner />}
                    {signIn.isPending ? 'Signing in…' : 'Sign in'}
                  </Button>
                </Field>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
