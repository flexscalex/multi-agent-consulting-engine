# Runbook

How to run the engine on a project. Two workflows, with you in between. Nothing runs until you say so.

## Before the first run

1. Write the brief. Copy `brief.template.md` into the project (for example `<project>/engine/BRIEF.md`) and fill it in. Keep private project briefs in the private project repo, never in this public one.
2. Decide the size. `light` is the default: 5 read packets, 12 fact checks, 3 gap fills, 3 lenses, no rebuttal round. `full` is for a decision you will act on: 8 packets, 30 fact checks, 8 gap fills, 6 lenses, rebuttal round.
3. Have a Claude Code session open in the project folder, with the multi-agent Workflow tool available. Say "run a workflow" so the session knows you opted in.

## Run Stage 1: fact base

Tell the session:

```
Run the workflow at /Users/chriscousins/multi-agent-consulting-engine/workflow-factbase.js with args:
{
  "brief": "<absolute path to BRIEF.md>",
  "projectDir": "<absolute path to the project>",
  "outDir": "<absolute path to the project>/engine",
  "runDate": "YYYY-MM-DD",
  "size": "light",
  "mode": "takeover",
  "extraInputs": ["<absolute path to any memory or notes file outside the project>"]
}
```

It writes under `<outDir>/factbase/`:

| File | What it is |
|---|---|
| `inventory.md` | Every doc, data asset, and script in the project, with the read packets |
| `entries/*.json` | Raw extraction per packet (facts, opinions, gotchas, sources) |
| `FACT_BASE.md` | Facts and derived numbers with IDs (F###), sources, and verification status |
| `SOURCES.md` | Every dataset and endpoint, with auth, vintage, gotchas |
| `QUARANTINE.md` | The prior team's opinions and unsourced assumptions. Not an input to Stage 2 |
| `GOTCHAS.md`, `OPEN_ITEMS.md` | Data caveats and stated unknowns |
| `claims_ledger.csv` | One row per claim: kind, basis, source, verify status |
| `DATA_GAPS.md` | Ranked gaps with route (api, scrape, records request, phone, purchase) |
| `QUESTIONS_FOR_CLIENT.md` | Only the questions the web cannot answer |
| `gapfill/<id>/` | Any data the gap fillers actually pulled, with a README per pull |

And one page at `<outDir>/V1_FACTBASE_SUMMARY.md`.

## Between stages (this is the human gate)

1. Read `V1_FACTBASE_SUMMARY.md`. If the fact base is wrong, stop here and fix the brief or the inputs. Stage 2 is only as good as this file.
2. Open `QUESTIONS_FOR_CLIENT.md`. Answer what you can in `<outDir>/CLIENT_ANSWERS.md`, numbered to match. Leave a question blank rather than guessing; the report will show both branches.
3. Skim `QUARANTINE.md`. If something there is actually a hard constraint you set (not an opinion), move it into the brief under "Constraints".
4. Optional: make the phone calls that `DATA_GAPS.md` marks as `phone`. Put what you learned in `CLIENT_ANSWERS.md` with who said it and when.

## Run Stage 2: decide

Same args object, second script:

```
Run the workflow at /Users/chriscousins/multi-agent-consulting-engine/workflow-decide.js with the same args.
```

Optional arg: `"rubric": "<path>"` to use a project-specific rubric instead of the default.

It writes under `<outDir>/`:

| File | What it is |
|---|---|
| `lenses/<lens>.md` | One memo per lens: options, verdict, reasons with fact IDs, risks, what would change its mind |
| `TRACEABILITY.md` | Every lens claim with no fact ID, a wrong ID, or an adopted quarantined opinion |
| `RED_TEAM.md` | Attacks on the conclusions, blind to how much the lenses agreed |
| `gap_research/<id>.md` | Evidence for the material challenges that a source could settle |
| `V1_DECISION_MEMO.md` | One page. Verdict, recommendation, reasons, risks, what flips it, next five validations |
| `V1_REPORT.md` | Options and criteria, recommendation, disagreements, what the red team broke, 90-day validation roadmap, confidence by section, fact ID appendix |
| `ASSUMPTIONS_REGISTER.md` | Every assumption, why it was needed, what changes if wrong, how to replace it with a fact |
| `PRIMARY_RESEARCH_LIST.md` | Ranked calls, records requests, and pulls, each with the answer that would change the verdict |
| `QC_NOTES.md` | Only if QC failed twice: what to distrust |

## Re-running

The Workflow tool caches every agent call whose prompt and args have not changed. Re-running Stage 2 after editing a lens prompt re-runs only that lens and everything after it. Re-running with a new `runDate` re-runs everything, because the date is in the prompts. Keep the date fixed while iterating; bump it for a fresh engagement.

## Cost shape

Stage 1 light: about 1 inventory + 5 readers + 1 merge + 3 fact-check batches + 1 to 3 audit batches + 1 completeness + 3 gap fills + 1 writer. Roughly 16 to 18 agents, 3 on the judgment tier.
Stage 2 light: 3 lenses + traceability + red team + up to 2 research + partner + QC (+ one revise). Roughly 9 to 11 agents, 6 to 8 on the judgment tier.
Full runs about double both.

Models are set at the top of each script: `RESEARCH_MODEL = 'sonnet'`, `JUDGMENT_MODEL = 'opus'`. Set `JUDGMENT_MODEL` to `undefined` to inherit whatever model the session is on.

## What the engine does not do

- It does not send email, submit forms, or call anyone. Phone calls are on the primary research list for you.
- It does not modify project files. It only writes under `<outDir>`.
- It does not pay for data. Routes marked `purchase` in DATA_GAPS.md are decisions for you.
