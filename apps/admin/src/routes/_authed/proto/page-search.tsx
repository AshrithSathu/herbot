// Throwaway page prototype (emil-prototype): three layouts for Search, built
// from components/hb on stress data. Deleted with src/proto.
import { createFileRoute } from '@tanstack/react-router'
import { Prototype } from '@/proto/picker'
import { FlatVariant } from '@/proto/pages/search/flat'
import { GroupedVariant } from '@/proto/pages/search/grouped'
import { PaletteVariant } from '@/proto/pages/search/palette'

export const Route = createFileRoute('/_authed/proto/page-search')({
  staticData: { crumb: 'Search prototype' },
  head: () => ({ meta: [{ title: 'Search prototype · Herbot admin' }] }),
  component: () => (
    <Prototype
      position="top"
      variants={[
        { name: 'By topic', render: () => <GroupedVariant /> },
        { name: 'Flat', render: () => <FlatVariant /> },
        { name: 'Palette', render: () => <PaletteVariant /> },
      ]}
    />
  ),
})
