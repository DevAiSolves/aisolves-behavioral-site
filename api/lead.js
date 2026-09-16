/* ============================================================================
   /api/lead — alta del lead en el CRM.
   ----------------------------------------------------------------------------
   Punto único de entrada de los leads de la web. Reenvía a donde tengas el
   CRM (CRM_WEBHOOK) y, mientras lo construyes, deja constancia en KV para que
   ningún lead se pierda por no tener el destino todavía.

   Va aparte de /api/capi a propósito: a Meta viaja el dato cifrado, y al CRM
   el teléfono real, porque es el que hace falta para llamar. Mezclar las dos
   salidas en una función es cómo acaba un teléfono en claro en una plataforma
   publicitaria.

   Variables de entorno:
     CRM_WEBHOOK       URL de tu CRM / automatización (opcional mientras tanto)
     CRM_TOKEN         opcional; viaja como Bearer
     LEAD_ORIGENES     dominios permitidos separados por comas
   ========================================================================== */

import { guardar, hayAlmacen } from '../lib/estado.js';

const soloDigitos = (t) => String(t || '').replace(/[^0-9]/g, '');

/* El endpoint es público y acepta POST: sin esto cualquiera puede llenar el
   CRM de basura desde una pestaña. No es autenticación, pero corta el ruido. */
function origenPermitido(req) {
  const lista = (process.env.LEAD_ORIGENES || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!lista.length) return true;                       // sin configurar, no bloquea
  const o = req.headers.origin || '';
  return lista.some((p) => o === p || o.endsWith('.' + p.replace(/^https?:\/\//, '')));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  if (!origenPermitido(req)) return res.status(403).json({ ok: false, error: 'origen_no_permitido' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }

  const lead = body?.lead || {};
  const telefono = soloDigitos(lead.wa || lead.phone);
  if (!telefono && !lead.email) return res.status(400).json({ ok: false, error: 'sin_contacto' });

  const registro = {
    nombre: String(lead.name || '').slice(0, 120),
    telefono,
    email: String(lead.email || '').trim().toLowerCase().slice(0, 160),
    score: Number(body?.score) || 0,
    url: String(body?.url || '').slice(0, 500),
    referrer: String(body?.referrer || '').slice(0, 500),
    ts: Number(body?.ts) || Date.now(),
    origen: 'aisolves-site',
  };

  let entregado = false;
  if (process.env.CRM_WEBHOOK) {
    try {
      const cab = { 'Content-Type': 'application/json' };
      if (process.env.CRM_TOKEN) cab.Authorization = `Bearer ${process.env.CRM_TOKEN}`;
      const r = await fetch(process.env.CRM_WEBHOOK, { method: 'POST', headers: cab, body: JSON.stringify(registro) });
      entregado = r.ok;
      if (!r.ok) console.error('[lead] el CRM respondió', r.status);
    } catch (e) {
      console.error('[lead] CRM inalcanzable', e);
    }
  }

  /* Si el CRM no está listo o no contestó, el lead queda guardado. Perder un
     lead por un webhook caído es el peor fallo posible de esta función. */
  if (!entregado && hayAlmacen) {
    await guardar('lead-' + registro.ts + '-' + telefono.slice(-4), { ...registro, pendiente: true }).catch(() => {});
  }

  // Se responde ok siempre: el visitante ya hizo su parte, y el navegador no
  // debe enterarse de que el CRM está caído.
  return res.status(200).json({ ok: true, forwarded: entregado });
}
