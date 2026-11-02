import sys, subprocess, numpy as np
from pathlib import Path
from PIL import Image
from scipy import ndimage as ndi
from geom import target_mask
ref = np.array(Image.open('study-c11.png').convert('RGB')).astype(np.float32)
H, W = ref.shape[:2]
tgt = target_mask(); g = np.load('green.npy')
outside = ~ndi.binary_dilation(tgt | g, iterations=25)
outside[:24, :] = False
bg = np.median(ref[outside], 0)
svg = open(sys.argv[1] if len(sys.argv) > 1 else 'mark.svg').read()
html = f'<html><body style="margin:0;background:rgb({bg[0]:.0f},{bg[1]:.0f},{bg[2]:.0f})">{svg}</body></html>'
open('view.html', 'w').write(html)
subprocess.run(['google-chrome', '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
                f'--window-size={W},{H}', f'--screenshot={Path("render.png").resolve()}', f'file://{Path("view.html").resolve()}'],
               check=True, capture_output=True)
out = np.array(Image.open('render.png').convert('RGB')).astype(np.float32)[:H, :W]
region = ndi.binary_dilation(tgt | g, iterations=6); region[:24, :] = False
diff = np.abs(out - ref)
print('bg used', bg.round())
print('mean abs diff in mark region: %.1f / 255  (median %.1f, p90 %.1f)' % (diff[region].mean(), np.median(diff[region]), np.percentile(diff[region].max(1), 90)))
inside = tgt & ~g
print('mean color: ref', ref[inside].mean(0).round(), 'svg', out[inside].mean(0).round())
side = np.concatenate([ref, out, np.clip(diff*2, 0, 255)], axis=1).astype(np.uint8)
Image.fromarray(side).resize((side.shape[1]*2//2*1, side.shape[0]), Image.LANCZOS).save('side.png')
