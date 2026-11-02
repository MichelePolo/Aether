import numpy as np, cv2
from PIL import Image
from skimage.morphology import skeletonize, remove_small_objects
from scipy import ndimage as ndi
im = np.array(Image.open('study-c11.png').convert('RGB')).astype(np.float32)
H, W = im.shape[:2]
hsv = cv2.cvtColor(im.astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
h, s, v = hsv[...,0]*2, hsv[...,1]/255, hsv[...,2]/255
green = (h > 90) & (h < 170) & (s > 0.45) & (v > 0.45)
# Tube = saturated and bright enough; excludes the grey handwriting/arrow (low saturation).
tube = (s > 0.38) & (v > 0.42) & ~green
tube[:24, :] = False                      # title text
tube = remove_small_objects(tube, 400)
tube = ndi.binary_closing(tube, iterations=2)
tube = ndi.binary_fill_holes(tube) & tube | ndi.binary_opening(tube, iterations=1)
Image.fromarray((tube*255).astype(np.uint8)).save('mask-clean.png')
dt = ndi.distance_transform_edt(tube)
sk = skeletonize(tube)
r = dt[sk]
print('size', W, H, 'tube px', int(tube.sum()), 'radius median %.1f p10 %.1f p90 %.1f' % (np.median(r), np.percentile(r,10), np.percentile(r,90)))
np.save('skel.npy', sk); np.save('dt.npy', dt); np.save('green.npy', green)
vis = np.dstack([tube*60]*3).astype(np.uint8); vis[sk] = (255, 255, 0)
for y in range(0, H, 50): vis[y, :, :] = (90, 90, 90)
for x in range(0, W, 50): vis[:, x, :] = (90, 90, 90)
Image.fromarray(vis).resize((W*2, H*2), Image.NEAREST).save('skel-vis.png')
