/* saltos — qué se mueve solo durante la carga, y cuánto. */
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless:'new', args:['--window-size=1440,900','--no-first-run'] });
for (const bloquear of [false, true]) {
  const p = await b.newPage();
  await p.setViewport({ width:1440, height:900, deviceScaleFactor:1 });
  if (bloquear) {                                  // sin fuentes externas: aísla el cambio de tipografía
    await p.setRequestInterception(true);
    p.on('request', (r) => (/fonts\.(googleapis|gstatic)\.com/.test(r.url()) ? r.abort() : r.continue()));
  }
  await p.evaluateOnNewDocument(() => {
    window.__s = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) {
      window.__s.push({ v:e.value, t:Math.round(e.startTime), q:(e.sources||[]).map((s)=>{
        const n=s.node; return n ? (n.tagName||'#text') + (n.id?'#'+n.id:'') + (n.className&&n.className.split?'.'+String(n.className).split(' ')[0]:'') : '?'; }) });
    } }).observe({ type:'layout-shift', buffered:true });
  });
  await p.goto(process.argv[2], { waitUntil:'load', timeout:120000 });
  await new Promise((r) => setTimeout(r, 2500));
  const s = await p.evaluate(() => window.__s);
  const tot = s.reduce((a,x)=>a+x.v,0);
  console.log(`\n${bloquear?'SIN fuentes de Google':'con fuentes'}  ·  CLS ${tot.toFixed(4)}  ·  ${s.length} saltos`);
  for (const x of s.sort((a,b2)=>b2.v-a.v).slice(0,8)) console.log(`   ${x.v.toFixed(4)}  a los ${x.t} ms   ${x.q.slice(0,4).join(', ')}`);
  await p.close();
}
await b.close();
