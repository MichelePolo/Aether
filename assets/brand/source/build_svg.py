"""Sample colors from the reference along the fitted tubes and emit the mark as SVG."""
import json, numpy as np, cv2
from PIL import Image
from scipy import ndimage as ndi
from geom import catmull_rom

ref = np.array(Image.open('study-c11.png').convert('RGB')).astype(np.float32)
H, W = ref.shape[:2]
fit = json.load(open('fit.json'))
R = fit['radius']
ORDER = ['inner', 'outer']                      # bottom -> top
paths = {k: [tuple(p) for p in fit['paths'][k]] for k in ORDER}

def split_bezier(b, t0, t1):
    """Exact sub-curve of cubic b between t0 and t1 (de Casteljau)."""
    def at(t):
        p0, p1, p2, p3 = b
        a = p0 + (p1-p0)*t; bb = p1 + (p2-p1)*t; c = p2 + (p3-p2)*t
        d = a + (bb-a)*t; e = bb + (c-bb)*t
        return d + (e-d)*t, (d, e)
    def left(bz, t):  # left part of bz at t
        p0, p1, p2, p3 = bz
        a = p0 + (p1-p0)*t; bb = p1 + (p2-p1)*t; c = p2 + (p3-p2)*t
        d = a + (bb-a)*t; e = bb + (c-bb)*t; f = d + (e-d)*t
        return (p0, a, d, f), (f, e, c, p3)
    _, rest = left(b, t0)
    t = (t1 - t0) / (1 - t0) if t0 < 1 else 1
    seg, _ = left(rest, t)
    return seg

def bez_point(b, t):
    p0, p1, p2, p3 = b
    return ((1-t)**3)*p0 + 3*((1-t)**2)*t*p1 + 3*(1-t)*t*t*p2 + t**3*p3

def bez_tangent(b, t):
    p0, p1, p2, p3 = b
    return 3*((1-t)**2)*(p1-p0) + 6*(1-t)*t*(p2-p1) + 3*t*t*(p3-p2)

# Visibility: a point of path k is visible unless a later path covers it.
def cover_mask(keys):
    m = np.zeros((H*4, W*4), np.uint8)
    for k in keys:
        poly, _ = catmull_rom(paths[k])
        cv2.polylines(m, [np.round(poly*4).astype(np.int32)], False, 255, int(round(2*R*4)), cv2.LINE_AA)
    return cv2.resize(m, (W, H), interpolation=cv2.INTER_AREA) > 127

BANDS = [1.0, 0.78, 0.55, 0.32]          # outer radius of each concentric stroke (fraction of R)
def sample(p, n):
    """Radial color profile across the tube at p (normal n): one color per band + highlight."""
    bands = [[] for _ in BANDS]; hi, best_l = None, -1
    for s in np.linspace(-0.98*R, 0.98*R, 41):
        x, y = p + n*s
        xi, yi = int(round(x)), int(round(y))
        if not (0 <= xi < W and 0 <= yi < H): continue
        c = ref[yi, xi]; f = abs(s)/R
        for bi, outer in enumerate(BANDS):
            inner = BANDS[bi+1] if bi+1 < len(BANDS) else 0
            if inner <= f <= outer: bands[bi].append(c)
        l = c @ np.array([.299, .587, .114])
        if f < 0.5 and l > best_l: best_l, hi = l, c
    cols = [np.median(b, 0) if b else None for b in bands]
    return cols + [hi]

def path_colors(k):
    _, beziers = catmull_rom(paths[k])
    later = ORDER[ORDER.index(k)+1:]
    cov = cover_mask(later) if later else np.zeros((H, W), bool)
    T = []   # (span, t, base, hi, edge, visible)
    for si, b in enumerate(beziers):
        b = tuple(np.array(x, float) for x in b)
        for t in np.linspace(0, 1, 7):
            p = bez_point(b, t); d = bez_tangent(b, t); d /= (np.linalg.norm(d) + 1e-9)
            n = np.array([-d[1], d[0]])
            xi, yi = int(round(p[0])), int(round(p[1]))
            vis = 0 <= xi < W and 0 <= yi < H and not cov[yi, xi]
            c = sample(p, n) if vis else [None]*(len(BANDS)+1)
            T.append([si, t, *c, vis and all(x is not None for x in c)])
    # Fill hidden samples by interpolation along the path; smooth visible ones.
    VIS = 2 + len(BANDS) + 1
    for j in range(2, VIS):
        vals = np.array([r[j] if r[VIS] and r[j] is not None else [np.nan]*3 for r in T], float)
        idx = np.arange(len(T))
        for ch in range(3):
            v = vals[:, ch]; ok = ~np.isnan(v)
            vals[:, ch] = np.interp(idx, idx[ok], v[ok])
        vals = ndi.uniform_filter1d(vals, size=SMOOTH, axis=0, mode='nearest')
        for i, r in enumerate(T): r[j] = vals[i]
    if RADIAL > 0:
        nb = len(BANDS)
        for r in T:
            orig = [np.array(r[2+b], float) for b in range(nb)]
            for b in range(nb):
                nbrs = [orig[x] for x in (b-1, b+1) if 0 <= x < nb]
                r[2+b] = (1-RADIAL)*orig[b] + RADIAL*np.mean(nbrs, 0)
    return beziers, T

