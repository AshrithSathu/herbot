// Stage 3 page prototype: a topic's files. Throwaway (emil-prototype);
// nothing in production links here.
import { createFileRoute } from '@tanstack/react-router'
import { Prototype } from '@/proto/picker'
import { SectionVariant } from '@/proto/pages/files/section'
import { BrowserVariant } from '@/proto/pages/files/browser'
import { GalleryVariant } from '@/proto/pages/files/gallery'

export const Route = createFileRoute('/_authed/proto/page-files')({
  staticData: { crumb: 'Files page prototype' },
  head: () => ({ meta: [{ title: 'Files page · prototype' }] }),
  component: () => (
    <Prototype
      position="top"
      variants={[
        { name: 'In details', render: () => <SectionVariant /> },
        { name: 'Browser', render: () => <BrowserVariant /> },
        { name: 'Gallery', render: () => <GalleryVariant /> },
      ]}
    />
  ),
})
