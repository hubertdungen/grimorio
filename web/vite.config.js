import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

// OCR das fotos de cartas (CardScan.jsx): o tesseract.js é servido pela própria app (worker, motor wasm e o modelo de
// inglês), para funcionar sem internet e sem CDNs. O modelo vai já descomprimido (o servidor pode comprimir por cima).
const nm = p => new URL(`./node_modules/${p}`, import.meta.url)
const OCR = {
  'ocr/worker.min.js': () => readFileSync(nm('tesseract.js/dist/worker.min.js')),
  'ocr/tesseract-core-lstm.wasm.js': () => readFileSync(nm('tesseract.js-core/tesseract-core-lstm.wasm.js')),
  'ocr/tesseract-core-simd-lstm.wasm.js': () => readFileSync(nm('tesseract.js-core/tesseract-core-simd-lstm.wasm.js')),
  'ocr/tesseract-core-relaxedsimd-lstm.wasm.js': () => readFileSync(nm('tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js')),
  'ocr/eng.traineddata': () => gunzipSync(readFileSync(nm('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'))),
}
const ocrAssets = () => ({
  name: 'ocr-assets',
  configureServer(s) {
    s.middlewares.use((rq, rs, next) => {
      const k = rq.url.split('?')[0].replace(/^.*?(ocr\/)/, '$1')
      if (!OCR[k]) return next()
      rs.setHeader('Content-Type', k.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); rs.end(OCR[k]())
    })
  },
  generateBundle() { for (const [k, f] of Object.entries(OCR)) this.emitFile({ type: 'asset', fileName: k, source: f() }) },
})

// Em dev, /api e /data vão para o servidor Python (porta 8107).
export default defineConfig({
  plugins: [react(), ocrAssets()],
  base: './',
  server: { proxy: { '/api': 'http://127.0.0.1:8107', '/data': 'http://127.0.0.1:8107' } },
})
