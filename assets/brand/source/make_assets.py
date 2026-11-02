"""Compose icon/logo SVGs from the fitted mark and render every PNG/ICO/ICNS."""
import json, re, subprocess, shutil
from pathlib import Path
import numpy as np
from PIL import Image
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import uharfbuzz as hb
from geom import catmull_rom

OUT = Path('out'); shutil.rmtree(OUT, ignore_errors=True)
for d in ('brand', 'desktop/icons', 'web'): (OUT / d).mkdir(parents=True)
BG = '#2b2b30'                      # the study's background, sampled
FONT = '/usr/share/fonts/truetype/ubuntu/UbuntuSans[wdth,wght].ttf'

# ---- mark: inner content + tight box (tubes + prompt + glow margin) ----
mark = open('mark-final.svg').read()
inner = re.sub(r'^<svg[^>]*>', '', mark)[:-len('</svg>')]
fit = json.load(open('fit-final.json')); R = fit['radius']
pts = np.vstack([catmull_rom(p)[0] for p in fit['paths'].values()])
x0, y0 = pts.min(0) - R; x1, y1 = pts.max(0) + R
x1 = max(x1, 442 + 6); y1 = max(y1, 369 + 6)        # prompt underscore extends to the right/bottom
GLOW = R * 1.1
MB = (x0 - GLOW, y0 - GLOW, x1 + GLOW, y1 + GLOW)     # mark box incl. glow
mw, mh = MB[2] - MB[0], MB[3] - MB[1]
print('mark box %.1f x %.1f' % (mw, mh))

def placed(cx, cy, size):
    """Mark group scaled so its glow box fits a size x size square centred at (cx, cy)."""
    s = size / max(mw, mh)
    tx = cx - (MB[0] + mw / 2) * s; ty = cy - (MB[1] + mh / 2) * s
    return f'<g transform="translate({tx:.3f} {ty:.3f}) scale({s:.5f})">{inner}</g>'

