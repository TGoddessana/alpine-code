# Generation provenance

Mode: built-in `image_gen` (no API/CLI fallback).

Approved reference: final centered icon, right-facing horizontal wrench, selected in this chat. The approved PNG is preserved as `approved-icon.png`. The two production extraction prompts below produced the transparent masters. Subsequent exports only resize, convert formats, or lay out these existing assets; they do not call a generative model.

## Character cutout

Use case: background-extraction. Production brand asset for Alpine Code. Input is the approved icon. Extract ONLY the exact snow hare character including ears, body, dark blue collar, two loops and large horizontal wrench pendant with jaw on viewer RIGHT. Remove ALL blue tile and all pale exterior background, making real alpha transparency. Preserve original character exactly: viewer left ear tall and straight, viewer right ear tip kinked outward, small black square eyes, pink nose, white fur with ice blue shadows, dark pixel contour. Character has empty paws. Do not redraw, redesign, add textures, change proportions or reverse anything. Keep all white fur opaque! No ground shadow. Center face/body axis at 50% canvas width. Preserve clear space around every extremity, square canvas. Crisp pixel-art edges, no soft effects. No text, no presentation sheet, no icon tile. Output a transparent PNG cutout ready for a desktop app and website.

## Icon transparency

Use case: background-extraction. Production app icon export. Preserve the attached approved app icon EXACTLY: the blue rounded square, the centered pixel white snow hare, its viewer-left straight ear and viewer-right kinked ear, eyes and pink nose, blue collar, large horizontal steel wrench with head on viewer RIGHT and two little attachment loops. Make ONLY the pale region OUTSIDE the rounded blue square fully transparent. Keep the blue tile opaque, preserve the rabbit white opaque, preserve exact face/body alignment, scale and padding. No redesign, no shadows, no text, no extra marks. Real alpha transparency outside blue rounded square. Return one square PNG.
