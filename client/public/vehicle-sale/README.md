# Used Car Sales Invoice — branding artwork

Scans of the pre-printed two-part sales invoice, used as the background layer of
`client/src/components/VehicleSaleForm.tsx`. Sized to the form's 2409 × 3438 artwork space:
header 2409×475, badges 1120×530, footer 2409×74. `-white` is the original, `-yellow` the
seller's copy.

## Provenance

Extracted from the base64 blob in `eli-motors-used-car-invoice-template.html` (supplied
2026-08-04), then **de-skewed** — the source scan was rotated, so the red band under the header
and the Vehicle Sales / Service and Repair bars ran visibly on an angle against the form's
straight printed rules.

Applied rotations (counter-clockwise, about each image's centre):

| file | rotation | red band rise across the sheet |
|---|---|---|
| `header-white.jpg`  | −0.818° | 34.4px → 1.4px |
| `header-yellow.jpg` | −0.856° | 36.0px → 2.5px |
| `badges-white.jpg`  | −0.850° | — |
| `badges-yellow.jpg` | −0.860° | — |

Angles came from a least-squares fit to the header's band edge (rms 0.5px) and a
projection-profile deskew for the badges; the two methods agreed to within 0.06°.

Edges were replicated outward before rotating and the result cropped back to the original
dimensions, so the corners are filled with real colour rather than background wedges.

## The footer is not here

There is deliberately no `footer-*.jpg`. The supplied strip was 74px tall and the crop ran
straight through the band **and** through the address text sitting on it: the orange band ended
at row 62 with the glyphs of "49 VICTORIA ROAD HENDON LONDON NW4 2RP" sliced mid-stroke, and the
missing pixels were never in the file, so no rotation or rescale could recover them.

The footer is now drawn as vector in `VehicleSaleForm.tsx` (`FooterBand`), from that strip's own
measured geometry — arrow tip at x≈1249, orange `#F4513A`, blue `#4A5F9A`, text set to the
original's measured widths via `textLength`. It is legible, and unlike a 74px bitmap stretched
across 210mm it stays crisp at print resolution.
