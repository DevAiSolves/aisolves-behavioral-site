/* ============================================================================
   construir — versión de publicación del sitio: la misma página, sin comentarios.

   El archivo fuente lleva más de 100 KB de comentarios en español que explican
   por qué está hecho cada cosa. Valen su peso mientras se trabaja en él; no
   valen nada en el navegador de un cliente, donde son bytes que hay que
   descargar antes de ver la página.

   Así que el fuente se queda como está —es el original— y esto produce el
   gemelo que se publica. No minifica nada más: no renombra, no reordena, no
   toca una sola línea de código. Quitar comentarios es la única
   transformación que no puede cambiar el comportamiento.

   Y aun así se comprueba: cada <script> se vuelve a parsear después de
   limpiarlo y, si algo falla —un '/*' dentro de una cadena, por ejemplo—, ese
   bloque se deja tal cual venía. Mejor unos bytes de más que una página rota.

   Va en Node y no en Python porque esto también corre en el servidor de
   compilación de Vercel, donde Node es lo único garantizado.

   Uso:  node tools/construir.mjs [entrada.html] [salida.html]
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

/* fileURLToPath y no url.pathname: la carpeta del proyecto lleva un espacio en
   el nombre y pathname lo devuelve como %20, que no existe en el disco. */
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRADA = process.argv[2] || path.join(RAIZ, 'aisolves-site.html');
const SALIDA = process.argv[3] || path.join(RAIZ, 'aisolves-site.pub.html');

/* ¿sigue siendo JavaScript válido? Compilar sin ejecutar es el equivalente a
   `node --check`, pero sin escribir un archivo temporal por bloque. */
function parsea(js) {
  try { new vm.Script(js); return true; } catch { return false; }
}

const limpiaJs = (js) => js
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/[^\n]*\n/gm, '')     // solo líneas que EMPIEZAN por //: una URL nunca se toca
  .replace(/\n[ \t]*\n+/g, '\n');

const limpiaCss = (css) => css
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\n[ \t]*\n+/g, '\n');

const doc = fs.readFileSync(ENTRADA, 'utf8');
let saltados = 0;

let pub = doc.replace(/<(style|script)([^>]*)>([\s\S]*?)<\/\1>/g, (todo, etiqueta, attrs, cuerpo) => {
  if (etiqueta === 'style') return `<style${attrs}>${limpiaCss(cuerpo)}</style>`;
  if (/json|text\/plain/.test(attrs)) return todo;          // datos, no código
  const limpio = limpiaJs(cuerpo);
  if (!parsea(limpio)) { saltados++; return todo; }
  return `<script${attrs}>${limpio}</script>`;
});

/* comentarios del marcado: fuera también, salvo los condicionales */
pub = pub.replace(/<!--(?!\[if)[\s\S]*?-->/g, '').replace(/\n[ \t]*\n+/g, '\n');

fs.writeFileSync(SALIDA, pub);
const gz = (s) => zlib.gzipSync(Buffer.from(s), { level: 9 }).length;
console.log(`${path.basename(ENTRADA)} ${Buffer.byteLength(doc)} B (gzip ${gz(doc)}) → ` +
  `${path.basename(SALIDA)} ${Buffer.byteLength(pub)} B (gzip ${gz(pub)})  ·  ` +
  `-${Buffer.byteLength(doc) - Buffer.byteLength(pub)} B  ·  bloques intactos por precaución: ${saltados}`);
