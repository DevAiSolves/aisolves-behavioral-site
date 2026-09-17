# Medir el sitio

Cuatro guiones para responder con números a "¿va rápido?" y "¿el scroll va
suave?". Todos usan el Chrome que ya está instalado, en modo headless, contra un
servidor local.

## Antes de nada

```bash
npm i --prefix tools/medir puppeteer-core
python3 -m http.server 8200 --directory .
```

## Los cuatro

| guion | responde a |
|---|---|
| `medir.mjs` | las cifras de carga y de scroll, en una pasada |
| `perfil.mjs` | qué funciones se comen el hilo principal mientras se baja la página |
| `experimento.mjs` | cuánto cuesta cada pieza: la apaga en caliente y vuelve a medir |
| `saltos.mjs` | qué se mueve solo durante la carga (CLS) y quién lo mueve |

```bash
node tools/medir/medir.mjs       http://localhost:8200/aisolves-site.html base
node tools/medir/perfil.mjs      http://localhost:8200/aisolves-site.html perfil
node tools/medir/experimento.mjs http://localhost:8200/aisolves-site.html
node tools/medir/saltos.mjs      http://localhost:8200/aisolves-site.html
```

## SIN_GL=1

Con esta variable se apaga WebGL. No es un capricho: en un Mac sin pantalla
Chrome resuelve WebGL por software, y ocho mil puntos por fotograma en la CPU
tapan cualquier otra medida. Apagándolo, el hero cae a su respaldo en canvas 2D
y lo que queda es el coste real de hilo principal, que casi siempre es lo que se
quiere comparar. Sin la bandera se mide el camino completo.

```bash
SIN_GL=1 node tools/medir/medir.mjs http://localhost:8200/aisolves-site.html base
```

## Dos avisos, por experiencia

- **Mide con la máquina quieta.** Varias instancias de Chrome a la vez cambian
  las cifras de scroll por un factor de dos. Si hay que comparar dos versiones,
  álternalas en la misma tanda en vez de medir una y luego la otra.
- **Los fotogramas por segundo de aquí no son los del visitante.** Sin tarjeta
  gráfica, el desenfoque de fondo y el compositor cuestan mucho más de lo que
  costarán en un portátil normal. Sirven para comparar antes y después, no para
  prometer una cifra.
