/* ============================================================================
   medir — mide el sitio antes y después de optimizarlo, con los mismos números.

   Tres cosas que importan y que no salen de Lighthouse tal cual:
   · cuándo aparece DE VERDAD la esfera del hero (píxeles en el canvas), que es
     el momento en que la página deja de parecer rota;
   · cuánto cuesta un fotograma de scroll, recorriendo la página entera;
   · cuánto hilo principal se gasta antes de que la página responda.

   Uso: node medir.mjs <url> <etiqueta>   → escribe <etiqueta>.json y lo resume
   ========================================================================== */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const url = process.argv[2] || 'http://localhost:8200/aisolves-site.html';
const etiqueta = process.argv[3] || 'base';
const LENTO = process.env.LENTO === '1';            // Slow 4G + CPU x4

const navegador = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  /* Sin WebGL por software a propósito. SwiftShader pinta ocho mil puntos en la
     CPU y se come el fotograma entero: mediría el emulador, no la página. Sin
     él, el hero cae a su respaldo en canvas 2D, que es justo el camino caro de
     hilo principal que interesa medir. */
  /* Con SIN_GL=1 se apaga WebGL. No es un capricho: en un Mac sin pantalla
     Chrome resuelve WebGL por software, y ocho mil puntos por fotograma en la
     CPU tapan cualquier otra medida. Apagándolo, el hero cae a su respaldo en
     canvas 2D y lo que queda es el coste real de hilo principal, que es lo que
     se está optimizando. Sin la bandera se mide el camino completo. */
  args: ['--window-size=1440,900', '--no-first-run', '--disable-extensions']
    .concat(process.env.SIN_GL === '1' ? ['--disable-3d-apis'] : []),
});

async function unaPasada() {
  const p = await navegador.newPage();
  await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const cdp = await p.target().createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Performance.enable');
  if (LENTO) {
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }

  /* el reloj del sondeo del canvas arranca antes que el documento: así el
     instante en que la esfera pinta es comparable con FCP y con load */
  await p.evaluateOnNewDocument(() => {
    window.__t0 = performance.now();
    window.__hito = {};
    window.__tareas = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__tareas.push({ t: e.startTime, d: e.duration }); })
      .observe({ type: 'longtask', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__hito[e.name] = e.startTime; })
      .observe({ type: 'paint', buffered: true });
    new PerformanceObserver((l) => { const e = l.getEntries().pop(); if (e) { window.__hito.lcp = e.startTime; window.__hito.lcpEl = (e.element && (e.element.id || e.element.tagName)) || ''; } })
      .observe({ type: 'largest-contentful-paint', buffered: true });
    let cls = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value; window.__hito.cls = cls; })
      .observe({ type: 'layout-shift', buffered: true });
    /* sondeo del canvas del hero: en cuanto tenga un píxel no transparente */
    const mira = () => {
      const c = document.getElementById('heroSphere');
      if (c && c.width) {
        try {
          const d = c.getContext('2d', { willReadFrequently: true });
          if (d) {
            const im = d.getImageData(0, 0, c.width, c.height).data;
            for (let i = 3; i < im.length; i += 4 * 97) if (im[i] > 8) { window.__hito.esfera = performance.now(); return; }
          } else if (c.getContext('webgl2') || c.getContext('webgl')) { window.__hito.esferaGL = performance.now(); return; }
        } catch (e) { window.__hito.esferaGL = performance.now(); return; }
      }
      requestAnimationFrame(mira);
    };
    requestAnimationFrame(mira);
  });

  const bytes = { total: 0, porTipo: {} };
  p.on('response', async (r) => {
    try {
      const l = Number(r.headers()['content-length'] || 0);
      const t = r.request().resourceType();
      bytes.total += l; bytes.porTipo[t] = (bytes.porTipo[t] || 0) + l;
    } catch (e) { /* respuestas sin cuerpo */ }
  });

  await p.goto(url, { waitUntil: 'load', timeout: 120000 });
  await new Promise((r) => setTimeout(r, LENTO ? 4500 : 2200));   // que arranquen los diferidos

  const carga = await p.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] || {};
    return {
      dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, respuesta: n.responseEnd,
      fcp: window.__hito['first-contentful-paint'], lcp: window.__hito.lcp, lcpEl: window.__hito.lcpEl,
      cls: window.__hito.cls || 0, esfera: window.__hito.esfera || window.__hito.esferaGL || null,
      gl: !!window.__hito.esferaGL,
      tareas: window.__tareas.length, tbt: window.__tareas.reduce((a, t) => a + Math.max(0, t.d - 50), 0),
      hiloMs: window.__tareas.reduce((a, t) => a + t.d, 0),
      nodos: document.getElementsByTagName('*').length,
      alto: document.documentElement.scrollHeight,
    };
  });

  /* ---------- scroll: fotogramas de arriba abajo ---------- */
  await p.evaluate(() => {
    window.__f = []; let ant = performance.now();
    window.__paraF = false;
    const t = () => { const n = performance.now(); window.__f.push(n - ant); ant = n; if (!window.__paraF) requestAnimationFrame(t); };
    requestAnimationFrame(t);
  });
  const alto = carga.alto;
  const pasos = Math.min(90, Math.ceil(alto / 240));
  for (let i = 0; i < pasos; i++) {
    await p.mouse.wheel({ deltaY: 180 });
    await new Promise((r) => setTimeout(r, 32));
  }
  const scroll = await p.evaluate(() => {
    window.__paraF = true;
    const f = window.__f.slice(3).filter((x) => x > 0 && x < 2000);
    const o = f.slice().sort((a, b) => a - b);
    const pc = (q) => o.length ? o[Math.min(o.length - 1, Math.floor(o.length * q))] : 0;
    return {
      n: f.length, medio: f.reduce((a, b) => a + b, 0) / (f.length || 1),
      p50: pc(0.5), p95: pc(0.95), peor: o[o.length - 1] || 0,
      lentos16: f.filter((x) => x > 16.7).length, lentos33: f.filter((x) => x > 33).length, lentos50: f.filter((x) => x > 50).length,
      fps: 1000 / (f.reduce((a, b) => a + b, 0) / (f.length || 1)),
    };
  });

  const met = await cdp.send('Performance.getMetrics');
  const m = Object.fromEntries(met.metrics.map((x) => [x.name, x.value]));
  await p.close();
  return { carga, scroll, bytes, cpu: { script: m.ScriptDuration, estilo: m.RecalcStyleDuration, maqueta: m.LayoutDuration, tareas: m.TaskDuration } };
}

