// After `vite build`: writes .br and .gz next to each built asset, at the
// highest settings, so the server sends them without compressing per request.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

const dir = new URL('../dist/client/assets/', import.meta.url)
const TEXT = /\.(js|css|svg|json|txt|html)$/

let before = 0
let after = 0
for (const name of await readdir(dir)) {
  if (!TEXT.test(name)) continue
  const path = join(dir.pathname, name)
  const raw = await readFile(path)
  if (raw.length < 1024) continue
  const br = brotliCompressSync(raw, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
      [constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
    },
  })
  const gz = gzipSync(raw, { level: constants.Z_BEST_COMPRESSION })
  if (br.length < raw.length) await writeFile(`${path}.br`, br)
  if (gz.length < raw.length) await writeFile(`${path}.gz`, gz)
  before += raw.length
  after += Math.min(br.length, raw.length)
}
const kb = (n) => `${Math.round(n / 1024)} KB`
console.log(`precompressed assets: ${kb(before)} → ${kb(after)} (brotli)`)
