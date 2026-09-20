#!/usr/bin/env python3
"""verificar — comprobaciones baratas sobre el archivo único, tras cada cambio.

   No sustituye a mirar la página: comprueba lo que un error de edición rompe
   sin avisar —un script que deja de parsear, una etiqueta descolocada, un
   módulo que desaparece— y da el tamaño para ver si el cambio ha servido.

   Uso:  python3 tools/verificar.py [archivo.html]
"""
import gzip
import json
import os
import re
import subprocess
import sys
import tempfile

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
RUTA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RAIZ, 'aisolves-site.html')
s = open(RUTA, encoding='utf-8').read()
fallos = []

# 1. Estructura del documento.
#    Cuidado: '</body>' y '<head>' aparecen también dentro de comentarios que
#    explican el marcado, así que lo que se comprueba es el cierre real: que la
#    última aparición de cada etiqueta esté donde tiene que estar y en orden.
orden = [s.find('<html'), s.find('<head>'), s.find('</head>'), s.find('<body'),
         s.rfind('</body>'), s.rfind('</html>')]
if -1 in orden:
    fallos.append('falta alguna etiqueta de estructura: ' + str(orden))
elif orden != sorted(orden):
    fallos.append('etiquetas de estructura desordenadas: ' + str(orden))
elif len(s) - orden[-1] > 200:
    fallos.append('</html> no está al final del archivo')

# 2. Cada <script> sin src vuelve a parsear; los de datos, a validarse como JSON.
scripts = list(re.finditer(r'<script(?![^>]*\bsrc=)([^>]*)>(.*?)</script>', s, re.S))
malos = []
for i, m in enumerate(scripts):
    tipo, cuerpo = m.group(1), m.group(2)
    if 'json' in tipo:
        try:
            json.loads(cuerpo)
        except Exception as e:
            malos.append(f'{i} (json): {e}')
        continue
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f:
        f.write(cuerpo)
        tmp = f.name
    r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True)
    os.unlink(tmp)
    if r.returncode:
        malos.append(f'{i}: ' + (r.stderr.strip().splitlines()[0] if r.stderr else '?'))
if malos:
    fallos.append('scripts que no parsean: ' + '; '.join(malos))

# 3. Las llaves del CSS cuadran en cada bloque.
estilos = list(re.finditer(r'<style[^>]*>(.*?)</style>', s, re.S))
for i, m in enumerate(estilos):
    c = m.group(1)
    if c.count('{') != c.count('}'):
        fallos.append(f'style {i}: {c.count("{")} llaves abiertas vs {c.count("}")} cerradas')

# 4. Piezas que tienen que seguir estando. Solo cadenas que viven en el CÓDIGO:
#    los comentarios desaparecen en la versión de publicación.
PRESENTES = ['id="heroSphere"', 'id="brainCanvas"', 'window.AIS', 'particleSphere',
             'initHero', 'ais-dic-en', 'AIS_T', 'class="hero"', 'id="pie"', 'openForm()',
             'AIS_SCROLL', 'animation-timeline', 'nav-prog', 'av-ini']
for p in PRESENTES:
    if p not in s:
        fallos.append(f'falta: {p}')

# 5. Rastros de datos de relleno que no deberían llegar a producción.
RELLENO = ['hola@aisolves.com', '+34 600 000 000</div>']
for p in RELLENO:
    if p in s:
        fallos.append(f'dato de relleno todavía presente: {p}')

raw = s.encode()
print(f'{os.path.basename(RUTA)}: {len(raw)} B  ·  gzip {len(gzip.compress(raw, 9))} B  ·  '
      f'{len(scripts)} scripts  ·  {len(estilos)} estilos')
if fallos:
    print('FALLOS:')
    for f_ in fallos:
        print(' ·', f_)
    sys.exit(1)
print('sin fallos')
