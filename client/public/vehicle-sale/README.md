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

`footer-*.jpg` is **left as scanned**. It is a 74px strip that is already clipped top and bottom
in the source, leaving no clean feature to measure — the two variants disagreed by half a degree
with opposite sign to the header, so rotating it would have been guesswork.
