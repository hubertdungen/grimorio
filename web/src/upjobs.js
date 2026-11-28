// ⤢ Ampliações em segundo plano: a janela da arte pode fechar a meio (e pode abrir-se outro deck); a ampliação continua
// aqui, ao nível da página, e no fim a imagem ampliada vai para a carta certa do deck certo (onDone). Um aviso pequeno
// no canto (UpscaleJobs, no App) mostra o progresso enquanto a janela está fechada.
import { useSyncExternalStore } from 'react'

const jobs = new Map()  // chave (deck + carta) -> { key, label, scale, f, ep, err, done }
const subs = new Set()
let snap = []
const emit = () => { snap = [...jobs.values()].map(j => ({ ...j })); subs.forEach(f => f()) }
const subscribe = f => { subs.add(f); return () => subs.delete(f) }

export const useUpJobs = () => useSyncExternalStore(subscribe, () => snap)
export const upJob = key => snap.find(j => j.key === key) || null

// work(onProgress) -> url da imagem ampliada já guardada; onDone(url) aplica-a (deck aberto ou gravado no servidor)
export function startUpscale({ key, label, scale, work, onDone, onError }) {
  if (jobs.get(key) && !jobs.get(key).done && !jobs.get(key).err) return
  const j = { key, label, scale, f: 0, ep: '', err: '', done: false }
  jobs.set(key, j); emit()
  ;(async () => {
    try {
      const url = await work((f, ep) => { j.f = f; j.ep = ep; emit() })
      await onDone(url)
      j.done = true
    } catch (e) { j.err = e.message || String(e); onError?.(j.err) }
    emit()
    setTimeout(() => { if (jobs.get(key) === j) { jobs.delete(key); emit() } }, j.err ? 12000 : 5000)
  })()
}
