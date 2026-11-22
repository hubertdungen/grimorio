// Real-ESRGAN num worker (upscale.js): recebe a imagem RGBA, devolve ladrilho a ladrilho ×4 em RGBA.
import * as ort from 'onnxruntime-web/webgpu'
import { tileGrid } from './upscale.js'

self.onmessage = async ({ data: { model, px, W, H } }) => {
  try {
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1
    const buf = new Uint8Array(await (await fetch(model)).arrayBuffer())
    let s = null, ep = ''
    for (ep of navigator.gpu ? ['webgpu', 'wasm'] : ['wasm']) {
      try { s = await ort.InferenceSession.create(buf, { executionProviders: [ep] }); break } catch (e) { if (ep === 'wasm') throw e }
    }
    const tiles = tileGrid(W, H, ep === 'webgpu' ? 256 : 128, 12)
    for (const [k, g] of tiles.entries()) {
      const n = g.sw * g.sh, f = new Float32Array(3 * n)
      for (let y = 0; y < g.sh; y++) {
        for (let x = 0; x < g.sw; x++) {
          const i = ((g.sy + y) * W + g.sx + x) * 4, j = y * g.sw + x
          f[j] = px[i] / 255; f[n + j] = px[i + 1] / 255; f[2 * n + j] = px[i + 2] / 255
        }
      }
      const r = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', f, [1, 3, g.sh, g.sw]) })
      const o = r[s.outputNames[0]], d = o.data, m = g.sw * 4 * g.sh * 4, rgba = new Uint8ClampedArray(m * 4)
      for (let j = 0; j < m; j++) { const q = j * 4; rgba[q] = d[j] * 255; rgba[q + 1] = d[m + j] * 255; rgba[q + 2] = d[2 * m + j] * 255; rgba[q + 3] = 255 }
      o.dispose?.()
      self.postMessage({ k: k + 1, n: tiles.length, ep, g, rgba }, [rgba.buffer])
    }
    await s.release?.()
    self.postMessage({ done: true })
  } catch (e) { self.postMessage({ err: String(e?.message || e) }) }
}
