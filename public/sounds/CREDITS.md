# Sound credits

Writing strokes in `pen-sprite.mp3` (offsets in `pen-grains.json`) are cut from
"Writing with Fountain Pen Nib" by black_trillium on Freesound — https://freesound.org/s/397282/ —
released under **CC0 1.0 (public domain)**: no attribution required, credited here anyway.
The source preview is kept in `assets/sounds/fountain-pen-397282.mp3`.

Processing: 34 segments of 120–320 ms taken where the nib is moving (taps skipped), levelled by RMS,
15 ms eased attack, high-pass 150 Hz, −3 dB at 3.5 kHz, low-pass 6 kHz, +1.5 dB at 1.1 kHz.

Page-turn, eraser and tap sounds are synthesised in `src/lib/notebookSound.ts` (Web Audio), not recorded.
