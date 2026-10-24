/* global require, process */
// Verificação dos sons em Chromium headless: cd web && python3 -m http.server 8931 & node sfx-check.cjs http://127.0.0.1:8931
// (sem erros na consola, cada som toca, picos abaixo de 1, limite de ritmo e playEvent a funcionar)
const { chromium } = require('/home/hubert/Lectoria/node_modules/playwright-core')
;(async () => {
  const b = await chromium.launch({ executablePath: '/home/hubert/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell', args: ['--autoplay-policy=no-user-gesture-required'] })
  const p = await b.newPage(), errs = []
  p.on('pageerror', e => errs.push('pageerror: ' + e.message))
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()) })
  await p.goto(process.argv[2] + '/sfx-demo.html')
  await p.mouse.click(5, 5)
  await p.waitForTimeout(300)
  const r = await p.evaluate(async () => {
    const m = await import('/src/sfx.js')
    const out = { plays: {}, levels: {}, events: {} }
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    // cada som em direto (espera entre eles para não bater no limite)
    for (const k of m.kinds) { out.plays[k] = m.play(k, { amount: 4, side: 'b', colour: 'R', type: 'Creature' }); await sleep(k.match(/win|loss|tie|turn|match|champion|eliminated/) ? 1250 : 130) }
    for (const c of ['W', 'U', 'B', 'R', 'G', 'WU', '']) for (const t of ['Creature', 'Instant', 'Artifact', 'Enchantment', 'Planeswalker']) { m.play('cast', { colour: c, type: t }); await sleep(110) }
    // offline: pico e duração reais
    for (const k of m.kinds) {
      const worst = []
      for (const o of k === 'cast' ? ['W', 'U', 'B', 'R', 'G', 'WU', ''].flatMap(c => ['Creature', 'Instant', 'Planeswalker', 'Artifact', 'Enchantment'].map(t => ({ colour: c, type: t }))) : [{ amount: 1 }, { amount: 10 }]) {
        const { buffer, dur } = await m.render(k, { ...o, side: 'b' })
        let peak = 0, end = 0
        for (let ch = 0; ch < 2; ch++) { const d = buffer.getChannelData(ch); for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; if (a > 1e-3 && i > end) end = i } }
        worst.push({ peak, real: end / buffer.sampleRate, dur })
      }
      out.levels[k] = { peak: Math.max(...worst.map(x => x.peak)).toFixed(3), real: Math.max(...worst.map(x => x.real)).toFixed(2), dur: Math.max(...worst.map(x => x.dur)) }
    }
    // limite de ritmo: 20 taps seguidos → 1; 20 sons diferentes → 3
    await sleep(200)
    let n = 0; for (let i = 0; i < 20; i++) n += m.play('tap'); out.rateSame = n
    await sleep(200)
    n = 0; for (const k of ['draw', 'land', 'cast', 'attack', 'block', 'exile', 'bounce']) n += m.play(k); out.rateMixed = n
    // playEvent
    await sleep(1300)
    const data = { byName: new Map([['Lightning Bolt', { co: 'R', t: 'Instant' }]]) }
    const evs = [
      [{ k: 'cast', p: 'a', card: 'Lightning Bolt' }, null, 1], [{ k: 'damage', p: 'a', target: 'b', n: 3 }, null, 1],
      [{ k: 'life', p: 'b', n: 17 }, { fx: { life: { p: 'b', d: -3 } } }, 1], [{ k: 'life', p: 'a', n: 23 }, { fx: { life: { p: 'a', d: 3 } } }, 1],
      [{ k: 'tap', p: 'a' }, null, 8], [{ k: 'phase', ph: 'main1' }, null, 1], [{ k: 'phase', ph: 'combat', p: 'a' }, null, 1],
      [{ k: 'outcome', p: 'a', txt: 'x has won' }, { sides: ['a', 'b'] }, 1],
    ]
    for (const [ev, s, speed] of evs) { out.events[ev.k + (ev.ph || '') + (speed > 1 ? '@8' : '') + (ev.n ?? '')] = m.playEvent(ev, s, data, { speed }); await sleep(150) }
    m.setVolume(0.3); m.setEnabled(false); out.offPlay = m.play('click'); m.setEnabled(true)
    out.saved = localStorage.getItem('grimorio.sfx')
    return out
  })
  console.log(JSON.stringify(r, null, 1)); console.log('ERRORS:', errs)
  await b.close()
  const bad = [...errs, ...Object.entries(r.plays).filter(([, v]) => !v).map(([k]) => `não tocou: ${k}`),
    ...Object.entries(r.levels).filter(([, v]) => +v.peak >= 0.99).map(([k, v]) => `satura: ${k} ${v.peak}`),
    ...(r.rateSame === 1 && r.rateMixed === 3 ? [] : ['limite de ritmo']), ...(r.offPlay ? ['toca desligado'] : [])]
  console.log(bad.length ? `FALHOU: ${bad.join('; ')}` : 'OK')
  process.exit(bad.length ? 1 : 0)
})()
