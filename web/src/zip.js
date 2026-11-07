// .zip sem bibliotecas: escrever guarda os ficheiros sem compressão (listas de texto, pequenas); ler aceita «guardado» e
// «deflate» (o que as outras apps fazem) pelo DecompressionStream do browser. Chega para listas de decks.
const enc = new TextEncoder()
let CRC
const crc32 = b => {
  CRC ??= Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  let c = 0xffffffff
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// files: [{ name, text }] -> Uint8Array do .zip
export function makeZip(files) {
  const parts = [], cen = []
  let off = 0
  for (const f of files) {
    const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data)
    const h = new DataView(new ArrayBuffer(30))
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true)  // 0x0800: nomes em UTF-8
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true)
    parts.push(new Uint8Array(h.buffer), name, data)
    const c = new DataView(new ArrayBuffer(46))
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true)
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true)
    cen.push(new Uint8Array(c.buffer), name)
    off += 30 + name.length + data.length
  }
  const size = cen.reduce((a, x) => a + x.length, 0), e = new DataView(new ArrayBuffer(22))
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true)
  const all = [...parts, ...cen, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((a, x) => a + x.length, 0))
  let p = 0
  for (const x of all) { out.set(x, p); p += x.length }
  return out
}

// ArrayBuffer de um .zip -> [{ name, text }] (só os ficheiros; pastas e o que não se consegue ler ficam de fora)
export async function readZip(buf) {
  const v = new DataView(buf), u8 = new Uint8Array(buf), dec = new TextDecoder()
  let e = -1
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { e = i; break }
  if (e < 0) throw new Error('zip')
  const n = v.getUint16(e + 10, true), out = []
  let p = v.getUint32(e + 16, true)
  for (let k = 0; k < n; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) break
    const meth = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lo = v.getUint32(p + 42, true)
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl))
    p += 46 + nl + xl + cl
    if (name.endsWith('/')) continue
    const start = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true), raw = u8.subarray(start, start + csize)
    try {
      if (meth === 0) out.push({ name, text: dec.decode(raw) })
      else if (meth === 8 && typeof DecompressionStream !== 'undefined') out.push({ name, text: await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text() })
    } catch { /* um ficheiro estragado não impede os outros */ }
  }
  return out
}
