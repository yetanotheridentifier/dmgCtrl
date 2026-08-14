# Sealed docs

Each file covers one concern, so you can open the right one without reading the rest.

| File | Covers | Open it when |
| --- | --- | --- |
| [userGuide.md](userGuide.md) | how the game plays from the player's side | changing UI wording or flow |
| [architecture.md](architecture.md) | system shape, rules engine, data model, runtime flow, storage, network | orienting, or you don't know where something lives |
| [abilities.md](abilities.md) | how a card's behaviour is declared, registered and dispatched | adding or fixing a card |
| [choices.md](choices.md) | pending choices: raising, answering, prompts, the guarantees | anything that asks the player a question |
| [keywords-effects.md](keywords-effects.md) | stats pipeline, auras, lasting effects, token defeats, targeting | combat or stat rules |
| [ai-model.md](ai-model.md) | what the opponent AI thinks: terms, weights, invariants | changing how the AI plays |
| [ai-benchmark.md](ai-benchmark.md) | the benchmark harness and its modes | measuring an AI change |
| [operations.md](operations.md) | local dev, build, deploy, support playbook, diagnostics | running or supporting it |
| [experiments.md](experiments.md) | what has been measured, and which avenues it closes off | before proposing an AI change |
| [planned-work.md](planned-work.md) | what is next and what is deferred | resuming a session |

## Conventions

**These docs describe what the software does now.** They are written in the present tense and carry
no ticket numbers, no "we changed X to Y", and no build history: git and the closed issues hold that.

Two deliberate exceptions:

- **`planned-work.md`** is the one file that tracks tickets and intent.
- **Measured constraints stay**, phrased as properties rather than stories. "The pool is valued flat;
  a concave curve measured 49.7% against flat" is a fact about the system that stops someone
  re-running a dead experiment. It is not a changelog entry.

When behaviour changes, update the doc that owns that concern. When a plan changes, update
`planned-work.md`.

`userGuide.md` is **imported at build time as the in-app Help page**, so editing it changes what
players see.

Also worth knowing: `sealed/README.md` is a quick orientation and decisions log, and the root
`docs/` folder belongs to the PWA (X-Wing, SWU tracking, Kill Team), not to Sealed.
