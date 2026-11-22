// Ampliar imagens ×2/×4 no próprio browser (sem servidor, sem internet): Real-ESRGAN «realesr-general-x4v3», o motor do
// Upscayl (BSD-3-Clause, models/LICENSE-Real-ESRGAN.txt), no ONNX Runtime Web — WebGPU quando há, senão WASM (CPU).
// O runtime e o modelo (4,9 MB) só se carregam ao primeiro uso. A imagem vai em ladrilhos com margem, para a memória
// não crescer com o tamanho da imagem e não se verem costuras.

// ladrilhos de t×t px que cobrem w×h; cada um lê mais `pad` px à volta (sx, sy, sw, sh) e só aproveita o centro (x, y, w, h)
export function tileGrid(w, h, t, pad) {
  const out = []
  for (let y = 0; y < h; y += t) {
    for (let x = 0; x < w; x += t) {
      const tw = Math.min(t, w - x), th = Math.min(t, h - y), sx = Math.max(0, x - pad), sy = Math.max(0, y - pad)
      out.push({ x, y, w: tw, h: th, sx, sy, sw: Math.min(w, x + tw + pad) - sx, sh: Math.min(h, y + th + pad) - sy })
    }
  }
  return out
}

export const MAX_OUT = 40e6  // píxeis da imagem ampliada (~160 MB de memória)

// src: Blob ou ImageBitmap; scale 2 ou 4; onProgress(0..1, motor). Devolve um canvas. A rede corre num worker
// (upscale.worker.js): a página continua a responder; aqui só se partem e se colam os ladrilhos.
export async function upscale(src, scale, onProgress) {
  const bmp = src instanceof Blob ? await createImageBitmap(src) : src
  const W = bmp.width, H = bmp.height
  if (W * H * scale * scale > MAX_OUT) throw new Error('grande')
  const inp = document.createElement('canvas'); inp.width = W; inp.height = H
  const ig = inp.getContext('2d', { willReadFrequently: true }); ig.drawImage(bmp, 0, 0)
  const px = ig.getImageData(0, 0, W, H).data
  let alpha = false
  for (let i = 3; i < px.length && !alpha; i += 4) alpha = px[i] < 255
  const out = document.createElement('canvas'); out.width = W * scale; out.height = H * scale
  const og = out.getContext('2d'); og.imageSmoothingQuality = 'high'
  const tc = document.createElement('canvas'), tg = tc.getContext('2d')
  const { default: model } = await import('./models/realesr-general-x4v3.onnx?url')  // vai para assets/ com hash (cache para sempre)
  const wk = new Worker(new URL('./upscale.worker.js', import.meta.url), { type: 'module' })
  try {
    await new Promise((ok, fail) => {
      wk.onerror = e => fail(new Error(e.message || 'worker'))
      wk.onmessage = ({ data: m }) => {
        if (m.err) return fail(new Error(m.err))
        if (m.done) return ok()
        const { g } = m, ow = g.sw * 4, oh = g.sh * 4
        tc.width = ow; tc.height = oh; tg.putImageData(new ImageData(m.rgba, ow, oh), 0, 0)
        og.drawImage(tc, (g.x - g.sx) * 4, (g.y - g.sy) * 4, g.w * 4, g.h * 4, g.x * scale, g.y * scale, g.w * scale, g.h * scale)
        onProgress?.(m.k / m.n, m.ep)
      }
      wk.postMessage({ model: new URL(model, location.href).href, px, W, H }, [px.buffer])
    })
  } finally { wk.terminate() }
  if (alpha) { og.globalCompositeOperation = 'destination-in'; og.drawImage(bmp, 0, 0, out.width, out.height); og.globalCompositeOperation = 'source-over' }  // o modelo é só RGB: o alfa vem esticado do original
  return out
}

export function selfcheck(assert) {
  for (const [w, h, t, p] of [[745, 1040, 128, 12], [100, 50, 128, 12], [257, 256, 256, 12]]) {
    const g = tileGrid(w, h, t, p)
    assert.equal(g.reduce((a, x) => a + x.w * x.h, 0), w * h, 'os ladrilhos cobrem a imagem uma só vez')
    for (const x of g) assert.ok(x.sx >= 0 && x.sy >= 0 && x.sx + x.sw <= w && x.sy + x.sh <= h && x.sx <= x.x && x.sx + x.sw >= x.x + x.w && x.sw <= t + 2 * p)
  }
  assert.equal(tileGrid(745, 1040, 128, 12).length, 6 * 9)
}
