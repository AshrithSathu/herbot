import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { login } from '../api'
import { keys, sessionQuery } from '../queries'
import { ErrorNote } from '../ui'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

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
  const [password, setPassword] = useState('')

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
  const wrong = signIn.data && !signIn.data.ok ? signIn.data.error : null

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-12">
      <div className="flex flex-col items-center gap-3 text-center">
        <img src="/favicon.svg" alt="" width={40} height={40} className="size-10 rounded-xl" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Herbot admin</h1>
          <p className="text-sm text-muted-foreground">Only you can sign in here.</p>
        </div>
      </div>
      <Card className="py-5 shadow-xs">
        <CardContent className="px-5">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (password && !signIn.isPending) signIn.mutate(password)
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                ref={input}
                id="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={wrong ? true : undefined}
                aria-describedby={wrong ? 'password-error' : undefined}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  if (wrong) signIn.reset()
                }}
              />
              {wrong && (
                <p id="password-error" className="text-sm text-destructive">
                  {wrong} Try again.
                </p>
              )}
            </div>
            {signIn.isError && <ErrorNote title="Couldn’t sign in">{signIn.error.message}</ErrorNote>}
            <Button type="submit" className="w-full" disabled={signIn.isPending || !password}>
              {signIn.isPending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
