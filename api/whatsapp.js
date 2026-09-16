/* ============================================================================
   /api/whatsapp — envía el reporte de la visita y responde por su estado.
   ----------------------------------------------------------------------------
   POST  { lead:{name,wa,email}, report, score, lang }  ->  { ok:true, id }
   GET   ?id=…                                          ->  { ok:true, status }

   LO QUE HAY QUE SABER ANTES DE TOCAR ESTO
   ----------------------------------------
   Un mensaje que inicia el negocio SOLO puede ser una plantilla aprobada.
   La ventana de 24 horas de texto libre se abre cuando la persona escribe
   PRIMERO al número, y aquí eso no ha pasado nunca: el visitante dejó su
   teléfono en un formulario de la web. Si se intenta mandar texto libre, Meta
   responde 131047 y el mensaje no sale.

   Por eso el camino por defecto es plantilla. Hay que crearla en el WhatsApp
   Manager, categoría UTILITY, y esperar su aprobación. Una que encaja:

     Nombre: reporte_visita
     Cuerpo: Hola {{1}}, aquí tienes el informe de tu visita a AISOLVES.
             Puntuación de comportamiento: {{2}}/100.
             Responde a este mensaje si quieres que lo repasemos juntos.

   El informe completo NO cabe en una plantilla con parámetros cortos, y Meta
   rechaza parámetros con saltos de línea. Así que la plantilla avisa y abre la
   conversación; en cuanto la persona responde se abre la ventana de 24 h y el
   texto completo ya se puede mandar libremente (WA_PERMITIR_TEXTO=1).

   Variables de entorno:
     WA_PROVEEDOR         'cloud' (por defecto) | 'manychat'
     WA_PHONE_NUMBER_ID   id del número emisor (Cloud API)
     WA_TOKEN             token permanente del System User
     WA_PLANTILLA         nombre de la plantilla aprobada  (def. reporte_visita)
     WA_PLANTILLA_LANG    código de idioma de la plantilla (def. es)
     WA_PERMITIR_TEXTO    '1' para mandar texto libre en vez de plantilla
     MANYCHAT_TOKEN       solo si WA_PROVEEDOR=manychat
   ========================================================================== */

import { guardar, leer, enlazar, hayAlmacen } from '../lib/estado.js';

const API = 'https://graph.facebook.com/v21.0';

const soloDigitos = (t) => String(t || '').replace(/[^0-9]/g, '');
const nuevoId = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* --------------------------------------------------------------- Cloud API */
async function porCloudApi({ telefono, nombre, score, informe, lang }) {
  const ID = process.env.WA_PHONE_NUMBER_ID;
  const TOKEN = process.env.WA_TOKEN;
  if (!ID || !TOKEN) throw Object.assign(new Error('not_configured'), { code: 'not_configured' });

  const libre = process.env.WA_PERMITIR_TEXTO === '1';
  const cuerpo = libre
    ? { messaging_product: 'whatsapp', to: telefono, type: 'text', text: { preview_url: false, body: informe } }
    : {
        messaging_product: 'whatsapp',
        to: telefono,
        type: 'template',
        template: {
          name: process.env.WA_PLANTILLA || 'reporte_visita',
          language: { code: process.env.WA_PLANTILLA_LANG || (lang === 'en' ? 'en' : 'es') },
          components: [{
            type: 'body',
            parameters: [
              { type: 'text', text: String(nombre || '').slice(0, 60) || 'hola' },
              { type: 'text', text: String(score ?? 0) },
            ],
          }],
        },
      };

  const r = await fetch(`${API}/${encodeURIComponent(ID)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const det = j?.error || {};
    console.error('[whatsapp] cloud rechazó', r.status, det.code, det.message);
    // 131047 = fuera de la ventana de 24 h: el aviso más útil que podemos dar.
    const code = det.code === 131047 ? 'fuera_de_ventana' : 'upstream_rejected';
    throw Object.assign(new Error(code), { code });
  }
  return j?.messages?.[0]?.id || null;   // wamid, el que traerá el webhook
}

/* ---------------------------------------------------------------- ManyChat */
/* ManyChat cambia su API con más frecuencia que Meta y no la he podido probar
   contra una cuenta real: trata esto como un punto de partida y contrasta los
   nombres de campo con su documentación antes de darlo por bueno. El camino
   probado de los dos es el de Cloud API. */
async function porManychat({ telefono, informe }) {
  const TOKEN = process.env.MANYCHAT_TOKEN;
  if (!TOKEN) throw Object.assign(new Error('not_configured'), { code: 'not_configured' });

  const cab = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

  const busca = await fetch(
    `https://api.manychat.com/fb/subscriber/findByCustomField?field_id=phone&field_value=${encodeURIComponent(telefono)}`,
    { headers: cab }
  ).then((r) => r.json()).catch(() => null);

  const suscriptor = busca?.data?.[0]?.id;
  if (!suscriptor) throw Object.assign(new Error('suscriptor_no_encontrado'), { code: 'suscriptor_no_encontrado' });

  const r = await fetch('https://api.manychat.com/fb/sending/sendContent', {
    method: 'POST',
    headers: cab,
    body: JSON.stringify({
      subscriber_id: suscriptor,
      data: { version: 'v2', content: { messages: [{ type: 'text', text: informe }] } },
      message_tag: 'ACCOUNT_UPDATE',
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.status === 'error') {
    console.error('[whatsapp] manychat rechazó', r.status, JSON.stringify(j));
    throw Object.assign(new Error('upstream_rejected'), { code: 'upstream_rejected' });
  }
  return null;   // ManyChat no devuelve wamid: el estado se queda en "enviado"
}

/* ------------------------------------------------------------------ handler */
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    const id = req.query?.id;
    if (!id) return res.status(400).json({ ok: false, error: 'falta id' });
    const e = await leer(String(id)).catch(() => null);
    return res.status(200).json({ ok: true, status: e?.status || 'unknown' });
  }

  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }

  const telefono = soloDigitos(body?.lead?.wa);
  if (telefono.length < 8) return res.status(400).json({ ok: false, error: 'telefono_invalido' });

  const id = nuevoId();
  const datos = {
    telefono, nombre: body?.lead?.name || '', score: body?.score ?? 0,
    informe: String(body?.report || ''), lang: body?.lang === 'en' ? 'en' : 'es',
  };

  try {
    const proveedor = (process.env.WA_PROVEEDOR || 'cloud').toLowerCase();
    const wamid = proveedor === 'manychat' ? await porManychat(datos) : await porCloudApi(datos);

    if (hayAlmacen) {
      await guardar(id, { status: 'sent', wamid, telefono, createdAt: Date.now() });
      if (wamid) await enlazar(wamid, id);
    }
    // Sin KV el envío funciona igual; lo que no hay es seguimiento de estado.
    return res.status(200).json({ ok: true, id, tracking: hayAlmacen });
  } catch (e) {
    const code = e?.code || 'error';
    return res.status(code === 'not_configured' ? 503 : 502).json({ ok: false, error: code });
  }
}
