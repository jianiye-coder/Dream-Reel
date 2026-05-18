# Dream Emotion Calibration Design

## Goal

Use the annotated dream emotion dataset as calibration examples for the existing dream analysis prompt. This should make `/api/analyze-dream` return more stable dream-specific moods such as `恐惧`, `焦虑`, `怀旧`, `平静`, and `惊奇` without changing the product database or UI. `混合` may be used only as internal tone guidance in examples; it must not be returned as the final `mood`.

## Scope

In scope:

- Add a small reusable calibration module at `src/lib/dreamEmotionCalibration.ts`.
- Include the dream emotion label guide, annotation rules, and the 12 pre-labeled examples created from the current dataset.
- Import the calibration text into `src/app/api/analyze-dream/route.ts`.
- Update the Chinese analysis prompt so `mood` and `stressScore` follow the calibration examples.
- Require `mood` to be one dominant emotion label, never `混合`.
- Keep the API response shape unchanged.

Out of scope:

- Fine-tuning a model.
- Reading Excel at runtime.
- Adding new database columns.
- Adding new frontend controls.
- Changing archive or journal save behavior.

## Architecture

`src/lib/dreamEmotionCalibration.ts` will export a plain string, for example `ZH_DREAM_EMOTION_CALIBRATION`, containing:

- Allowed primary emotion labels.
- Rules for selecting one dominant emotion.
- A rule that `混合` describes tone only and is not an allowed final mood.
- Stress score guidance from 1 to 5.
- Examples with dream text, primary emotion, secondary emotions, score, tone, trigger source, and short rationale.

`src/app/api/analyze-dream/route.ts` will import this string and interpolate it into `ZH_SYSTEM_PROMPT`. The existing `analysisSchema` and response sanitizer will remain the source of truth for API output validation.

## Data Flow

1. The user submits dream text from Journal or Archive.
2. `/api/analyze-dream` builds the existing system prompt plus the calibration section.
3. The OpenAI chat completion returns JSON with the same fields as today.
4. Existing Zod parsing, cleanup, billing, and frontend rendering continue unchanged.

## Error Handling

No new runtime error path is expected. If OpenAI ignores the calibration or returns invalid JSON, the current parse and error handling behavior remains unchanged.

## Testing

Run:

- `npx tsc --noEmit`
- `npm run lint`

Manual/API verification:

- Send one or two calibration-like dreams to `/api/analyze-dream`.
- Confirm the returned `mood` and `stressScore` match the expected label family.
- Confirm existing fields such as `title`, `people`, `locations`, `symbols`, `sleepInsight`, `followUpQuestions`, and `visualBrief` still appear.

## Risks

The prompt will become longer, which may slightly increase token use. The dataset has only 12 examples, so it should be treated as prompt calibration, not statistical training.
