"""Fit the green >_ prompt (chevron + underscore) and sample its color."""
import json, numpy as np, cv2
from PIL import Image
ref = np.array(Image.open('study-c11.png').convert('RGB')).astype(np.float32)
g = np.load('green.npy'); H, W = g.shape
col = np.median(ref[g], 0)
lab = cv2.connectedComponentsWithStats(g.astype(np.uint8))
comps = sorted([(lab[2][i][4], i) for i in range(1, lab[0])], reverse=True)[:2]
info = {}
for area, i in comps:
    x, y, w, h = lab[2][i][:4]
    info['under' if w > 2.5*h else 'chev'] = (x, y, w, h, area)
print(info, 'color', col.round())
def render(chev, under, sw):
    m = np.zeros((H*4, W*4), np.uint8)
    cv2.polylines(m, [np.round(np.array(chev)*4).astype(np.int32)], False, 255, int(round(sw*4)), cv2.LINE_AA)
    cv2.polylines(m, [np.round(np.array(under)*4).astype(np.int32)], False, 255, int(round(sw*4)), cv2.LINE_AA)
    return cv2.resize(m, (W, H), interpolation=cv2.INTER_AREA) > 127
x, y, w, h, _ = info['chev']; ux, uy, uw, uh, _ = info['under']
sw = min(uh, 10)
chev = [[x+sw/2, y+sw/2], [x+w-sw/2, y+h/2], [x+sw/2, y+h-sw/2]]
under = [[ux+uh/2, uy+uh/2], [ux+uw-uh/2, uy+uh/2]]
def score(c, u, s):
    r = render(c, u, s); return (r & g).sum() / max((r | g).sum(), 1)
best = score(chev, under, sw)
for it in range(5):
    for pts in (chev, under):
        for p in pts:
            for ax in (0, 1):
                for st in (2, -2, 1, -1, .5, -.5):
                    p[ax] += st; s = score(chev, under, sw)
                    if s > best: best = s
                    else: p[ax] -= st
    for s2 in (sw-.5, sw+.5):
        s = score(chev, under, s2)
        if s > best: best, sw = s, s2
print('prompt IoU %.3f stroke %.1f' % (best, sw))
c = '#%02x%02x%02x' % tuple(int(v) for v in col)
svg = (f'<g fill="none" stroke="{c}" stroke-width="{sw:.2f}" stroke-linecap="round" stroke-linejoin="round">'
       f'<path d="M{chev[0][0]:.2f} {chev[0][1]:.2f}L{chev[1][0]:.2f} {chev[1][1]:.2f}L{chev[2][0]:.2f} {chev[2][1]:.2f}"/>'
       f'<path d="M{under[0][0]:.2f} {under[0][1]:.2f}L{under[1][0]:.2f} {under[1][1]:.2f}"/></g>')
json.dump({'svg': svg, 'iou': best, 'glow_opacity': 0.5, 'color': c}, open('prompt.json', 'w'))
