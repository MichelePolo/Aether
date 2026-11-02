# Aether brand assets

The Aether mark is **C1.1 "Quantum Stream"** from the design study: a single continuous glowing tube drawing an "A", with a smaller inner "A" and a `>_` terminal prompt.

## Files

| File | Use |
|---|---|
| `aether-mark.svg`, `aether-mark-{256,512,1024}.png` | the mark alone, transparent background |
| `aether-logo.svg`, `aether-logo.png`, `aether-logo@2x.png` | mark + "Aether" wordmark, for **dark** backgrounds |
| `aether-logo-on-light.svg`, `.png`, `@2x.png` | the same lockup with dark text, for **light** backgrounds |
| `aether-icon.svg`, `aether-icon-1024.png` | app icon, rounded tile (Windows, Linux, web) |
| `aether-icon-macos.svg`, `aether-icon-macos-1024.png` | app icon on the macOS grid (824 px tile in a 1024 canvas) |
| `aether-icon-square.svg` | full-bleed square, for platforms that apply their own mask (iOS home screen) |
| `contact-sheet.png` | proof sheet: icons at every size and both logos, on dark and light backgrounds |

Generated from these sources:
- **Desktop**: `app/desktop/resources/` holds `icon.icns` (macOS), `icon.ico` (Windows, 16–256 px), `icon.png`, and `icons/NxN.png` (Linux, 16–1024 px).
- **Web**: `public/` holds `favicon.ico` (16/32/48), `apple-touch-icon.png` (180), `icon-192.png` and `icon-512.png`.

## Palette

Sampled from the study:

| Role | Color |
|---|---|
| Background (icon tile) | `#2b2b30` |
| Violet (left leg) | `#a86bcf` |
| Magenta (apex) | `#de6edd` |
| Pink (crossbar) | `#c156aa` |
| Coral (inner apex) | `#f17a83` |
| Orange (crest, lower right) | `#fe8b41` |
| Prompt green | `#55c87b` |

The wordmark is Ubuntu Sans at weight 500, converted to outlines, with +1.2% tracking.

## How the mark was built

The study is a raster painting, so the mark is a **vector reconstruction** measured from it, not a trace. Everything below was taken from the study image:
- the tube centerlines (from the skeleton of the shape);
- the tube thickness (distance transform);
- the colors: four radial bands across the tube, plus the specular highlight, sampled along its length;
- the specular bloom on the left leg.

It was then rendered in Chrome and compared pixel by pixel with the original:
- **shape overlap (IoU): 0.953**;
- **mean color difference** over the mark: 9.3/255;
- **average color**: original `199,113,158`, SVG `201,114,158`.

The gaps are the painterly glow and the JPEG noise in the study; the topology, crossings and proportions follow it exactly.

`source/` holds what's needed to rebuild everything:
- the measured geometry (`fit.json`), the prompt and bloom parameters, and the reference crop of the study (`study-c11.png`);
- the scripts, run with `source/build.sh`.

A clean rebuild reproduces these files byte for byte and prints the fidelity numbers above. It isn't part of Aether's build.

## Usage notes

- Keep the glow and the colors; don't recolor the mark or flatten it to one color.
- Below 32 px, prefer the tile icon (`aether-icon`) over the bare mark.
- Leave clear space around the logo of at least the height of the `>_` prompt.
- The SVGs use filters and gradients, so they need a real SVG renderer: browsers, Inkscape and Figma are fine, very old tools may not be. Use the PNGs where that matters.