const pasadas = [];
for (let i = 0; i < 2; i++) pasadas.push(await unaPasada());
await navegador.close();

const med = (f) => { const v = pasadas.map(f).filter((x) => typeof x === 'number' && !isNaN(x)).sort((a, b) => a - b); return v.length ? Math.round(v[Math.floor(v.length / 2)] * 10) / 10 : null; };
const R = {
  etiqueta, url, lento: LENTO,
  fcp: med((p) => p.carga.fcp), lcp: med((p) => p.carga.lcp), lcpEl: pasadas[0].carga.lcpEl,
  dcl: med((p) => p.carga.dcl), load: med((p) => p.carga.load), esfera: med((p) => p.carga.esfera),
  esferaGL: pasadas[0].carga.gl, cls: med((p) => p.carga.cls),
  tbt: med((p) => p.carga.tbt), hiloMs: med((p) => p.carga.hiloMs), tareasLargas: med((p) => p.carga.tareas),
  nodos: med((p) => p.carga.nodos), altoPagina: med((p) => p.carga.alto),
  scrollFps: med((p) => p.scroll.fps), scrollP50: med((p) => p.scroll.p50), scrollP95: med((p) => p.scroll.p95),
  scrollPeor: med((p) => p.scroll.peor), framesLentos16: med((p) => p.scroll.lentos16),
  framesLentos33: med((p) => p.scroll.lentos33), framesLentos50: med((p) => p.scroll.lentos50),
  framesTotales: med((p) => p.scroll.n),
  cpuScriptMs: med((p) => p.cpu.script * 1000), cpuEstiloMs: med((p) => p.cpu.estilo * 1000),
  cpuMaquetaMs: med((p) => p.cpu.maqueta * 1000), bytesRed: med((p) => p.bytes.total),
};
fs.writeFileSync(new URL(`./${etiqueta}${LENTO ? '-lento' : ''}.json`, import.meta.url), JSON.stringify({ resumen: R, pasadas }, null, 1));
console.log(JSON.stringify(R, null, 1));
