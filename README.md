# Multi-Agent Consulting Engine

A multi-agent workflow that takes over a project the way a second consulting team would: inherit the data the first team collected, set their opinions aside, verify what matters, find what is missing, and let the facts pick the route. It runs on a project folder (docs, data pulls, scripts, notes) and writes a decision memo a client could act on, with every claim traceable to a fact and every number tagged measured, derived, or assumed.

This is v2. The v1 engine (three consulting-firm personas competing across two rounds) lives on the `main` branch and under `legacy/`. V2 replaces the personas with lenses that actually disagree, adds a verification stage, gives every run a way to say "do not proceed" or "insufficient evidence", and cuts the research spend by doing research once instead of once per agent.

## What comes out

- **A decision memo.** One page. Verdict, recommendation, three reasons, three risks, what would flip it, the next five things to validate and who to call.
- **A full report.** Options and criteria before the recommendation, where the lenses disagreed, what the red team broke and what survived, a 90-day validation roadmap, confidence by section, and an appendix of every fact ID used.
- **A claims ledger.** One CSV row per claim with its source and verification status. Reusable across runs.
- **An assumptions register** and a **ranked primary-research list**: the calls, records requests, and data pulls that would raise confidence, each with the answer that would change the verdict.

## How it works

Two workflows, with a human gate between them. See `RUNBOOK.md` for the exact commands.

**Stage 1, fact base** (`workflow-factbase.js`)

1. Inventory the project folder and split the prose into read packets.
2. One reader per packet extracts every claim and labels it: fact, derived, assumption, opinion, gotcha, open item, or source.
3. A merge step dedupes, assigns IDs, and writes `FACT_BASE.md`, `SOURCES.md`, `QUARANTINE.md` (the prior team's opinions, explicitly not an input), and a claims ledger.
4. Verification: fact checkers fetch the cited URL (or its Wayback copy) for the load-bearing claims and mark each verified, unverified, contradicted, or unreachable. A numbers auditor recomputes derived figures from the project's own inputs.
5. A completeness analyst ranks the data gaps against the brief's definition of "complete" and writes the questions only the client can answer. Gap fillers try to pull what the web can supply.

You then read the one-page summary, answer the client questions, and decide whether to continue.

**Stage 2, decide** (`workflow-decide.js`)

1. Independent lenses (operator, underwriter, pre-mortem; plus buyer, counsel, incumbent on full runs) each read the fact base and return options, a verdict, reasons with fact IDs, risks, what would change their mind, and the primary research they would commission. They do not research; a missing fact is a finding.
2. A traceability auditor flags any lens claim without a fact ID or that quietly re-adopts a quarantined opinion. In parallel, a red team that has not seen the lens memos, only their bare conclusions, attacks them from the fact base.
3. Material challenges that a source could settle get researched. Everything else stays open and visible.
4. On full runs, each lens answers the red team and may change its verdict.
5. A partner writes the deliverables against `rubric.md`. A QC editor checks every rule and sends it back once if it fails.

## Design notes

- **Research once, read many.** Lenses reason from one shared fact base rather than each doing their own web research. Facts are established once; disagreement lives in interpretation.
- **Quarantine, not deletion.** The prior team's opinions are kept in one file with "reinstate only if" conditions, so a conclusion can be re-earned with evidence but never inherited.
- **Blind red team.** It sees only the conclusions, not the reasoning or how many lenses agreed, so it cannot soften into agreement.
- **Verification is a separate stage.** Citation checking is never folded into the writer.
- **A way to say no.** Verdicts are proceed, proceed with conditions, do not proceed, or insufficient evidence. "Do nothing" and "do less" are always among the options.
- **Tiered models.** Reading, fetching, and pulling run on the cheaper tier; merging, deciding, red-teaming, and writing run on the stronger tier. Both are constants at the top of each script.
- **No silent caps.** Every place the run bounds its own coverage (fact checks, gap fills, research) logs what was skipped.

## Adapting it

- Copy `brief.template.md` into your project and fill it in. Keep private briefs in private repos.
- Edit `LENSES` in `workflow-decide.js` to change who sits at the table. Keep each lens's question to one sentence.
- Edit `rubric.md` to change what QC enforces.
- The scripts expect the Claude Code Workflow runtime: `agent()`, `parallel()`, `pipeline()`, `log()`, `phase()`, and `args`. Agents need file read/write, shell, web fetch, and web search.

## License

MIT. See `LICENSE`.
