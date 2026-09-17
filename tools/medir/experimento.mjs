/* experimento — apaga una pieza y vuelve a medir el scroll.
   Es la forma barata de saber qué cuesta de verdad: en vez de razonar sobre el
   código, se desactiva en caliente y se compara el fotograma. */
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const url = process.argv[2];

const PRUEBAS = [
  ['base', ''],
  ['sin --t3d-g en :root', `const sp = CSSStyleDeclaration.prototype.setProperty;
     CSSStyleDeclaration.prototype.setProperty = function(n,v,p){ if(n==='--t3d-gx'||n==='--t3d-gy') return; return sp.call(this,n,v,p); };`],
  ['sin fxTask (3D por scroll)', `if(window.T3D&&T3D.fx) try{ T3D.fx.enabled; }catch(e){}
     document.querySelectorAll('section.sec').forEach(el=>{el.style.transform='';el.style.opacity='';});
     const sp2 = CSSStyleDeclaration.prototype.setProperty;
     CSSStyleDeclaration.prototype.setProperty = function(n,v,p){ if(n==='--t3d-gx'||n==='--t3d-gy') return; return sp2.call(this,n,v,p); };
     const st = Object.getOwnPropertyDescriptor(HTMLElement.prototype,'style');
     window.__noFx = true;`],
  ['sin esfera 2D del hero', `const c=document.getElementById('heroSphere'); if(c) c.style.display='none';`],
  ['sin cerebro', `const c=document.getElementById('brainCanvas'); if(c) c.style.display='none';`],
  ['sin backdrop-filter', `const st=document.createElement('style'); st.textContent='*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}'; document.head.appendChild(st);`],
  ['sin filter:blur', `const st=document.createElement('style'); st.textContent='*{filter:none!important}'; document.head.appendChild(st);`],
  ['sin --lift en tarjetas', `const sp3 = CSSStyleDeclaration.prototype.setProperty;
     CSSStyleDeclaration.prototype.setProperty = function(n,v,p){ if(n==='--lift'||n==='--p') return; return sp3.call(this,n,v,p); };`],
  ['sin animaciones CSS', `const st=document.createElement('style'); st.textContent='*{animation:none!important;transition:none!important}'; document.head.appendChild(st);`],
];

const b = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--window-size=1440,900', '--no-first-run', '--disable-extensions']
    .concat(process.env.SIN_GL === '1' ? ['--disable-3d-apis'] : []),
});

for (const [nombre, guion] of PRUEBAS) {
 try {
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await p.goto(url, { waitUntil: 'load', timeout: 120000 });
  await new Promise((r) => setTimeout(r, 2000));
  if (guion) await p.evaluate(guion);
  await new Promise((r) => setTimeout(r, 400));
  await p.evaluate(() => { window.__f = []; let a = performance.now(); window.__stop = false;
    const t = () => { const n = performance.now(); window.__f.push(n - a); a = n; if (!window.__stop) requestAnimationFrame(t); };
    requestAnimationFrame(t); });
  const alto = await p.evaluate(() => document.documentElement.scrollHeight);
  for (let i = 0; i < Math.min(80, Math.ceil(alto / 260)); i++) {
    await p.mouse.wheel({ deltaY: 260 });
    await new Promise((r) => setTimeout(r, 32));
  }
  const r = await p.evaluate(() => { window.__stop = true;
    const f = window.__f.slice(3).filter((x) => x > 0 && x < 3000), o = f.slice().sort((a, b) => a - b);
    return { fps: 1000 / (f.reduce((a, b) => a + b, 0) / (f.length || 1)), p50: o[o.length >> 1] || 0,
             p95: o[Math.floor(o.length * 0.95)] || 0, n: f.length };
  });
  console.log(`${nombre.padEnd(30)} fps ${r.fps.toFixed(1).padStart(5)}   p50 ${r.p50.toFixed(0).padStart(4)} ms   p95 ${r.p95.toFixed(0).padStart(5)} ms`);
  await p.close();
 } catch(e){ console.log(`${nombre.padEnd(30)} FALLO: ${e.message.split('\n')[0]}`); }
}
await b.close();
