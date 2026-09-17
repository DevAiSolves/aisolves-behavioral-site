#!/usr/bin/env python3
"""construir — versión de publicación del sitio: la misma página, sin comentarios.

   El archivo fuente lleva 84 KB de comentarios en español que explican por qué
   está hecho cada cosa. Valen su peso mientras se trabaja en él; no valen nada
   en el navegador de un cliente, donde son 31 KB comprimidos que hay que
   descargar antes de ver la página.

   Así que el fuente se queda como está —es el original— y esto produce el
   gemelo que se publica. No minifica nada más: no renombra, no reordena, no
   toca una sola línea de código. Quitar comentarios es la única
   transformación que no puede cambiar el comportamiento.

   Y aun así se comprueba: cada <script> se vuelve a parsear después de
   limpiarlo y, si algo falla —un '/*' dentro de una cadena, por ejemplo—, ese
   bloque se deja tal cual venía. Mejor unos bytes de más que una página rota.

   Uso:  python3 tools/construir.py [entrada.html] [salida.html]
"""
import gzip
import os
import re
import subprocess
import sys
import tempfile

ENTRADA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'aisolves-site.html')
SALIDA = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', 'aisolves-site.pub.html')


def parsea(js):
    """¿sigue siendo JavaScript válido?"""
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f:
        f.write(js)
        tmp = f.name
    try:
        return subprocess.run(['node', '--check', tmp], capture_output=True).returncode == 0
    finally:
        os.unlink(tmp)


def limpia_js(js):
    s = re.sub(r'/\*.*?\*/', '', js, flags=re.S)
    # solo líneas que EMPIEZAN por //: así una URL como https:// nunca se toca
    s = re.sub(r'(?m)^[ \t]*//[^\n]*\n', '', s)
    s = re.sub(r'\n[ \t]*\n+', '\n', s)
    return s


def limpia_css(css):
    s = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    s = re.sub(r'\n[ \t]*\n+', '\n', s)
    return s


def main():
    doc = open(ENTRADA, encoding='utf-8').read()
    antes = len(doc.encode())
    saltados = []

    def bloque(m):
        etiqueta, attrs, cuerpo = m.group(1), m.group(2), m.group(3)
        if etiqueta == 'style':
            return f'<style{attrs}>{limpia_css(cuerpo)}</style>'
        if 'json' in attrs or 'text/plain' in attrs:          # datos, no código
            return m.group(0)
        limpio = limpia_js(cuerpo)
        if not parsea(limpio):
            saltados.append(m.start())
            return m.group(0)
        return f'<script{attrs}>{limpio}</script>'

    pub = re.sub(r'<(style|script)([^>]*)>(.*?)</\1>', bloque, doc, flags=re.S)
    # comentarios del marcado: fuera también, salvo los condicionales
    pub = re.sub(r'<!--(?!\[if)(?:(?!-->).)*?-->', '', pub, flags=re.S)
    pub = re.sub(r'\n[ \t]*\n+', '\n', pub)

    open(SALIDA, 'w', encoding='utf-8').write(pub)
    despues = len(pub.encode())
    print(f'{os.path.basename(ENTRADA)} {antes} B (gzip {len(gzip.compress(doc.encode(), 9))}) → '
          f'{os.path.basename(SALIDA)} {despues} B (gzip {len(gzip.compress(pub.encode(), 9))})  ·  '
          f'-{antes - despues} B  ·  bloques intactos por precaución: {len(saltados)}')


main()
