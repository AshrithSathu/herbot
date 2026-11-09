import { useQuery } from '@tanstack/react-query'
import { getFiles } from '../api'
import { FilePreview } from './rich-message'
import { EmptyState, ErrorNote } from '../ui'
export function TopicFiles({ id }: { id: number }) {
  const query = useQuery({
    queryKey: ['files', id],
    queryFn: () => getFiles({ data: id }),
    refetchInterval: 10000,
  })
  if (query.isPending) return <p role="status">Loading files…</p>
  if (query.isError) return <ErrorNote title="Couldn’t load files">{query.error.message}</ErrorNote>
  return query.data.length ? (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {query.data.map((f) => (
        <FilePreview key={f.path} file={f} />
      ))}
    </div>
  ) : (
    <EmptyState title="Your agent’s workspace">Files you send and files the agent creates will appear here.</EmptyState>
  )
}
