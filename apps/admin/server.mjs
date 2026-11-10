// The panel in production, on Bun: `bun run build`, then `bun run start` runs this.
//
// srvx's own CLI would serve it too, but it sends the hashed assets with no
// cache lifetime (so every page view revalidates each one), recompresses them
// on every request, and leaves pages and data uncompressed. Here:
// - /assets/* (content-hashed names) are cached for a year, never
//   revalidated, and served from the .br/.gz files made at build time;
// - pages and server-function data are compressed as they stream out.
import { pipeline } from 'node:stream'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { constants, createBrotliCompress, createGzip } from 'node:zlib'
import { serve } from 'srvx'
import { staticMiddleware } from 'srvx/static'
import app from './dist/server/server.js'

const client = fileURLToPath(new URL('./dist/client/', import.meta.url))
const YEAR = 365 * 24 * 60 * 60

const assets = staticMiddleware({ dir: client, encodings: true, maxAge: YEAR, immutable: true })
// The rest of public/ (the favicon) keeps its name across deploys.
const files = staticMiddleware({ dir: client, maxAge: 60 * 60 })

// HTML, JSON and TanStack Start's framed (streamed) server-function data.
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|x-tss-framed)|image\/svg\+xml)/
const MIN_BYTES = 1024

function encodingFor(request) {
  const accepted = request.headers.get('accept-encoding') ?? ''
  if (/\bbr\b/.test(accepted)) return 'br'
  if (/\bgzip\b/.test(accepted)) return 'gzip'
  return null
}

/** Compresses a dynamic response on the way out. Each chunk is flushed as it
 * comes, so a streamed page still arrives in pieces. */
function compress(request, response) {
  const type = response.headers.get('content-type') ?? ''
  const length = Number(response.headers.get('content-length') ?? Number.NaN)
  const encoding = encodingFor(request)
  if (
    !response.body ||
    request.method === 'HEAD' ||
    !encoding ||
    response.headers.has('content-encoding') ||
    !COMPRESSIBLE.test(type) ||
    length < MIN_BYTES // unknown length (a stream) is compressed
  ) {
    return response
  }
  const zip =
    encoding === 'br'
      ? createBrotliCompress({
          flush: constants.BROTLI_OPERATION_FLUSH,
          params: { [constants.BROTLI_PARAM_QUALITY]: 5 },
        })
      : createGzip({ flush: constants.Z_SYNC_FLUSH })
  pipeline(Readable.fromWeb(response.body), zip, () => {}) // errors end the body
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  headers.set('content-encoding', encoding)
  headers.append('vary', 'Accept-Encoding')
  return new Response(Readable.toWeb(zip), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

serve({
  hostname: '127.0.0.1', // private: put Tailscale (or a proxy) in front
  port: Number(process.env.HERBOT_ADMIN_PORT ?? 3300),
  middleware: [
    (request, next) => {
      const path = new URL(request.url).pathname
      if (path.startsWith('/assets/')) return assets(request, next)
      if (/\.[a-z0-9]+$/i.test(path)) return files(request, next)
      return next() // pages: no disk lookups
    },
  ],
  fetch: async (request) => compress(request, await app.fetch(request)),
})