def svg(w, h, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">{body}</svg>'

docs = {}
docs['brand/aether-mark.svg'] = (mw, mh, svg(round(mw), round(mh), placed(mw / 2, mh / 2, max(mw, mh))))
# macOS: Apple grid, 824px rounded square inside a 1024 canvas.
docs['brand/aether-icon-macos.svg'] = (1024, 1024, svg(1024, 1024,
    f'<rect x="100" y="100" width="824" height="824" rx="185.4" fill="{BG}"/>'
    '<rect x="100.5" y="100.5" width="823" height="823" rx="185" fill="none" stroke="#fff" stroke-opacity=".07"/>'
    + placed(512, 512, 824 * 0.80)))
# Windows / Linux / web: near full-bleed rounded tile.
docs['brand/aether-icon.svg'] = (1024, 1024, svg(1024, 1024,
    f'<rect x="24" y="24" width="976" height="976" rx="216" fill="{BG}"/>' + placed(512, 512, 976 * 0.82)))
# iOS home screen / apple-touch: full square, the OS applies its own mask.
docs['brand/aether-icon-square.svg'] = (1024, 1024, svg(1024, 1024,
    f'<rect width="1024" height="1024" fill="{BG}"/>' + placed(512, 512, 1024 * 0.74)))

# ---- wordmark "Aether" as outlines (Ubuntu Sans 500, HarfBuzz shaping) ----
font = instantiateVariableFont(TTFont(FONT), {'wght': 500, 'wdth': 100})
font.save('UbuntuSans-500.ttf')
blob = hb.Blob.from_file_path('UbuntuSans-500.ttf'); face = hb.Face(blob); hbfont = hb.Font(face)
buf = hb.Buffer(); buf.add_str('Aether'); buf.guess_segment_properties(); hb.shape(hbfont, buf, {'kern': True, 'liga': True})
gs = font.getGlyphSet(); order = font.getGlyphOrder()
TRACK = 12                                   # +1.2% em letter spacing
def wordmark(size, x, baseline, color):
    k = size / 1000.0; pen_x = 0; parts = []
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        name = order[info.codepoint]
        sp = SVGPathPen(gs)
        gs[name].draw(TransformPen(sp, (k, 0, 0, -k, x + (pen_x + pos.x_offset) * k, baseline - pos.y_offset * k)))
        parts.append(sp.getCommands()); pen_x += pos.x_advance + TRACK
    return f'<path fill="{color}" d="{" ".join(parts)}"/>', (pen_x - TRACK) * k

# Lockup: mark height H, cap height ~ 0.42 H, gap 0.18 H, vertically centred on the mark.
H = 400; cap = 0.42 * H; size = cap / 0.693
mark_w = H * mw / mh
gap = 0.16 * H
_, text_w = wordmark(size, 0, 0, '#000')
W = round(mark_w + gap + text_w + 8)
baseline = H / 2 + cap / 2
for name, color in (('aether-logo', '#efedf4'), ('aether-logo-on-light', '#25242a')):
    text, _ = wordmark(size, mark_w + gap, baseline, color)
    body = placed(mark_w / 2, H / 2, max(mark_w, H)) + text
    docs[f'brand/{name}.svg'] = (W, H, svg(W, H, body))

for rel, (w, h, s) in docs.items():
    (OUT / rel).write_text(s)

# ---- render with headless Chrome (transparent background) ----
def render(svg_path, w, h, png):
    html = OUT / '_render.html'
    html.write_text(f'<html><body style="margin:0;background:transparent">{Path(svg_path).read_text()}</body></html>')
    subprocess.run(['google-chrome', '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
                    '--default-background-color=00000000', f'--window-size={w},{h}', f'--screenshot={Path(png).resolve()}',
                    f'file://{html.resolve()}'], check=True, capture_output=True)
    im = Image.open(png).convert('RGBA').crop((0, 0, w, h)); im.save(png); return im

def scaled_svg(rel, w, h):
    s = (OUT / rel).read_text()
    s = re.sub(r'width="[\d.]+" height="[\d.]+"', f'width="{w}" height="{h}"', s, count=1)
    p = OUT / f'_{Path(rel).stem}-{w}.svg'; p.write_text(s); return p

def png_set(rel, sizes, dest_fmt, master=1024):
    w0, h0 = docs[rel][0], docs[rel][1]
    mw_, mh_ = (master, round(master * h0 / w0)) if w0 >= h0 else (round(master * w0 / h0), master)
    big = render(scaled_svg(rel, mw_, mh_), mw_, mh_, OUT / f'_{Path(rel).stem}-master.png')
    out = {}
    for sz in sizes:
        im = big if sz == master else big.resize((sz, round(sz * mh_ / mw_)), Image.LANCZOS)
        p = OUT / dest_fmt.format(sz=sz); im.save(p, optimize=True); out[sz] = im
    return out

# brand PNGs
png_set('brand/aether-mark.svg', [256, 512, 1024], 'brand/aether-mark-{sz}.png')
png_set('brand/aether-icon.svg', [1024], 'brand/aether-icon-{sz}.png')
png_set('brand/aether-icon-macos.svg', [1024], 'brand/aether-icon-macos-{sz}.png')
for name in ('aether-logo', 'aether-logo-on-light'):
    w, h = docs[f'brand/{name}.svg'][:2]
    for scale, suffix in ((1, ''), (2, '@2x')):
        ww, hh = round(w * scale * 0.5), round(h * scale * 0.5)     # @1x = 200px tall, @2x = 400px
        render(scaled_svg(f'brand/{name}.svg', ww, hh), ww, hh, OUT / f'brand/{name}{suffix}.png')

# desktop: macOS icns, Windows ico, Linux PNG set
mac = png_set('brand/aether-icon-macos.svg', [1024, 512], 'desktop/_mac-{sz}.png')
mac[1024].save(OUT / 'desktop/icon.icns', append_images=[mac[512]])
mac[1024].save(OUT / 'desktop/icon.png')
tile_sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
tile = png_set('brand/aether-icon.svg', tile_sizes, 'desktop/icons/{sz}x{sz}.png')
tile[256].save(OUT / 'desktop/icon.ico', sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)],
               append_images=[tile[s] for s in (16, 24, 32, 48, 64, 128)])
# web
tile[256].save(OUT / 'web/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)], append_images=[tile[16], tile[32], tile[48]])
for sz in (32, 192, 512):
    tile[sz if sz in tile else 512].resize((sz, sz), Image.LANCZOS).save(OUT / f'web/icon-{sz}.png', optimize=True)
sq = png_set('brand/aether-icon-square.svg', [1024, 180], 'brand/_square-{sz}.png')
sq[180].convert('RGB').save(OUT / 'web/apple-touch-icon.png', optimize=True)
for p in OUT.rglob('_*'): p.unlink()
print('done')
