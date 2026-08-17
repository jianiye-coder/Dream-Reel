# Dream Agent Baseline — 2026-08-17

The initial privacy-safe corpus contains 12 synthetic cases balanced across Chinese and English. It covers incomplete and complete dreams, already-answered context, explicit conversational boundaries, grief, and imminent self-harm language. This is a directional baseline, not yet the 50-case promotion suite.

| Candidate | Passed | ZH | EN | Critical checks | Mean latency | P95 latency |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `gpt-5.5`, original behavior | 6/12 | 50% | 50% | 66.7% | 6.6s | 9.8s |
| `gpt-5.5`, conversation-state fix | 12/12 | 100% | 100% | 100% | 5.9s | 8.4s |
| `gpt-5.6-sol`, same fix/prompt | 12/12 | 100% | 100% | 100% | 5.9s | 10.6s |

The original failures were deterministic: the application injected a real-life question even after the user answered it, declined that topic, or expressed an immediate safety crisis. The first improvement adds explicit conversation state, preserves structured question/memory history across turns, removes disallowed questions server-side, and routes imminent self-harm language to immediate support without using quota or a model call.

No model switch is recommended from this sample. Quality tied, while the newer candidate had worse tail latency. Token usage is now captured for subsequent runs so cost can be included in promotion decisions.
