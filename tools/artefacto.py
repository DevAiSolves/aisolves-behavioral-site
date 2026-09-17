#!/usr/bin/env python3
"""artefacto — prepara el HTML para publicarlo como Artifact de claude.ai.

   El publicador envuelve lo que se le da en su propio <!doctype>, <head> y
   <body>, así que hay que entregarle el contenido pelado: sin doctype, sin
   <html>, sin las etiquetas de <head>/<body> ni el charset y el viewport, que
   los pone él.

   Dos trampas que ya costaron un rato:
   · '</body>' aparece también dentro de un comentario del propio documento, así
     que el cierre se busca SIEMPRE desde el final (rfind), nunca desde el principio.
   · Cada <script> se vuelve a comprobar con node --check al terminar: si el
     recorte se ha llevado algo por delante, se sabe aquí y no en el navegador.

   Uso:  python3 tools/artefacto.py [entrada.html] [salida.html]
"""
import os
import re
import subprocess
import sys
import tempfile

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
ENTRADA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RAIZ, 'aisolves-site.pub.html')
SALIDA = sys.argv[2] if len(sys.argv) > 2 else os.path.join(RAIZ, 'aisolves-artefacto.html')

s = open(ENTRADA, encoding='utf-8').read()
s = re.sub(r'^\s*<!DOCTYPE[^>]*>\s*', '', s, flags=re.I)
s = re.sub(r'^\s*<html[^>]*>\s*', '', s, count=1, flags=re.I)
s = re.sub(r'^\s*<head[^>]*>\s*', '', s, count=1, flags=re.I)
s = re.sub(r'<meta\s+charset[^>]*>\s*', '', s, flags=re.I)
s = re.sub(r'<meta\s+name="viewport"[^>]*>\s*', '', s, flags=re.I)
s = s.replace('</head>', '\n', 1)
s = re.sub(r'<body[^>]*>\s*', '', s, count=1, flags=re.I)
for cierre in ('</body>', '</html>'):
    i = s.rfind(cierre)                       # SIEMPRE desde el final
    if i != -1:
        s = s[:i] + s[i + len(cierre):]
s = s.strip() + '\n'
open(SALIDA, 'w', encoding='utf-8').write(s)

malos = 0
for i, js in enumerate(re.findall(r'<script(?![^>]*\bsrc=)(?![^>]*json)[^>]*>(.*?)</script>', s, re.S)):
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f:
        f.write(js)
        tmp = f.name
    if subprocess.run(['node', '--check', tmp], capture_output=True).returncode:
        malos += 1
    os.unlink(tmp)

# el recuento mira solo el MARCADO: '</body>' aparece también dentro de un
# comentario de JavaScript, y ahí es texto, no una etiqueta
marcado = re.sub(r'<(style|script)([^>]*)>.*?</\1>', '', s, flags=re.S)
print(f'{os.path.basename(SALIDA)}: {round(len(s.encode()) / 1024)} KB  ·  scripts con error: {malos}  ·  '
      f'restos de body/html en el marcado: {marcado.count("</body>")}/{marcado.count("</html>")}')
