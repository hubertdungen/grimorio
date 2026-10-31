// versões «1.12.0» / «v1.10.0»: a é mais nova do que b? (app Android: apkupdate.jsx)
const vkey = v => String(v || '').replace(/^v/, '').split('.').map(n => +n || 0)
export const newer = (a, b) => { const x = vkey(a), y = vkey(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false }
