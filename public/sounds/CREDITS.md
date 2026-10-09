# Sound credits

Pencil strokes in `pencil-sprite.mp3` (offsets in `pencil-grains.json`) were cut from two recordings released under
**CC0 1.0 (public domain)** on Freesound — no attribution required, credited here anyway:

- "Writing - pencil on paper" — magnus1906 — https://freesound.org/s/513938/
- "Writing with pencil on thick paper" — PanosA — https://freesound.org/s/546367/

Processing: sliced into 40 single strokes, high-pass 180 Hz, low-pass 6.8 kHz, −4 dB at 4.2 kHz, +2 dB at 900 Hz.

Page-turn, eraser and tap sounds are synthesised in `src/lib/notebookSound.ts` (Web Audio), not recorded.