import os
GLOW_W = float(os.environ.get('GLOW_W', 1.4)); GLOW_BLUR = float(os.environ.get('GLOW_BLUR', 0.6))
GLOW_OP = float(os.environ.get('GLOW_OP', 0.35)); SOFT = float(os.environ.get('SOFT', 0.5)); BLOOM_OP = float(os.environ.get('BLOOM_OP', 0.7)); BLOOM_S = float(os.environ.get('BLOOM_S', 1.3)); SMOOTH = int(os.environ.get('SMOOTH', 5)); RADIAL = float(os.environ.get('RADIAL', 0.0)); HI_W = float(os.environ.get('HI_W', 0.16)); HI_OP = float(os.environ.get('HI_OP', 0.8))
def hexc(c): return '#%02x%02x%02x' % tuple(int(np.clip(round(x), 0, 255)) for x in c)

def build(sub=3):
    defs, glow, layers = [], [], []
    gid = 0
    for k in ORDER:
        beziers, T = path_colors(k)
        per = {}
        for r in T: per.setdefault(r[0], []).append(r)
        band_l = [[] for _ in BANDS]; hi_l = []
        span_bands = {}; span_hi = {}
        for si, b in enumerate(beziers):
            b = tuple(np.array(x, float) for x in b)
            rows = per[si]
            ts = np.linspace(0, 1, sub+1)
            for a, z in zip(ts[:-1], ts[1:]):
                seg = split_bezier(b, a, z) if a > 0 or z < 1 else b
                p0, p3 = seg[0], seg[3]
                def col(j, t):
                    tt = np.array([r[1] for r in rows]); vv = np.array([r[j] for r in rows])
                    return [np.interp(t, tt, vv[:, ch]) for ch in range(3)]
                d = 'M%.2f %.2fC%.2f %.2f %.2f %.2f %.2f %.2f' % (*seg[0], *seg[1], *seg[2], *seg[3])
                specs = [(band_l[bi], 2+bi, 2*R*f, '') for bi, f in enumerate(BANDS)]
                specs.append((hi_l, 2+len(BANDS), 2*R*HI_W, f' opacity="{HI_OP}"'))
                for si_lst, (lst, j, w, extra) in enumerate(specs):
                    c0, c1 = col(j, a), col(j, z)
                    gid += 1
                    defs.append(f'<linearGradient id="g{gid}" gradientUnits="userSpaceOnUse" x1="{p0[0]:.2f}" y1="{p0[1]:.2f}" x2="{p3[0]:.2f}" y2="{p3[1]:.2f}"><stop offset="0" stop-color="{hexc(c0)}"/><stop offset="1" stop-color="{hexc(c1)}"/></linearGradient>')
                    el = f'<path d="{d}" stroke="url(#g{gid})" stroke-width="{w:.2f}"{extra}/>'
                    lst.append(el)
                    if si_lst < len(BANDS): span_bands.setdefault(si, [[] for _ in BANDS])[si_lst].append(el)
                    else: span_hi.setdefault(si, []).append(el)
                    if j == 3: glow.append(f'<path d="{d}" stroke="url(#g{gid})" stroke-width="{2*R*GLOW_W:.2f}"/>')
        def tube(bands, his, gid_):
            return (f'<g id="{gid_}"><g filter="url(#soft)">' + ''.join(sum(bands, [])) + '</g>' + ''.join(his) + '</g>')
        # A tube that crosses itself is drawn as consecutive complete pieces (all bands of a
        # piece before the next piece), otherwise inner bands of the earlier part bleed through
        # the edge band of the later part. Split at the apex (topmost waypoint).
        # Cut on the straight right leg; the two segments meeting at the cut use butt caps so the
        # pieces join seamlessly (round caps there would draw a visible ring).
        wp = np.array(paths[k], float)
        cut = int(np.argmin(np.linalg.norm(wp - [261, 110], axis=1))) if k == 'outer' else len(beziers)
        butt = lambda el: el.replace('<path ', '<path stroke-linecap="butt" ', 1)
        if cut < len(beziers):
            # piece 0 keeps its round end cap (piece 1, drawn later, covers it); only piece 1's
            # first segment is butt-capped, so its start edge blends over identical colors.
            for b in range(len(BANDS)):
                sa = span_bands[cut][b]; sa[0] = butt(sa[0])
            span_hi[cut][0] = butt(span_hi[cut][0])
        if k == 'outer':
            # The left leg starts hidden under the crossbar: a flat start keeps its corners inside
            # the crossbar at any crossing angle (a round cap would bulge out of its edge).
            for b in range(len(BANDS)):
                sb = span_bands[0][b]; sb[0] = butt(sb[0])
            span_hi[0][0] = butt(span_hi[0][0])
        for part, spans in ((0, range(0, cut)), (1, range(cut, len(beziers)))):
            if not len(spans): continue
            pb = [sum((span_bands[i][b] for i in spans), []) for b in range(len(BANDS))]
            ph = sum((span_hi[i] for i in spans), [])
            layers.append(tube(pb, ph, f'{k}-{part}'))
        ov = fit.get('overlay')
        if ov and ov['path'] == k:
            wp = np.array(paths[k], float)
            i0 = int(np.argmin(np.linalg.norm(wp - ov['from'], axis=1)))
            i1 = int(np.argmin(np.linalg.norm(wp - ov['to'], axis=1)))
            spans = range(min(i0, i1), max(i0, i1))
            ob = [sum((span_bands[i][b] for i in spans), []) for b in range(len(BANDS))]
            oh = sum((span_hi[i] for i in spans), [])
            layers.append(tube(ob, oh, k + '-overlay'))
    return defs, glow, layers

