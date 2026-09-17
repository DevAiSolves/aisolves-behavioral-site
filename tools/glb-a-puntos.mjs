/* ============================================================================
   glb-a-puntos — convierte una malla GLB en una nube de puntos lista para pegar.
   ----------------------------------------------------------------------------
   Se hace AQUÍ y no en el navegador a propósito. El sitio es un único archivo
   HTML: cargar un GLB más un GLTFLoader en tiempo de ejecución añadiría una
   descarga y una dependencia para algo que no cambia nunca. Muestreando en
   compilación, lo que viaja son unos kilobytes de coordenadas.

   El muestreo es por ÁREA, no por vértice. Una malla generada desde una foto
   tiene los triángulos repartidos de forma muy desigual —mucho detalle en los
   ojos, casi ninguno en la frente—, así que repartir puntos por vértice dejaría
   la frente vacía y los ojos apelmazados. Eligiendo cada triángulo con
   probabilidad proporcional a su área, la densidad sale pareja por superficie,
   que es lo que hace que se lea la cara.

   Uso:  node tools/glb-a-puntos.mjs cara.glb 4200 > cara.json
   ========================================================================== */

import fs from 'node:fs';

/* ---------- lectura del contenedor GLB ---------- */
function leerGlb(buf) {
  const magic = buf.readUInt32LE(0);
  if (magic !== 0x46546c67) throw new Error('no es un GLB (falta la firma glTF)');
  let off = 12, json = null, bin = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off), tipo = buf.readUInt32LE(off + 4);
    const datos = buf.subarray(off + 8, off + 8 + len);
    if (tipo === 0x4e4f534a) json = JSON.parse(datos.toString('utf8'));
    else if (tipo === 0x004e4942) bin = datos;
    off += 8 + len + ((4 - (len % 4)) % 4) * 0;   // los chunks ya vienen alineados a 4
  }
  if (!json) throw new Error('GLB sin chunk JSON');
  return { json, bin };
}

const TIPOS = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2],
                5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const COMPONENTES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function leerAccessor(json, bin, i) {
  const a = json.accessors[i];
  const [Arr, bytes] = TIPOS[a.componentType];
  const n = COMPONENTES[a.type];
  const out = new Float64Array(a.count * n);
  if (a.bufferView === undefined) return out;          // accessor disperso: ceros
  const bv = json.bufferViews[a.bufferView];
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const paso = bv.byteStride || n * bytes;             // entrelazado: hay que respetar el paso
  for (let k = 0; k < a.count; k++) {
    const o = base + k * paso;
    for (let c = 0; c < n; c++) {
      const p = o + c * bytes;
      out[k * n + c] = Arr === Float32Array ? bin.readFloatLE(p)
        : Arr === Uint16Array ? bin.readUInt16LE(p)
        : Arr === Uint32Array ? bin.readUInt32LE(p)
        : Arr === Int16Array ? bin.readInt16LE(p)
        : Arr === Uint8Array ? bin.readUInt8(p) : bin.readInt8(p);
    }
  }
  return out;
}

/* ---------- transformadas del grafo de nodos ----------
   Un GLB de un proveedor casi nunca trae la malla en el origen: viene rotada y
   escalada por su nodo. Ignorarlo da una cara tumbada o diminuta. */
function componer(n) {
  if (n.matrix) return n.matrix.slice();
  const t = n.translation || [0, 0, 0], r = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1];
  const [x, y, z, w] = r;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
const mul = (a, b) => {                                  // a·b en column-major
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let f = 0; f < 4; f++) {
    let v = 0; for (let k = 0; k < 4; k++) v += a[k * 4 + f] * b[c * 4 + k];
    o[c * 4 + f] = v;
  }
  return o;
};
const aplicar = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

