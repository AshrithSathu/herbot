// Throwaway prototype route (emil-prototype): three directions for the
// message composer, under real conversation context. Deleted when the
// redesign ships.
import { createFileRoute } from '@tanstack/react-router'
import { Prototype } from '../../../proto/picker'
import { ChipsVariant } from '../../../proto/composer/chips'
import { MenuVariant } from '../../../proto/composer/menu'
import { SlashVariant } from '../../../proto/composer/slash'

export const Route = createFileRoute('/_authed/proto/composer')({
  staticData: { crumb: 'Composer prototype' },
  head: () => ({ meta: [{ title: 'Composer prototype · Herbot admin' }] }),
  component: () => (
    <Prototype
      position="top"
      variants={[
        { name: 'Chips', render: () => <ChipsVariant /> },
        { name: 'Menu', render: () => <MenuVariant /> },
        { name: 'Slash', render: () => <SlashVariant /> },
      ]}
    />
  ),
})
