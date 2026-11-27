#!/usr/bin/env python3
"""Stamp a cache-busting version on every CSS/JS reference so browsers fetch fresh files after a deploy.
GitHub Pages serves files with a 10-minute cache, and ES-module imports are cached too.
Run before every push:  python3 tools/bump-version.py"""
import re, time, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
v = time.strftime('%Y%m%d%H%M')
files = [root / 'index.html', *sorted((root / 'js').rglob('*.js'))]
for f in files:
    s = f.read_text(encoding='utf-8')
    n = re.sub(r"""((?:from\s+|src=|href=)['"](?:\./|\.\./|js/|css/)[^'"?]+\.(?:js|css))(?:\?v=\w+)?(['"])""", rf"\1?v={v}\2", s)
    if n != s: f.write_text(n, encoding='utf-8')
print('version', v)