function recogerTriangulos(json, bin) {
  const tris = [];
  const escena = json.scenes?.[json.scene ?? 0];
  const raices = escena?.nodes ?? json.nodes.map((_, i) => i);
  const IDENT = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

  function anda(idx, padre) {
    const nodo = json.nodes[idx];
    if (!nodo) return;
    const m = mul(padre, componer(nodo));
    if (nodo.mesh !== undefined) {
      for (const prim of json.meshes[nodo.mesh].primitives) {
        if (prim.mode !== undefined && prim.mode !== 4) continue;   // solo triángulos
        const pos = leerAccessor(json, bin, prim.attributes.POSITION);
        const idc = prim.indices !== undefined
          ? leerAccessor(json, bin, prim.indices)
          : Float64Array.from({ length: pos.length / 3 }, (_, i) => i);
        for (let i = 0; i + 2 < idc.length; i += 3) {
          tris.push([0, 1, 2].map((k) => {
            const j = idc[i + k] * 3;
            return aplicar(m, [pos[j], pos[j + 1], pos[j + 2]]);
          }));
        }
      }
    }
    for (const h of nodo.children || []) anda(h, m);
  }
  for (const r of raices) anda(r, IDENT);
  return tris;
}

/* ---------- muestreo por área ---------- */
const area = (t) => {
  const u = [t[1][0]-t[0][0], t[1][1]-t[0][1], t[1][2]-t[0][2]];
  const v = [t[2][0]-t[0][0], t[2][1]-t[0][1], t[2][2]-t[0][2]];
  const c = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
  return Math.hypot(c[0], c[1], c[2]) / 2;
};

function muestrear(tris, n, semilla = 12345) {
  let s = semilla;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const acum = []; let total = 0;
  for (const t of tris) { total += area(t); acum.push(total); }
  if (!(total > 0)) throw new Error('la malla no tiene superficie');

  const pts = [];
  for (let i = 0; i < n; i++) {
    const d = rnd() * total;
    let lo = 0, hi = acum.length - 1;               // binaria: con 300k triángulos, lineal no acaba
    while (lo < hi) { const m = (lo + hi) >> 1; if (acum[m] < d) lo = m + 1; else hi = m; }
    const t = tris[lo];
    let a = rnd(), b = rnd();
    if (a + b > 1) { a = 1 - a; b = 1 - b; }         // pliegue: reparto uniforme en el triángulo
    const c = 1 - a - b;
    pts.push([
      t[0][0]*c + t[1][0]*a + t[2][0]*b,
      t[0][1]*c + t[1][1]*a + t[2][1]*b,
      t[0][2]*c + t[1][2]*a + t[2][2]*b,
    ]);
  }
  return pts;
}

/* ---------- normalizado: centrado y a radio 1 ---------- */
function normalizar(pts) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let k = 0; k < 3; k++) { if (p[k] < lo[k]) lo[k] = p[k]; if (p[k] > hi[k]) hi[k] = p[k]; }
  const c = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
  const r = Math.max(...[0, 1, 2].map((k) => (hi[k] - lo[k]) / 2)) || 1;
  return { pts: pts.map((p) => p.map((v, k) => (v - c[k]) / r)), caja: [lo, hi] };
}

/* ---------- salida ---------- */
const [, , archivo, nStr] = process.argv;
if (!archivo) { console.error('uso: node tools/glb-a-puntos.mjs <malla.glb> [nPuntos]'); process.exit(1); }
const n = Math.max(200, Math.min(20000, parseInt(nStr || '4200', 10)));

const { json, bin } = leerGlb(fs.readFileSync(archivo));
if (!bin) throw new Error('GLB sin chunk binario (¿es un .gltf con buffers externos?)');
const tris = recogerTriangulos(json, bin);
const { pts, caja } = normalizar(muestrear(tris, n));

const plano = new Float32Array(pts.length * 3);
pts.forEach((p, i) => { plano[i*3] = p[0]; plano[i*3+1] = p[1]; plano[i*3+2] = p[2]; });

console.error(`triángulos: ${tris.length}  ·  puntos: ${pts.length}  ·  caja original: ` +
  caja.map((c) => c.map((v) => v.toFixed(2)).join(',')).join(' → '));
process.stdout.write(JSON.stringify({
  n: pts.length,
  b64: Buffer.from(plano.buffer).toString('base64'),
}));
