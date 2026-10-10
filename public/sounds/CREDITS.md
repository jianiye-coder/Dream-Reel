# Sound credits

Pencil strokes in `pencil-sprite.mp3` (offsets in `pencil-grains.json`) are cut from
"pencil writing" by freesound_community on Pixabay (Pixabay ID 32447), used under the Pixabay
Content License (free for commercial use, attribution not required — credited here anyway).
The unprocessed source is kept in `assets/sounds/pencil-writing-32447.mp3`.

Processing: 34 segments of 90–240 ms taken from the parts of the recording where the pencil is
moving, levelled by RMS, high-pass 180 Hz, low-pass 6.5 kHz, −5 dB at 4.5 kHz, +2 dB at 900 Hz.

Page-turn, eraser and tap sounds are synthesised in `src/lib/notebookSound.ts` (Web Audio), not recorded.
