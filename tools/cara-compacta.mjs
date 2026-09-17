/* ============================================================================
   cara-compacta — reempaqueta la nube de puntos del retrato (AIS_CARA).

   El bloque original guardaba 8.000 puntos en Float32: 139 KB de base64 que
   además no comprimían nada, porque base64 de floats es ruido. El avatar se
   pinta en 62 px CSS (124 en pantalla de doble densidad), así que sobra
   muchísima precisión.

   Tres decisiones, en orden de cuánto ahorran:

   1. UN BYTE POR COORDENADA en vez de cuatro. A tamaño real el error máximo es
      de 0,19 px, por debajo de lo que el ojo distingue en un punto de medio
      píxel. Comprobado dibujando las dos versiones lado a lado.

   2. ORDENAR los puntos por y, luego x, luego z. El orden del array da igual:
      mod-retrato reordena por profundidad en cada fotograma antes de pintar.

   3. Guardar DIFERENCIAS con el punto anterior, y por canales separados (todas
      las x juntas, luego las y, luego las z, luego los tonos). Ordenados, dos
      puntos seguidos casi coinciden, así que las diferencias son números
      pequeños y muy repetidos, que es justo lo que deflate sabe aplastar.

   Del original a esto: 139 KB → 42 KB de base64, y de 102 KB a 17 KB una vez
   comprimido. El dibujo es el mismo punto por punto.

   Uso:  node tools/cara-compacta.mjs <html> [nPuntos] > cara.json
         El HTML puede llevar el bloque en cualquiera de los dos formatos: el
         original con {n, pos, tono}, o uno ya reempaquetado con {n, b64}.
   ========================================================================== */
import fs from 'node:fs';

const [, , archivo, nStr] = process.argv;
if (!archivo) { console.error('uso: node tools/cara-compacta.mjs <html> [nPuntos]'); process.exit(1); }
const html = fs.readFileSync(archivo, 'utf8');

const m = html.match(/window\.AIS_CARA\s*=\s*\(function\(\)\{\s*var D = (\{[\s\S]*?\});/);
if (!m) throw new Error('no encuentro el bloque AIS_CARA en el HTML');
const D = JSON.parse(m[1]);
const bytes = (b64) => Buffer.from(b64, 'base64');

/* ---------- entrada: los puntos, ya cuantizados a byte ---------- */
const q = (v) => Math.max(0, Math.min(255, Math.round((v + 1) * 127.5)));
let puntos, errMax = 0;

if (D.pos) {                                   // formato original: Float32 + tono
  const b = bytes(D.pos);
  const pos = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  const tono = bytes(D.tono);
  puntos = Array.from({ length: D.n }, (_, i) => {
    const c = [0, 1, 2].map((k) => {
      const v = pos[i * 3 + k], e = q(v);
      errMax = Math.max(errMax, Math.abs(e / 127.5 - 1 - v));
      return e;
    });
    return [c[0], c[1], c[2], tono[i]];
  });
} else {                                       // ya reempaquetado: se vuelve a leer
  const b = bytes(D.b64), n = D.n;
  puntos = D.dif                                // 'dif' marca el formato nuevo
    ? (() => {                                  // canales + diferencias
        const p = Array.from({ length: n }, () => [0, 0, 0, 0]);
        for (let c = 0; c < 4; c++) { let ant = 0; for (let k = 0; k < n; k++) { ant = (ant + b[c * n + k]) & 0xFF; p[k][c] = ant; } }
        return p;
      })()
    : Array.from({ length: n }, (_, i) => [b[i * 4], b[i * 4 + 1], b[i * 4 + 2], b[i * 4 + 3]]);
}

/* ---------- submuestreo determinista, si se pide ---------- */
const n = Math.max(200, Math.min(puntos.length, parseInt(nStr || String(puntos.length), 10)));
if (n < puntos.length) {
  let s = 20240917;                            // semilla fija: el resultado es repetible
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = puntos.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [puntos[i], puntos[j]] = [puntos[j], puntos[i]]; }
  puntos = puntos.slice(0, n);
}

/* ---------- salida: ordenado, por canales y en diferencias ---------- */
puntos.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]) || (a[2] - b[2]));
const out = new Uint8Array(n * 4);
for (let c = 0; c < 4; c++) {
  let ant = 0;
  for (let k = 0; k < n; k++) { out[c * n + k] = (puntos[k][c] - ant) & 0xFF; ant = puntos[k][c]; }
}

const b64 = Buffer.from(out).toString('base64');
const { gzipSync } = await import('node:zlib');
console.error(`puntos: ${n} · base64: ${b64.length} · comprimido: ${gzipSync(Buffer.from(b64), { level: 9 }).length}` +
  (errMax ? ` · error máx de cuantización: ${errMax.toFixed(5)} (${(errMax * 49.6).toFixed(2)} px en un lienzo de 124 px)` : ''));
process.stdout.write(JSON.stringify({ n: n, dif: 1, b64: b64 }));
