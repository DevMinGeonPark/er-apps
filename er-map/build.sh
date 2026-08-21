#!/bin/sh
# Inline data.js + graph.js into one self-contained page for publishing.
cd "$(dirname "$0")" && python3 -c "
import re, pathlib
html = pathlib.Path('index.html').read_text()
for src in ('data.js', 'lumia-areas.js', 'graph.js'):
    html = html.replace('<script src=\"%s\"></script>' % src,
                        '<script>\n' + pathlib.Path(src).read_text().rstrip() + '\n</script>')
pathlib.Path('dist.html').write_text(html)
print('dist.html', len(html), 'bytes')
"
