/* ============================================================================
   cara-compacta — reempaqueta la nube de puntos del retrato (AIS_CARA) en el
   formato mínimo que el avatar necesita.
   ----------------------------------------------------------------------------
   El bloque original guardaba 8000 puntos en Float32 (12 bytes por punto más
   el tono): 139 KB de base64 en <head>, que además no comprimen. El avatar se
   pinta en 62 px CSS (124 px de dispositivo como mucho): un byte por
   coordenada da 1/127 de precisión, es decir 0,2 px en el lienzo real, por
   debajo de lo que el ojo distingue en un punto de medio píxel.

   Formato de salida: bytes intercalados [x, y, z, tono] por punto, en base64.
   x, y, z van de -1..1 mapeados a 0..255; tono ya era 0..255.

   Uso:  node tools/cara-compacta.mjs aisolves-site.html 8000 > cara.json
         (el segundo argumento es cuántos puntos conservar; con menos de 8000
          se submuestrea con semilla fija para que el resultado sea repetible)
   ========================================================================== */
import fs from 'node:fs';

const [, , archivo, nStr] = process.argv;
if (!archivo) { console.error('uso: node tools/cara-compacta.mjs <html> [nPuntos]'); process.exit(1); }
const html = fs.readFileSync(archivo, 'utf8');

/* el bloque vive como `var D = {...};` dentro del script AIS_CARA */
const m = html.match(/window\.AIS_CARA\s*=\s*\(function\(\)\{\s*var D = (\{[\s\S]*?\});/);
if (!m) throw new Error('no encuentro el bloque AIS_CARA en el HTML');
const D = JSON.parse(m[1]);
const dec = (b64, T) => { const b = Buffer.from(b64, 'base64'); return new T(b.buffer, b.byteOffset, b.byteLength / T.BYTES_PER_ELEMENT); };
const pos = dec(D.pos, Float32Array), tono = dec(D.tono, Uint8Array);
if (pos.length !== D.n * 3 || tono.length !== D.n) throw new Error('el bloque no cuadra con n');

/* submuestreo determinista: barajado de Fisher-Yates con un LCG de semilla fija */
const n = Math.max(200, Math.min(D.n, parseInt(nStr || String(D.n), 10)));
let s = 20240917;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const idx = Array.from({ length: D.n }, (_, i) => i);
for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
const keep = idx.slice(0, n).sort((a, b) => a - b);

const q = (v) => Math.max(0, Math.min(255, Math.round((v + 1) * 127.5)));
const out = new Uint8Array(n * 4);
let errMax = 0;
keep.forEach((i, k) => {
  for (let c = 0; c < 3; c++) {
    const v = pos[i * 3 + c], b = q(v);
    out[k * 4 + c] = b;
    errMax = Math.max(errMax, Math.abs(b / 127.5 - 1 - v));
  }
  out[k * 4 + 3] = tono[i];
});

const b64 = Buffer.from(out).toString('base64');
console.error(`puntos: ${n} de ${D.n} · bytes: ${out.length} · base64: ${b64.length} (antes ${D.pos.length + D.tono.length}) · error máx de cuantización: ${errMax.toFixed(5)} (${(errMax * 49.6).toFixed(2)} px en un lienzo de 124 px)`);
process.stdout.write(JSON.stringify({ n, b64 }));
