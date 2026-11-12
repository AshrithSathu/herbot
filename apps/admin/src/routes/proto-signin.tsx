// Throwaway (emil-prototype, Stage 3): the sign-in page, two layouts.
// Outside _authed so it renders without the shell; it never redirects, so it
// can be judged while signed in. Submitting calls the real login.
import { createFileRoute } from '@tanstack/react-router'
import { Prototype } from '@/proto/picker'
import { Card, Split } from '@/proto/pages/signin/variants'

export const Route = createFileRoute('/proto-signin')({
  head: () => ({ meta: [{ title: 'Sign-in prototype · Herbot admin' }] }),
  component: () => (
    <Prototype
      variants={[
        { name: 'Card', render: () => <Card /> },
        { name: 'Split', render: () => <Split /> },
      ]}
    />
  ),
})
