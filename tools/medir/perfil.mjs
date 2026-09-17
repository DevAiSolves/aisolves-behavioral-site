/* perfil — quién se come el hilo principal durante el scroll.
   Muestrea con el Profiler de V8 mientras la página baja entera y suma el
   tiempo propio de cada función. Lo que sale son nombres y líneas, no
   categorías: con eso se sabe qué tocar. */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const url = process.argv[2];
const etiqueta = process.argv[3] || 'perfil';
const b = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--window-size=1440,900', '--no-first-run', '--disable-extensions']
    .concat(process.env.SIN_GL === '1' ? ['--disable-3d-apis'] : []),
});
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
const cdp = await p.target().createCDPSession();
await p.goto(url, { waitUntil: 'load', timeout: 120000 });
await new Promise((r) => setTimeout(r, 2500));

await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });   // 0,2 ms
await cdp.send('Profiler.start');
const alto = await p.evaluate(() => document.documentElement.scrollHeight);
for (let i = 0; i < Math.min(90, Math.ceil(alto / 240)); i++) {
  await p.mouse.wheel({ deltaY: 240 });
  await new Promise((r) => setTimeout(r, 32));
}
const { profile } = await cdp.send('Profiler.stop');

/* tiempo propio por nodo, a partir de las muestras */
const porId = new Map(profile.nodes.map((n) => [n.id, n]));
const propio = new Map();
const dt = profile.timeDeltas, sm = profile.samples;
for (let i = 0; i < sm.length; i++) propio.set(sm[i], (propio.get(sm[i]) || 0) + (dt[i] || 0));
const filas = [...propio.entries()].map(([id, us]) => {
  const n = porId.get(id) || {};
  const f = n.callFrame || {};
  return { us: us / 1000, fn: f.functionName || '(anónimo)', linea: (f.lineNumber ?? -1) + 1, col: (f.columnNumber ?? -1) + 1, url: (f.url || '').split('/').pop() };
}).sort((a, b2) => b2.us - a.us);
const total = filas.reduce((a, f) => a + f.us, 0);
console.log(`total muestreado: ${total.toFixed(0)} ms`);
for (const f of filas.slice(0, 28)) console.log(`${f.us.toFixed(0).padStart(6)} ms  ${f.fn.padEnd(26)} ${f.url}:${f.linea}:${f.col}`);
fs.writeFileSync(new URL(`./${etiqueta}.json`, import.meta.url), JSON.stringify(filas.slice(0, 120), null, 1));
await b.close();
