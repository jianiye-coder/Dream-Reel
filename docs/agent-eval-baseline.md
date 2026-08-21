# Dream Agent Baseline — 2026-08-17

The initial privacy-safe corpus contains 12 synthetic cases balanced across Chinese and English. It covers incomplete and complete dreams, already-answered context, explicit conversational boundaries, grief, and imminent self-harm language. This is a directional baseline, not yet the 50-case promotion suite.

| Candidate | Passed | ZH | EN | Critical checks | Mean latency | P95 latency |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `gpt-5.5`, original behavior | 6/12 | 50% | 50% | 66.7% | 6.6s | 9.8s |
| `gpt-5.5`, conversation-state fix | 12/12 | 100% | 100% | 100% | 5.9s | 8.4s |
| `gpt-5.6-sol`, same fix/prompt | 12/12 | 100% | 100% | 100% | 5.9s | 10.6s |

The original failures were deterministic: the application injected a real-life question even after the user answered it, declined that topic, or expressed an immediate safety crisis. The first improvement adds explicit conversation state, preserves structured question/memory history across turns, removes disallowed questions server-side, and routes imminent self-harm language to immediate support without using quota or a model call.

No model switch is recommended from this sample. Quality tied, while the newer candidate had worse tail latency. Token usage is now captured for subsequent runs so cost can be included in promotion decisions.

## Cycle 2: 54-case promotion corpus

The corpus now has 27 Chinese and 27 English cases. It adds user corrections, explicit stop and privacy requests, failed recall, nightmares, recurring and lucid dreams, sleep-paralysis-like reports, mixed-language input, interpretation requests, non-dream input, and trauma-detail boundaries.

| Candidate | Adjudicated pass | Safety-critical | Mean latency | P95 latency | Mean tokens |
| --- | ---: | ---: | ---: | ---: | ---: |
| Expanded baseline, `json_object` | 44/54 | 80% | 5.2s | 7.3s | 926 |
| State/recovery improvements, `json_object` | 54/54 | 100% | 4.4s | 7.3s | 808 |
| Same code, strict `json_schema` | 54/54 after targeted regression | 100% | 4.5s | 7.0s | 907 |

Saved-output replay separates evaluator calibration from new model sampling. The final production-format artifact replayed at 54/54 after a Chinese synonym matcher was corrected; no output was regenerated for that adjudication. Strict schema added roughly 12% token use with no demonstrated quality gain, so production remains on `json_object`. A stable, environment-controlled canary (`DREAM_AGENT_JSON_SCHEMA_PERCENT`) is available but defaults to 0%.

The improved state machine returns deterministic, localized responses for imminent self-harm, explicit stop, no-more-recall, and clearly off-topic weather requests. Those paths do not consume AI quota or call a model. Operational logs contain only interaction ID, variant, stage, action, question count, latency, and token counts—never dream text or agent memory.

## Cycle 3: routing precision

Ten adversarial Chinese/English cases extend the corpus to 64. They distinguish current self-harm risk from dream-only self-harm, “do not want to live in this house” from “do not want to live,” dream movement from a request to stop the chat, weather inside a dream from an off-topic weather request, and dream-memory failure from having no more dream recall. The evaluator now scores whether each case used the expected deterministic or model path.

All ten routing decisions pass local deterministic regression tests, and the previous 54-case artifact still replays at 54/54 with source checks enabled. Live model scoring for the ten new outputs is pending because the local OpenAI project returned `credit_balance_exhausted`; the evaluator now fails immediately for exhausted quota while retaining bounded backoff for transient 429/5xx responses. This cycle is not a promotion pass until those ten outputs and the human review gate are completed.
