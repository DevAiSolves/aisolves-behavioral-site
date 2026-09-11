# AISOLVES — Behavioral Growth OS

Sitio de una página para AISOLVES con motor de comportamiento en vivo.
Rediseño sobre un lenguaje visual tipo *creative developer*: fondo claro, rejilla
modular, tipografía Montserrat ultrafina en mayúsculas y anotaciones CSS en vivo.

## Archivo principal

`aisolves-site.html` — autónomo. No necesita build ni servidor: se abre directamente.
La única dependencia externa es Google Fonts (Montserrat + IBM Plex Mono).

## Qué hace

**Tracking conductual de primera parte.** Tras el consentimiento explícito mide
recorrido por sección, tiempo de atención real, profundidad de scroll, hover sobre
precios, rage clicks e intención de salida. Mide comportamiento, nunca el contenido
que la persona escribe.

**Lead scoring en vivo (0-100).** Cuatro dimensiones: Intención 0-40, Engagement 0-25,
Fit 0-20 e Identidad 0-15. Bandas COLD → WARM → HOT → MQL → SQL.

**Seis formatos de modal de comportamiento**, navegables en el carrusel de Selected Work:
Center Spotlight, Drawer lateral, Bottom sheet, Toast expandible, Inline expand y
Full-screen takeover. Cada uno se abre en vivo con los datos reales de la sesión.

**Entrega por WhatsApp con estados.** Generado → Enviando → Entregado → Confirmado.
El botón sólo pasa a verde cuando llega la confirmación de recepción.

**Motion.** Esfera de partículas en canvas (6.000 puntos, espiral de Fibonacci con ruido
diagonal), engranajes generados por código y anotaciones CSS que muestran los valores
reales de la animación mientras se mueve.

## Conectar WhatsApp de verdad

Hoy los estados de entrega están simulados con temporizadores. Para producción:

```javascript
const CONFIG = {
  businessWhatsApp: "34600000000",   // ← número real de WhatsApp Business
  reportEndpoint: "/api/send-report" // ← endpoint server-side
};
```

El endpoint debe llamar a la WhatsApp Business Cloud API con una plantilla aprobada.
Los cuatro estados los dispara el webhook de status (`sent` → `delivered` → `read`),
llamando a `setStep(...)`. `read` es el que pinta el botón en verde.

## Privacidad

Consent Mode v2 en denegado por defecto. Nada de tracking personalizado antes del
consentimiento. Sin login ni contraseñas. El WhatsApp sólo se captura si la persona
lo entrega para pedir el reporte. Revocable.