def bloom_svg():
    b = json.load(open('bloom.json'))
    rx, ry = b['a'] * BLOOM_S, max(b['b'], R * 0.45) * BLOOM_S
    return (f'<defs><radialGradient id="bloom"><stop offset="0" stop-color="{b["color"]}" stop-opacity="1"/>'
            f'<stop offset=".45" stop-color="{b["color"]}" stop-opacity=".45"/><stop offset="1" stop-color="{b["color"]}" stop-opacity="0"/></radialGradient>'
            f'<filter id="bloomblur" filterUnits="userSpaceOnUse" x="-40" y="-40" width="{W+80}" height="{H+80}"><feGaussianBlur stdDeviation="{R*0.25:.2f}"/></filter></defs>'
            f'<ellipse cx="{b["cx"]:.2f}" cy="{b["cy"]:.2f}" rx="{rx:.2f}" ry="{ry:.2f}" transform="rotate({b["angle"]:.1f} {b["cx"]:.2f} {b["cy"]:.2f})" '
            f'fill="url(#bloom)" opacity="{BLOOM_OP}" filter="url(#bloomblur)"/>')

if __name__ == '__main__':
    defs, glow, layers = build()
    prompt = json.load(open('prompt.json'))
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">'
           '<defs>' + ''.join(defs) +
           f'<filter id="glow" filterUnits="userSpaceOnUse" x="-40" y="-40" width="{W+80}" height="{H+80}"><feGaussianBlur stdDeviation="{R*GLOW_BLUR:.2f}"/></filter>'
           f'<filter id="soft" filterUnits="userSpaceOnUse" x="-40" y="-40" width="{W+80}" height="{H+80}"><feGaussianBlur stdDeviation="{SOFT:.2f}"/></filter></defs>'
           '<g fill="none" stroke-linecap="round" stroke-linejoin="round">'
           f'<g filter="url(#glow)" opacity="{GLOW_OP}">' + ''.join(glow) + '</g>'
           + ''.join(layers) + '</g>' + bloom_svg() + prompt['svg'] + '</svg>')
    open('mark.svg', 'w').write(svg)
    print('mark.svg', len(svg)//1024, 'KB')
