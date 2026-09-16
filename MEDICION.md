# Medición: Meta, Google y WhatsApp

Cómo encender la capa de tracking y la entrega por WhatsApp. Hoy está montada y
**apagada a propósito**: sin identificadores no se carga ninguna etiqueta y no
sale ni una petición.

---

## El reparto: qué va en la página y qué va en el servidor

| | Dónde vive | Por qué |
|---|---|---|
| Pixel de Meta, GA4, Google Ads | `aisolves-site.html` | Son IDs públicos por diseño |
| Consent Mode v2 | `aisolves-site.html`, en el `<head>` | Debe declararse **antes** de que cargue ninguna etiqueta |
| Token de la CAPI | `/api/capi` (Vercel) | Un token en el HTML lo lee cualquiera con Ctrl+U, y Meta lo revoca |
| Token de WhatsApp | `/api/whatsapp` (Vercel) | Igual: es un token permanente con permiso para enviar mensajes |
| Teléfono real del lead | `/api/lead` → tu CRM | A las plataformas va cifrado; al CRM va en claro, porque hay que llamar |

Esa separación no es un detalle de estilo. Es la razón de que existan las
funciones de `/api`.

---

## 1. Pegar los identificadores

Único sitio: el bloque `window.AIS_TAGS` al principio de `aisolves-site.html`.

```js
window.AIS_TAGS = {
  metaPixelId   : '1234567890123456',
  ga4Id         : 'G-XXXXXXXXXX',
  googleAdsId   : 'AW-XXXXXXXXX',
  googleAdsLead : 'AW-XXXXXXXXX/AbC-D_efGh',
  capiEndpoint  : '/api/capi',
  waEndpoint    : '/api/whatsapp',
  leadEndpoint  : '/api/lead',
  vistaClave    : 'Paquetes'
};
```

Cada campo que dejes vacío desactiva su parte. Puedes encender solo el pixel de
navegador y dejar la CAPI para después.

## 2. Variables de entorno en Vercel

Copia `.env.example` a las variables del proyecto. `.env` está en `.gitignore`:
no subas tokens al repositorio nunca.

Para el seguimiento de estado hace falta **Vercel KV** (Marketplace → Upstash
Redis). Sin él los mensajes se envían igual, pero el reporte se queda en
"enviado" y no avanza a entregado ni leído.

## 3. La plantilla de WhatsApp — esto es lo que suele fallar

Un mensaje que **inicia el negocio** solo puede ser una plantilla aprobada. La
ventana de 24 horas de texto libre se abre cuando la persona escribe primero al
número, y aquí eso no pasa nunca: el visitante deja su teléfono en un
formulario. Si se intenta mandar texto libre, Meta responde error `131047` y el
mensaje no sale.

Crea la plantilla en WhatsApp Manager, categoría **UTILITY**, y espera su
aprobación:

```
Nombre: reporte_visita
Cuerpo: Hola {{1}}, aquí tienes el informe de tu visita a AISOLVES.
        Puntuación de comportamiento: {{2}}/100.
        Responde a este mensaje si quieres que lo repasemos juntos.
```

El informe completo no cabe ahí (Meta rechaza parámetros con saltos de línea).
La plantilla abre la conversación; cuando la persona responde, la ventana de 24 h
queda abierta y ya puedes mandar el texto completo con `WA_PERMITIR_TEXTO=1`.

## 4. Webhook de estados

Meta → tu app → WhatsApp → Configuración → Webhooks:

- URL: `https://TU-DOMINIO/api/whatsapp-webhook`
- Token de verificación: el mismo valor que pusiste en `WA_VERIFY_TOKEN`
- Campo a suscribir: **messages** (hay que marcarlo explícitamente)

Sin esto, los cuatro estados del reporte no pueden ser ciertos.

---

## Qué se mide y cuándo

Los eventos salen de los que ya emite el núcleo de comportamiento, no de clics
sueltos:

| Cuándo | Meta | GA4 | Google Ads |
|---|---|---|---|
| Acepta el consentimiento | `PageView` | `page_view` | — |
| Entra en la etapa clave | `ViewContent` | `view_item` | — |
| El score cambia de banda | `AIS_LeadSignal` | `lead_signal` | — |
| Deja su WhatsApp | `Lead` | `generate_lead` | conversión |
| Abre el chat | `Contact` | `contact` | — |

`ViewContent` se dispara **una sola vez** y solo en la etapa que marques en
`vistaClave`. Un `ViewContent` por sección convertiría la señal en ruido.

### Deduplicación

Cada evento lleva un `event_id` único que viaja **idéntico** por el pixel y por
la CAPI. Meta reconoce que son el mismo hecho y se queda con la señal más
completa. Si el id no viaja igual, el resultado no es "más datos": son
conversiones infladas.

Verificado en el navegador: los cuatro eventos de una sesión salieron con el
mismo id por los dos caminos.

### Datos personales

El teléfono y el email se normalizan y se cifran con SHA-256 **en el navegador**,
antes de salir. `/api/capi` descarta cualquier campo que no sea un hash válido de
64 caracteres: un dato en claro no se reenvía a Meta aunque llegue. La IP y el
user-agent los añade el servidor, que es quien los ve de verdad.

---

## Dos cosas que conviene saber

**Los cuatro estados de entrega son una simulación hasta que configures
`waEndpoint`.** Sin endpoint, el reporte marca "Confirmado · demostración" y el
aviso dice que no se ha enviado nada. Con endpoint, los estados vienen del
webhook de WhatsApp y son reales. No quise dejar una animación que afirmara
"Entregado" sin que nada se hubiera entregado.

**El camino de ManyChat no está probado.** `/api/whatsapp` soporta
`WA_PROVEEDOR=manychat`, pero ManyChat cambia su API con frecuencia y no he
podido contrastarlo contra una cuenta real: verifica los nombres de campo con su
documentación antes de darlo por bueno. El camino probado es el de Cloud API.

---

## Comprobar que funciona

1. **Pixel**: extensión *Meta Pixel Helper*. Antes de aceptar el consentimiento
   no debe registrar nada; ese es el comportamiento correcto.
2. **CAPI**: Events Manager → Probar eventos, con `META_TEST_EVENT_CODE` puesto.
   Deberías ver el evento del navegador y el del servidor **fusionados**. Si
   aparecen separados, el `event_id` no está viajando igual.
   Quita el código de prueba al terminar: con él los eventos no optimizan.
3. **Consent Mode**: en la consola, `dataLayer` debe abrir con un
   `consent default` en `denied`.
4. **WhatsApp**: manda uno a tu propio número. Si responde `131047`, es la
   ventana de 24 h — usa plantilla.
