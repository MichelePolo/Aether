"""Tube geometry: waypoints (reference crop coords, 470x390), spline, raster proxy, IoU fit."""
import json, numpy as np, cv2
from PIL import Image
from scipy import ndimage as ndi

# Paths in drawing order (bottom -> top). Coordinates read off the skeleton (crop px).
PATHS = {
  # Inner "A" + bottom-right U: starts hidden under the crossbar, ends hidden under the crest.
  "inner": [(157,233),(175,182),(191,145),(205,134),(219,140),(232,166),(243,196),(256,223),
            (272,256),(288,291),(304,330),(320,357),(345,362),(366,350),(372,325),(360,289),
            (345,250),(328,220),(313,205)],
  # Right leg + crossbar of the outer "A": from the apex down, then left, tucking under the left leg.
  "bar":   [(227,42),(246,70),(261,110),(277,145),(285,165),(277,178),(260,190),(242,196),
            (210,210),(165,225),(125,238),(95,246)],
  # Main stream: right hook -> crest -> lower strand -> bottom-left U -> left leg -> apex.
  "main":  [(436,197),(420,178),(400,168),(370,162),(340,168),(320,185),(308,205),(290,222),
            (270,240),(236,257),(220,262),(190,270),(150,277),(125,288),(107,310),(90,345),
            (70,360),(50,355),(40,330),(47,300),(65,272),(88,247),(102,210),(118,170),
            (136,130),(158,85),(177,52),(205,35),(227,42)],
}

def catmull_rom(pts, samples=14):
    """Centripetal Catmull-Rom through pts -> dense polyline (and the matching cubic Beziers)."""
    p = np.array(pts, float)
    ext = np.vstack([2*p[0]-p[1], p, 2*p[-1]-p[-2]])
    out, beziers = [p[0]], []
    for i in range(1, len(ext)-2):
        p0, p1, p2, p3 = ext[i-1], ext[i], ext[i+1], ext[i+2]
        # Catmull-Rom -> Bezier control points (tension 0.5 uniform; good enough for smooth tubes)
        c1 = p1 + (p2 - p0) / 6.0
        c2 = p2 - (p3 - p1) / 6.0
        beziers.append((p1, c1, c2, p2))
        t = np.linspace(0, 1, samples+1)[1:, None]
        b = ((1-t)**3)*p1 + 3*((1-t)**2)*t*c1 + 3*(1-t)*(t**2)*c2 + (t**3)*p2
        out.extend(b)
    return np.array(out), beziers

def target_mask():
    im = np.array(Image.open('study-c11.png').convert('RGB')).astype(np.float32)
    green = np.load('green.npy')
    bg = np.array([43., 42., 46.])
    dist = np.linalg.norm(im - bg, axis=2)
    m = (dist > 105) & ~green
    m[:24, :] = False
    lab, n = ndi.label(m)
    sizes = ndi.sum(m, lab, range(1, n+1))
    m = lab == (1 + int(np.argmax(sizes)))
    m = ndi.binary_closing(m, iterations=2)
    return m

def render_mask(paths, radius, shape, scale=4):
    H, W = shape
    img = np.zeros((H*scale, W*scale), np.uint8)
    for pts in paths.values():
        poly, _ = catmull_rom(pts)
        cv2.polylines(img, [np.round(poly*scale).astype(np.int32)], False, 255,
                      thickness=int(round(2*radius*scale)), lineType=cv2.LINE_AA)
    small = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA)
    return small > 127

def iou(a, b):
    return (a & b).sum() / max((a | b).sum(), 1)

if __name__ == '__main__':
    import sys
    tgt = target_mask()
    Image.fromarray((tgt*255).astype(np.uint8)).save('mask-target.png')
    seed = json.load(open(sys.argv[1])) if len(sys.argv) > 1 else None
    paths = {k: [list(p) for p in v] for k, v in (seed['paths'] if seed else PATHS).items()}
    radius = seed['radius'] if seed else 12.0
    best = iou(render_mask(paths, radius, tgt.shape), tgt)
    print('initial IoU %.4f' % best)
    for r in np.arange(10.5, 14.6, 0.25):
        s = iou(render_mask(paths, r, tgt.shape), tgt)
        if s > best: best, radius = s, r
    print('radius %.2f IoU %.4f' % (radius, best))
    # Coordinate descent on every waypoint (apex shared point is moved in both paths).
    for it in range(6):
        improved = 0
        for k in paths:
            for i in range(len(paths[k])):
                for axis in (0, 1):
                    for step in (3, -3, 1, -1):
                        paths[k][i][axis] += step
                        s = iou(render_mask(paths, radius, tgt.shape), tgt)
                        if s > best + 1e-5:
                            best, improved = s, improved + 1
                        else:
                            paths[k][i][axis] -= step
        for r in (radius-0.25, radius+0.25):
            s = iou(render_mask(paths, r, tgt.shape), tgt)
            if s > best: best, radius = s, r
        print('iter %d IoU %.4f radius %.2f moves %d' % (it, best, radius, improved))
        if not improved: break
    out_fit = {'radius': radius, 'paths': paths, 'iou': best}
    if seed and 'overlay' in seed: out_fit['overlay'] = seed['overlay']
    json.dump(out_fit, open('fit.json', 'w'), indent=1)
    out = np.dstack([tgt*255, render_mask(paths, radius, tgt.shape)*255, np.zeros_like(tgt, np.uint8)]).astype(np.uint8)
    Image.fromarray(out).resize((940, 780), Image.NEAREST).save('fit-overlay.png')
