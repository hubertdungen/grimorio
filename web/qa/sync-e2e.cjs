// E2E: dois Grimórios (9061 = «servidor», 9062 = «portátil»), assistente no portátil -> «Ligar ao meu servidor» com o link
// do 9061 -> criar/editar/apagar decks nos dois -> sincronizar -> convergem; 9061 desliga -> o portátil continua sem rede ->
// 9061 volta -> convergem. Capturas do assistente e de Definições › Dados (1440×900 e 390×844).
// Correr: node web/qa/sync-e2e.cjs (PLAYWRIGHT=<módulo playwright-core>, CHROME=<executável>, GRIMORIO_CARDS=<pasta data com as
// cartas>, QA_DIR=<pasta temporária>). Usa as portas 9061 e 9062 e pastas de dados novas (nunca as tuas).
const os = require('os')
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright-core')
const { spawn } = require('child_process')
const fs = require('fs'), path = require('path')
const WT = path.resolve(__dirname, '..', '..')
const ROOT = path.join(process.env.QA_DIR || os.tmpdir(), 'grimorio-sync-e2e')
const SHOTS = path.join(process.env.QA_DIR || os.tmpdir(), 'grimorio-sync-shots')
const CARDS = process.env.GRIMORIO_CARDS || path.join(os.homedir(), '.local/share/grimorio/data')  // só os dados das cartas (leitura), nunca a base do utilizador
const S = 'http://127.0.0.1:9061', L = 'http://127.0.0.1:9062'
const procs = {}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const ok = (c, m) => { if (!c) throw new Error('FALHOU: ' + m); console.log('✓', m) }

function start(name, port) {
  const d = path.join(ROOT, name)
  fs.mkdirSync(d, { recursive: true })
  if (!fs.existsSync(path.join(d, 'data'))) fs.symlinkSync(CARDS, path.join(d, 'data'))
  const p = spawn('python3', [path.join(WT, 'server.py'), '--host', '127.0.0.1', '--port', String(port), '--data-dir', d],
    { env: { ...process.env, GRIMORIO_OWNER: '' }, stdio: ['ignore', fs.openSync(path.join(ROOT, name + '.log'), 'a'), fs.openSync(path.join(ROOT, name + '.log'), 'a')] })
  procs[name] = p
}
async function up(base) { for (let i = 0; i < 100; i++) { try { const r = await fetch(base + '/api/profiles'); if (r.ok) return } catch { /* ainda não */ } await sleep(150) } throw new Error('não arrancou ' + base) }
const stop = name => new Promise(r => { const p = procs[name]; if (!p || p.exitCode !== null) return r(); p.once('exit', r); p.kill('SIGTERM') })

// pedidos de dentro da página (com o cookie do perfil)
const api = (page, url, method = 'GET', body) => page.evaluate(async ([url, method, body]) => {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, j: await r.json().catch(() => null) }
}, [url, method, body])
const names = async page => (await api(page, '/api/decks')).j.map(d => d.name).sort()

