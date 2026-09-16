/* ============================================================================
   lib/estado — memoria compartida del estado de cada envío.
   ----------------------------------------------------------------------------
   Hace falta porque quien envía el mensaje (/api/whatsapp) y quien recibe las
   confirmaciones (/api/whatsapp-webhook) son dos invocaciones distintas, en
   máquinas distintas, que no comparten nada.

   Por eso NO hay respaldo en memoria. Un `const mapa = new Map()` funcionaría
   en local y fallaría en producción de forma silenciosa: el webhook escribiría
   en una instancia y la consulta leería otra, así que el reporte se quedaría
   siempre en "enviado" sin que nada pareciera roto. Preferimos que falte la
   configuración y se note.

   Requiere Vercel KV (Marketplace → Upstash Redis). Al conectarlo, Vercel
   inyecta KV_REST_API_URL y KV_REST_API_TOKEN solo.
   ========================================================================== */

const URL_KV = process.env.KV_REST_API_URL;
const TOKEN_KV = process.env.KV_REST_API_TOKEN;

export const hayAlmacen = !!(URL_KV && TOKEN_KV);

/* Una hora de vida: pasado ese punto el reporte ya se entregó o ya no va a
   entregarse, y guardar teléfonos más tiempo del necesario no aporta nada. */
const TTL = 3600;

async function kv(comando) {
  const r = await fetch(URL_KV, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN_KV}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(comando),
  });
  if (!r.ok) throw new Error(`kv ${r.status}`);
  const j = await r.json();
  return j.result;
}

export async function guardar(id, datos) {
  if (!hayAlmacen) return false;
  await kv(['SET', `wa:${id}`, JSON.stringify(datos), 'EX', String(TTL)]);
  return true;
}

export async function leer(id) {
  if (!hayAlmacen) return null;
  const v = await kv(['GET', `wa:${id}`]);
  if (!v) return null;
  try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; }
}

export async function actualizar(id, parche) {
  const actual = (await leer(id)) || {};
  const nuevo = { ...actual, ...parche, updatedAt: Date.now() };
  await guardar(id, nuevo);
  return nuevo;
}

/* El id que da WhatsApp (wamid…) es el que llega en el webhook, pero el
   cliente conoce el nuestro. Este índice une los dos. */
export async function enlazar(wamid, id) {
  if (!hayAlmacen || !wamid) return false;
  await kv(['SET', `wamid:${wamid}`, id, 'EX', String(TTL)]);
  return true;
}

export async function resolver(wamid) {
  if (!hayAlmacen || !wamid) return null;
  return await kv(['GET', `wamid:${wamid}`]);
}
