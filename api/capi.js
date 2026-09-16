/* ============================================================================
   /api/capi — relay a la Conversions API de Meta.
   ----------------------------------------------------------------------------
   Existe por una sola razón: el token de la CAPI no puede estar en el
   navegador. aisolves-site.html lo sirve cualquiera con Ctrl+U, y Meta revoca
   un token en cuanto lo ve publicado. Aquí vive en una variable de entorno.

   La deduplicación es el punto entero de esta función. El navegador manda el
   evento al pixel con un eventID; esta función manda EL MISMO event_id a la
   CAPI. Meta ve los dos, reconoce que son el mismo hecho y se queda con la
   señal más completa en vez de contarlo dos veces. Si el event_id no viaja
   idéntico, el resultado no es "más datos": son conversiones infladas.

   La IP y el user-agent se leen aquí, no se aceptan del cliente: son justo los
   dos datos que el navegador podría falsear y que el servidor sí ve de verdad.

   Variables de entorno:
     META_PIXEL_ID         id del pixel
     META_CAPI_TOKEN       token de acceso (System User, permiso ads_management)
     META_TEST_EVENT_CODE  opcional, solo mientras se valida en el Events Manager
   ========================================================================== */

const API = 'https://graph.facebook.com/v21.0';

/* Los campos de user_data que Meta espera ya cifrados en SHA-256. El cliente
   los manda cifrados; esto solo comprueba la forma, nunca cifra un dato en
   claro que no debería haber llegado. */
const HASHED = ['em', 'ph', 'fn', 'ln', 'ct', 'st', 'zp', 'country', 'external_id'];
const PLANO = ['fbp', 'fbc'];
const esHash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);

function ipDe(req) {
  const ff = req.headers['x-forwarded-for'];
  if (typeof ff === 'string' && ff) return ff.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || undefined;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const PIXEL = process.env.META_PIXEL_ID;
  const TOKEN = process.env.META_CAPI_TOKEN;
  if (!PIXEL || !TOKEN) {
    // Sin configurar no es un error del visitante: se acepta y se descarta.
    return res.status(200).json({ ok: true, skipped: 'not_configured' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || !body.event_name || !body.event_id) {
    return res.status(400).json({ ok: false, error: 'event_name y event_id son obligatorios' });
  }

  const entrada = body.user_data || {};
  const user_data = {
    client_ip_address: ipDe(req),
    client_user_agent: req.headers['user-agent'],
  };
  for (const k of HASHED) if (esHash(entrada[k])) user_data[k] = entrada[k];
  for (const k of PLANO) if (typeof entrada[k] === 'string' && entrada[k]) user_data[k] = entrada[k];

  const evento = {
    event_name: String(body.event_name),
    event_time: Number(body.event_time) || Math.floor(Date.now() / 1000),
    event_id: String(body.event_id),                 // el mismo que usó el pixel
    event_source_url: body.event_source_url,
    action_source: 'website',
    user_data,
    custom_data: body.custom_data || {},
  };

  const carga = { data: [evento] };
  if (process.env.META_TEST_EVENT_CODE) carga.test_event_code = process.env.META_TEST_EVENT_CODE;

  try {
    const r = await fetch(`${API}/${encodeURIComponent(PIXEL)}/events?access_token=${encodeURIComponent(TOKEN)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(carga),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      // El detalle de Meta se registra, no se devuelve: puede describir la cuenta.
      console.error('[capi] rechazado', r.status, JSON.stringify(j));
      return res.status(502).json({ ok: false, error: 'upstream_rejected' });
    }
    return res.status(200).json({ ok: true, received: j.events_received ?? 1 });
  } catch (e) {
    console.error('[capi] fallo de red', e);
    return res.status(502).json({ ok: false, error: 'upstream_unreachable' });
  }
}