async function main() {
  fs.rmSync(ROOT, { recursive: true, force: true })
  fs.mkdirSync(SHOTS, { recursive: true })
  start('server', 9061); start('laptop', 9062)
  await up(S); await up(L)
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {})
  const mk = async (vp, lang = 'pt') => {
    const ctx = await browser.newContext({ viewport: vp, serviceWorkers: 'block', deviceScaleFactor: 1, isMobile: vp.width < 500, hasTouch: vp.width < 500 })
    await ctx.route(/scryfall\.io/, r => r.abort())
    await ctx.addInitScript(l => { try { localStorage.setItem('grimorio.lang', l) } catch { /* */ } }, lang)
    const page = await ctx.newPage()
    page.on('pageerror', e => console.log('  [pageerror]', e.message))
    return { ctx, page }
  }
  const D = { width: 1440, height: 900 }, P = { width: 390, height: 844 }
  try {
    // ---- servidor (9061): perfil, assistente -> «Só neste aparelho» ----
    const s = await mk(D)
    await s.ctx.request.post(S + '/api/profiles', { data: { name: 'Hubert' } })  // o perfil (cookie no contexto do browser)
    await s.page.goto(S + '/')
    const wiz = s.page.getByRole('dialog', { name: 'Onde ficam os teus dados?' })
    await wiz.waitFor({ timeout: 20000 })
    ok(await s.page.getByRole('radio', { name: /Só neste aparelho/ }).getAttribute('aria-checked') === 'true', 'assistente: «Só neste aparelho» vem escolhido por omissão')
    await s.page.screenshot({ path: path.join(SHOTS, 'wizard-desktop.png') })
    await s.page.getByRole('radio', { name: /pasta na nuvem/ }).click()
    await s.page.screenshot({ path: path.join(SHOTS, 'wizard-folder-desktop.png') })
    await s.page.getByRole('radio', { name: /Só neste aparelho/ }).click()
    await s.page.getByRole('button', { name: 'Começar' }).click()
    await wiz.waitFor({ state: 'detached', timeout: 10000 })
    ok((await api(s.page, '/api/storage')).j.chosen === true, 'servidor: escolha guardada (o assistente não volta)')
    for (const n of ['S-Burn', 'S-Elfos', 'S-Apagar']) await api(s.page, '/api/decks', 'POST', { name: n, format: 'modern', main: { Mountain: 60 } })
    // Definições › Dados › Ligar um aparelho
    await s.page.goto(S + '/#definicoes')
    await s.page.getByRole('button', { name: /Ligar um aparelho/ }).click()
    const code = (await s.page.locator('.sto-codetxt').textContent()).trim()
    ok(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code), 'servidor: código gerado ' + code)
    await s.page.locator('.sto-place').scrollIntoViewIfNeeded()
    await s.page.screenshot({ path: path.join(SHOTS, 'settings-dados-servidor-desktop.png') })
    const link = `${S}/ligar/${code}`

    // ---- portátil (9062) em telemóvel: assistente -> «Ligar ao meu servidor Grimório» com o link ----
    const l = await mk(P)
    await l.ctx.request.post(L + '/api/profiles', { data: { name: 'Ana' } })  // o perfil (cookie no contexto do browser)
    await l.page.goto(L + '/')
    const lw = l.page.getByRole('dialog', { name: 'Onde ficam os teus dados?' })
    await lw.waitFor({ timeout: 20000 })
    await l.page.screenshot({ path: path.join(SHOTS, 'wizard-phone.png') })
    await l.page.getByRole('radio', { name: /Ligar ao meu servidor/ }).click()
    const inp = l.page.getByLabel('Link do servidor')
    await inp.fill(link)
    await l.page.screenshot({ path: path.join(SHOTS, 'wizard-server-phone.png') })
    await l.page.getByRole('button', { name: 'Ligar ao servidor' }).click()
    await l.page.getByText('Ligado ao servidor.').waitFor({ timeout: 30000 })
    await l.page.getByText(/sincronizado/).waitFor({ timeout: 60000 })
    await l.page.screenshot({ path: path.join(SHOTS, 'wizard-done-phone.png') })
    await l.page.getByRole('button', { name: 'Feito' }).click()
    await api(l.page, '/api/decks', 'POST', { name: 'L-Portátil', format: 'modern', main: { Forest: 60 } })
    ok((await api(l.page, '/api/storage/now', 'POST', {})).j.server.state === 'ok', 'portátil: sincronizar agora')
    let ln = await names(l.page), sn = await names(s.page)
    ok(JSON.stringify(ln) === JSON.stringify(sn) && ln.includes('L-Portátil') && ln.includes('S-Burn'), 'primeira sincronização: os dois convergem ' + JSON.stringify(ln))

    // ---- mexer nos dois lados ----
    const sd = (await api(s.page, '/api/decks')).j, ld = (await api(l.page, '/api/decks')).j
    const id = (arr, n) => arr.find(d => d.name === n).id
    await api(s.page, '/api/decks/' + id(sd, 'S-Elfos'), 'PUT', { name: 'S-Elfos v2', format: 'modern', main: { Forest: 56, 'Llanowar Elves': 4 } })
    await api(s.page, '/api/decks/' + id(sd, 'S-Apagar'), 'DELETE')
    await api(s.page, '/api/decks', 'POST', { name: 'S-Novo', format: 'modern', main: { Island: 60 } })
    await api(l.page, '/api/decks/' + id(ld, 'S-Burn'), 'PUT', { name: 'S-Burn (portátil)', format: 'modern', main: { Mountain: 52, 'Lightning Bolt': 4, 'Lava Spike': 4 } })
    await api(l.page, '/api/decks/' + id(ld, 'L-Portátil'), 'DELETE')
    await api(l.page, '/api/decks', 'POST', { name: 'L-Novo', format: 'modern', main: { Plains: 60 } })
    await l.page.goto(L + '/#definicoes')
    await Promise.all([l.page.waitForResponse(r => r.url().endsWith('/api/storage/now'), { timeout: 120000 }), l.page.getByRole('button', { name: /Sincronizar agora/ }).click()])
    await l.page.getByText(/sincronizado/).first().waitFor({ timeout: 60000 })
    await sleep(500)
    ln = await names(l.page); sn = await names(s.page)
    ok(JSON.stringify(ln) === JSON.stringify(sn), 'depois de editar/criar/apagar nos dois: convergem ' + JSON.stringify(ln))
    ok(!ln.includes('S-Apagar') && !ln.includes('L-Portátil') && ln.includes('S-Elfos v2') && ln.includes('S-Burn (portátil)') && ln.includes('L-Novo') && ln.includes('S-Novo'), 'as alterações certas ficaram')
    const trashS = (await api(s.page, '/api/decks/trash')).j.map(d => d.name)
    ok(trashS.includes('L-Portátil'), 'o apagado no portátil está no lixo do servidor (recuperável)')
    await l.page.locator('.sto-place').scrollIntoViewIfNeeded()
    await l.page.screenshot({ path: path.join(SHOTS, 'settings-dados-phone.png'), fullPage: false })

    // ---- conflito: o mesmo deck muda nos dois antes de sincronizar ----
    const nid = id((await api(s.page, '/api/decks')).j, 'S-Novo'), bid = id((await api(l.page, '/api/decks')).j, 'S-Burn (portátil)')
    await api(s.page, '/api/decks/' + nid, 'PUT', { name: 'S-Novo', format: 'modern', main: { Island: 56, Opt: 4 } })
    await sleep(50)
    await api(l.page, '/api/decks/' + nid, 'PUT', { name: 'S-Novo', format: 'modern', main: { Island: 58, Ponder: 2 } })
    await api(l.page, '/api/storage/now', 'POST', {})
    await l.page.reload()
    await l.page.getByText('Conflitos').first().waitFor({ timeout: 20000 })
    await l.page.locator('.sto-conf').scrollIntoViewIfNeeded()
    await l.page.screenshot({ path: path.join(SHOTS, 'conflicts-phone.png') })
    await s.page.goto(S + '/#definicoes'); await s.page.reload()
    await s.page.getByText('Conflitos').first().waitFor({ timeout: 20000 })
    await s.page.locator('.sto-conf').scrollIntoViewIfNeeded()
    await s.page.screenshot({ path: path.join(SHOTS, 'conflicts-desktop.png') })
    await l.page.getByRole('button', { name: 'Ficar com a do conflito' }).click()
    await sleep(400)
    await api(l.page, '/api/storage/now', 'POST', {})
    ok((await api(s.page, '/api/storage/conflicts')).j.conflicts.length === 0 && (await api(l.page, '/api/storage/conflicts')).j.conflicts.length === 0, 'conflito resolvido no portátil some nos dois')
    const m1 = (await api(s.page, '/api/decks/' + nid)).j.main, m2 = (await api(l.page, '/api/decks/' + nid)).j.main
    ok(JSON.stringify(m1) === JSON.stringify(m2), 'e os dois ficaram com a mesma versão ' + JSON.stringify(m1))

    // ---- o servidor desliga: o portátil continua a trabalhar sem rede ----
    await stop('server')
    await api(l.page, '/api/decks', 'POST', { name: 'L-Offline', format: 'modern', main: { Swamp: 60 } })
    await api(l.page, '/api/decks/' + bid, 'DELETE')
    const off = (await api(l.page, '/api/storage/now', 'POST', {})).j
    ok(off.server.state === 'offline' && (await names(l.page)).includes('L-Offline'), 'sem servidor: estado «sem ligação» e o portátil continua a gravar')
    await l.page.reload()
    await l.page.getByText(/sem ligação/).first().waitFor({ timeout: 20000 })
    await l.page.locator('.sto-place').scrollIntoViewIfNeeded()
    await l.page.screenshot({ path: path.join(SHOTS, 'offline-phone.png') })
    // ---- volta: converge ----
    start('server', 9061); await up(S)
    const back = (await api(l.page, '/api/storage/now', 'POST', {})).j
    ok(back.server.state === 'ok', 'o servidor voltou: sincronizado')
    await s.page.goto(S + '/')
    ln = await names(l.page); sn = await names(s.page)
    ok(JSON.stringify(ln) === JSON.stringify(sn) && sn.includes('L-Offline') && !sn.includes('S-Burn (portátil)'), 'depois de voltar a rede: convergem ' + JSON.stringify(sn))

    const wide = await l.page.evaluate(() => document.documentElement.scrollWidth)
    ok(wide <= 390, 'telemóvel: sem deslocamento horizontal (' + wide + 'px)')
    const cookies = await l.ctx.cookies()
    await s.ctx.close(); await l.ctx.close()
    // ---- Definições › Dados em desktop (portátil) e em inglês ----
    const l2 = await mk(D)
    await l2.page.goto(L + '/')
    await l2.ctx.addCookies(cookies)
    await l2.page.goto(L + '/#definicoes'); await l2.page.reload()
    await l2.page.getByText(/sincronizado/).first().waitFor({ timeout: 20000 })
    await l2.page.getByRole('button', { name: /Mudar onde ficam os dados/ }).click()
    await l2.page.locator('.sto-place').scrollIntoViewIfNeeded()
    await l2.page.screenshot({ path: path.join(SHOTS, 'settings-dados-desktop.png') })
    const en = await mk(P, 'en')
    await l2.ctx.close()
    await en.ctx.addCookies(cookies)
    await en.page.goto(L + '/#definicoes')
    await en.page.getByText(/synced/).first().waitFor({ timeout: 20000 })
    await en.page.locator('.sto-place').scrollIntoViewIfNeeded()
    await en.page.screenshot({ path: path.join(SHOTS, 'settings-dados-phone-en.png') })
    const wide2 = await en.page.evaluate(() => document.documentElement.scrollWidth)
    ok(wide2 <= 390, 'telemóvel (en, Definições): sem deslocamento horizontal (' + wide2 + 'px)')
    console.log('E2E OK')
  } finally {
    await browser.close()
    await stop('server'); await stop('laptop')
  }
}
main().catch(e => { console.error(e); Object.values(procs).forEach(p => p.kill()); process.exit(1) })
