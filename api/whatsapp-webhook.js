/* ============================================================================
   /api/whatsapp-webhook — confirmaciones de entrega de WhatsApp.
   ----------------------------------------------------------------------------
   Es lo que convierte los cuatro estados del reporte (enviado, entregado,
   leído) en algo cierto. Sin esta función el sitio solo puede afirmar que
   entregó el mensaje porque ha pasado el tiempo, que es justo la clase de
   promesa que esta web dice no hacer.

   GET   verificación inicial que pide Meta al guardar la URL del webhook.
   POST  eventos de estado: sent | delivered | read | failed.

   Configurar en Meta → tu app → WhatsApp → Configuración → Webhooks:
     URL      https://TU-DOMINIO/api/whatsapp-webhook
     Token    el mismo valor que WA_VERIFY_TOKEN
     Campo    messages   (hay que suscribirlo explícitamente)

   Variables de entorno:
     WA_VERIFY_TOKEN   cadena que tú inventas; solo sirve para este apretón
     WA_APP_SECRET     secreto de la app; con él se comprueba la firma
   ========================================================================== */

import crypto from 'node:crypto';
import { resolver, actualizar } from '../lib/estado.js';

export const config = { api: { bodyParser: false } };   // la firma se calcula sobre el cuerpo crudo

function crudo(req) {
  return new Promise((resolve, reject) => {
    const trozos = [];
    req.on('data', (c) => trozos.push(c));
    req.on('end', () => resolve(Buffer.concat(trozos)));
    req.on('error', reject);
  });
}

/* Esta URL es pública: sin comprobar la firma, cualquiera podría anunciar que
   un reporte fue "leído". timingSafeEqual para no filtrar el secreto por el
   tiempo que tarda la comparación. */
function firmaValida(buf, cabecera, secreto) {
  if (!secreto) return false;
  if (typeof cabecera !== 'string' || !cabecera.startsWith('sha256=')) return false;
  const esperado = 'sha256=' + crypto.createHmac('sha256', secreto).update(buf).digest('hex');
  const a = Buffer.from(cabecera), b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const q = req.query || {};
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(q['hub.challenge']);
    }
    return res.status(403).send('forbidden');
  }

  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const buf = await crudo(req);

  if (!firmaValida(buf, req.headers['x-hub-signature-256'], process.env.WA_APP_SECRET)) {
    console.warn('[wa-webhook] firma inválida, descartado');
    return res.status(401).json({ ok: false });
  }

  let cuerpo;
  try { cuerpo = JSON.parse(buf.toString('utf8')); } catch { return res.status(400).json({ ok: false }); }

  /* Meta reintenta si no recibe un 200, así que un fallo nuestro procesando un
     evento no debe convertirse en una tormenta de reintentos: se registra y se
     acusa recibo igual. */
  try {
    for (const entrada of cuerpo.entry || []) {
      for (const cambio of entrada.changes || []) {
        for (const st of cambio.value?.statuses || []) {
          const id = await resolver(st.id);
          if (!id) continue;                       // no es un mensaje nuestro
          const parche = { status: st.status };
          if (st.status === 'failed') parche.error = st.errors?.[0]?.title || 'failed';
          await actualizar(id, parche);
        }
      }
    }
  } catch (e) {
    console.error('[wa-webhook] error procesando', e);
  }

  return res.status(200).json({ ok: true });
}
