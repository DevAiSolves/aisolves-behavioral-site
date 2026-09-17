/* ============================================================================
   foto-a-puntos — convierte un retrato en una nube de puntos 3D.
   ----------------------------------------------------------------------------
   Entrada: un PNG del retrato (sips -s format png --resampleWidth 200 …).
   Salida:  JSON con posiciones xyz y tono por punto, listo para THREE.Points.

   POR QUÉ NO SE USA LA LUMINANCIA COMO PROFUNDIDAD, que es lo primero que uno
   intenta: en esta foto la luz es plana y el fondo liso, así que lo claro no es
   lo que sobresale — la frente y la camisa son lo más brillante y no son lo más
   cercano. Usar el brillo como z daría una máscara abollada, no una cara.

   La profundidad sale de un modelo elipsoidal de cabeza: se sabe dónde está el
   óvalo y se levanta desde el borde hacia el centro. Encima, la luminancia solo
   MODULA (nariz, cuencas, labios), no manda. El resultado gira de forma
   convincente en el rango en que se usa, unos ±35°; no es un escaneo y no
   pretende serlo.

   Uso: node tools/foto-a-puntos.mjs cara200.png 4200 > cara.json
   ========================================================================== */

import fs from 'node:fs';
import zlib from 'node:zlib';

/* ---------- PNG mínimo (sin dependencias) ---------- */
function leerPng(buf) {
  let pos = 8, idat = [], w = 0, h = 0, ct = 0, bd = 8;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), tipo = buf.toString('ascii', pos + 4, pos + 8);
    const d = buf.subarray(pos + 8, pos + 8 + len);
    if (tipo === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; }
    else if (tipo === 'IDAT') idat.push(d);
    pos += 12 + len;
  }
  if (bd !== 8) throw new Error('se esperaba PNG de 8 bits por canal');
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct];
  if (!ch) throw new Error('tipo de color PNG no soportado: ' + ct);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch, filas = [];
  let prev = Buffer.alloc(stride), p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++], linea = Buffer.from(raw.subarray(p, p + stride)); p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? linea[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      if (f === 1) linea[i] = (linea[i] + a) & 255;
      else if (f === 2) linea[i] = (linea[i] + b) & 255;
      else if (f === 3) linea[i] = (linea[i] + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        linea[i] = (linea[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    prev = linea; filas.push(linea);
  }
  return { w, h, ch, filas };
}

/* ---------- silueta ----------
   El fondo es amarillo liso: en amarillo el azul cae mucho por debajo del rojo,
   y en piel, pelo o camisa no. R-B separa las dos cosas mejor que cualquier
   umbral de brillo, que confundiría la camisa blanca con el fondo claro. */
function silueta(img) {
  const { w, h, ch, filas } = img;
  const fondo = new Uint8Array(w * h);
  const rb = (x, y) => { const o = x * ch, r = filas[y]; return r[o] - r[o + 2]; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) fondo[y * w + x] = rb(x, y) > 95 ? 1 : 0;

  /* relleno desde los bordes: así una zona amarilla rodeada de sujeto (un hueco
     entre el pelo) no se toma por fondo */
  const fuera = new Uint8Array(w * h), pila = [];
  for (let x = 0; x < w; x++) { pila.push([x, 0], [x, h - 1]); }
  for (let y = 0; y < h; y++) { pila.push([0, y], [w - 1, y]); }
  while (pila.length) {
    const [x, y] = pila.pop();
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const i = y * w + x;
    if (fuera[i] || !fondo[i]) continue;
    fuera[i] = 1;
    pila.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return { dentro: (x, y) => !fuera[y * w + x] };
}

const lum = (img, x, y) => {
  const o = x * img.ch, r = img.filas[y];
  return (0.2126 * r[o] + 0.7152 * r[o + 1] + 0.0722 * r[o + 2]) / 255;
};

/* Mapa de bordes NORMALIZADO POR ZONA.
   En un retrato con luz plana, el filo del pelo tiene un gradiente enorme y los
   rasgos de la cara uno flojo: midiendo en absoluto, el pelo se lleva los puntos
   y la nariz y la boca desaparecen. Dividiendo cada píxel por el gradiente medio
   de su vecindad, lo que cuenta es "cuánto destaca aquí", no "cuánto cambia en
   toda la foto", y los rasgos vuelven a competir con el pelo. */
function mapaBordes(img) {
  const { w, h } = img;
  const g = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) g[y * w + x] = borde(img, x, y);

  /* media local por caja, en dos pasadas separables */
  const R = Math.max(6, Math.round(Math.min(w, h) / 14));
  const tmp = new Float32Array(w * h), med = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s2 = 0, n = 0;
    for (let d = -R; d <= R; d++) { const xx = x + d; if (xx < 0 || xx >= w) continue; s2 += g[y * w + xx]; n++; }
    tmp[y * w + x] = s2 / n;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s2 = 0, n = 0;
    for (let d = -R; d <= R; d++) { const yy = y + d; if (yy < 0 || yy >= h) continue; s2 += tmp[yy * w + x]; n++; }
    med[y * w + x] = s2 / n;
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = g[i] / (med[i] + 0.035);   // +eps: zonas lisas no explotan
  return out;
}

/* magnitud de gradiente (Sobel): cuánto cambia la luz alrededor del píxel */
function borde(img, x, y) {
  const { w, h } = img;
  if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return 0;
  const L = (dx, dy) => lum(img, x + dx, y + dy);
  const gx = (L(1,-1) + 2*L(1,0) + L(1,1)) - (L(-1,-1) + 2*L(-1,0) + L(-1,1));
  const gy = (L(-1,1) + 2*L(0,1) + L(1,1)) - (L(-1,-1) + 2*L(0,-1) + L(1,-1));
  return Math.hypot(gx, gy);
}

/* ---------- generación ---------- */
const [, , archivo, nStr] = process.argv;
if (!archivo) { console.error('uso: node tools/foto-a-puntos.mjs <retrato.png> [nPuntos]'); process.exit(1); }
const objetivo = Math.max(500, Math.min(20000, parseInt(nStr || '4200', 10)));
const REF   = parseFloat(process.env.REF   || '0.28');   // gradiente que ya cuenta como borde pleno
const POT   = parseFloat(process.env.POT   || '1.5');    // curvatura: más alta, más selectivo
const SUELO = parseFloat(process.env.SUELO || '0.06');   // mínimo para que la silueta no quede hueca

const img = leerPng(fs.readFileSync(archivo));
const { w, h } = img;
const sil = silueta(img);

/* caja del sujeto: define el óvalo del que sale la profundidad */
let x0 = w, x1 = 0, y0 = h, y1 = 0, dentroN = 0;   // y1 se recorta luego a la cabeza
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (sil.dentro(x, y)) {
  dentroN++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
}
if (!dentroN) throw new Error('no se encontró sujeto: revisa el umbral de silueta');

/* Se recorta a la cabeza: los hombros ocupan el tercio inferior, no aportan
   identidad y la camisa blanca no tiene bordes, así que sólo añadía relleno.

   Y DESPUÉS hay que recalcular el ancho. La caja original la fijan los hombros,
   que llegan de borde a borde; recortando sólo en vertical se seguía muestreando
   una caja tan ancha como la foto, y por eso salía un rectángulo con textura en
   vez de una cabeza. La cabeza es bastante más estrecha que los hombros. */
const recorte = parseFloat(process.env.RECORTE || '0.66');
y1 = y0 + Math.round((y1 - y0) * recorte);
x0 = w; x1 = 0;
for (let y = y0; y <= y1; y++) for (let x = 0; x < w; x++) if (sil.dentro(x, y)) {
  if (x < x0) x0 = x; if (x > x1) x1 = x;
}

const bordes = mapaBordes(img);

const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
const rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
const escala = Math.max(rx, ry);

let s = 987654321;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const pts = [], tonos = [];
const intentos = objetivo * 14;
for (let k = 0; k < intentos && pts.length < objetivo; k++) {
  const px = x0 + rnd() * (x1 - x0), py = y0 + rnd() * (y1 - y0);
  const ix = Math.min(w - 1, Math.round(px)), iy = Math.min(h - 1, Math.round(py));
  if (!sil.dentro(ix, iy)) continue;

  const L = lum(img, ix, iy);

  /* Densidad por BORDE, no por tono. Un retrato de puntos se reconoce por dónde
     cambia la luz —párpados, nariz, labios, mandíbula, filo del pelo—, no por
     lo oscuro que es cada zona. Sesgando por oscuridad, el pelo se llevaba casi
     todos los puntos y la cara salía como una mancha; con el gradiente, los
     puntos caen justo en los rasgos. Se deja un suelo para que las superficies
     lisas no queden huecas. */
  /* La curva importa más que el criterio. El gradiente de este retrato tiene la
     mediana en 0.02 y el percentil 95 en 0.44: normalizando por un percentil
     alto y elevando a una potencia, una zona lisa recibe ~30 veces menos puntos
     que un párpado. Con un factor lineal, la mejilla —que es casi toda la
     cara— se llevaba tantos puntos como los rasgos y salía una mancha. */
  const g = Math.min(1, bordes[iy * w + ix] / REF);
  const prioridad = SUELO + (1 - SUELO) * Math.pow(g, POT);
  if (rnd() > prioridad) continue;

  /* profundidad: elipsoide de cabeza + modulación suave por luminancia */
  const nx = (px - cx) / (rx * 1.02), ny = (py - cy) / (ry * 1.02);
  const d2 = nx * nx + ny * ny;
  const cupula = Math.sqrt(Math.max(0, 1 - Math.min(1, d2)));
  const z = cupula * 0.62 + (L - 0.5) * 0.10 * cupula;

  pts.push([(px - cx) / escala, -(py - cy) / escala, z]);   // y invertida: en imagen crece hacia abajo
  tonos.push(L);
}

/* normalizado a radio 1, como el muestreador de mallas */
const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
for (const p of pts) for (let k = 0; k < 3; k++) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k]; }
const c = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
const r = Math.max(...[0, 1, 2].map((k) => (hi[k] - lo[k]) / 2)) || 1;

const plano = new Float32Array(pts.length * 3), tono = new Uint8Array(pts.length);
pts.forEach((p, i) => {
  plano[i * 3] = (p[0] - c[0]) / r;
  plano[i * 3 + 1] = (p[1] - c[1]) / r;
  plano[i * 3 + 2] = (p[2] - c[2]) / r;
  tono[i] = Math.max(0, Math.min(255, Math.round(tonos[i] * 255)));
});

console.error(`sujeto: ${dentroN} px de ${w * h}  ·  puntos: ${pts.length}`);
process.stdout.write(JSON.stringify({
  n: pts.length,
  pos: Buffer.from(plano.buffer).toString('base64'),
  tono: Buffer.from(tono.buffer).toString('base64'),
}));
