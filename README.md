# Multi-Agent Consulting Engine

A multi-agent orchestration that runs a full competitive consulting engagement on a brief
you provide. Three "firms" (modeled on McKinsey, BCG, and Bain methodologies) each spin up
a swarm of analysts and an engagement manager, compete on your strategy question, get
graded by a review panel, revise based on the feedback, and then a partner agent writes a
single best-of-all-three final report.

It is a portfolio piece showing how to coordinate roughly 26 agents across four stages with
structured outputs, parallel fan-out, and a feedback loop. Drop in your own `brief.md` and
it works on any strategy question.

## What it does

You give it a brief (a strategy question, the constraints, and what a good answer looks
like). It returns a partner-grade final report that ranks three competing approaches and
synthesizes the strongest recommendation, including a concrete pilot with unit economics
and a 12 to 24 month plan.

## How the four stages work

1. **Firm Round 1 (compete).** Each of the three firms runs in parallel. Inside each firm,
   four analyst agents work four workstreams at once: Market and Evidence, Strategy and
   Solution Architecture, Business Case and Pilot Design, and Risk, Governance and
   Feasibility. Each analyst does its own web research. An engagement manager then
   synthesizes the four workstreams into that firm's full proposal and writes it to disk.

2. **Competitive Review (review).** A review-panel agent reads all three proposals, ranks
   the firms with rationale, and for each firm lists its strengths, the gaps relative to
   what competitors found, and pointed follow-up challenges to force a deeper Round 2.

3. **Firm Round 2 (revise).** Each firm gets its own feedback plus a summary of what the
   competitors discovered. It spins up fresh gap-research agents to chase the panel's
   toughest follow-ups, then the engagement manager rewrites a stronger proposal.

4. **Final Report (synthesize).** A senior-partner agent reads both rounds and the review,
   then writes the definitive client report: the single recommended direction, a
   side-by-side comparison table, the synthesized best-of-all-three recommendation with a
   concrete pilot, the hardest unsolved problems, honest confidence levels, and an
   appendix of sources.

## The agent breakdown (about 26 agents)

- **Round 1:** 3 firms x (4 analysts + 1 engagement manager) = 15 agents
- **Review:** 1 review-panel agent
- **Round 2:** per firm, up to 2 gap-research agents + 1 reviser. 3 firms x up to 3 = up to 9 agents
- **Final:** 1 partner agent

That lands around 26 agents on a full run, most of them executing in parallel.

## Design notes

- **Structured outputs.** Every stage except the final narrative returns against a JSON
  schema (workstream findings, firm deliverable, and review), so downstream agents get
  clean structured input instead of loose prose.
- **Distinct firm voices.** Each firm carries its own signature methodology in its prompts,
  so the three proposals genuinely diverge in framing rather than converging on the same
  answer.
- **Evidence discipline.** The shared ground rules push every agent to cite current
  sources, separate fact from inference, flag confidence, and admit when data does not
  exist rather than inventing it.
- **Feedback loop.** Round 2 is not just a rewrite. Firms see competitor insights and the
  panel's specific challenges, which forces real differentiation.

## How to adapt it

1. Open `brief.md` and replace the example with your own engagement. Keep it tight: the
   situation, the decision to be made, the constraints, and what a strong answer looks
   like. The whole swarm reads this file as its source of truth.
2. Optionally tune `WORKSTREAMS` in `workflow.js` if your problem needs different lenses,
   or adjust the `FIRMS` methodologies.
3. Run it in your agent harness. The workflow expects `agent()`, `parallel()`, and `log()`
   helpers plus web research tools (the same primitives most multi-agent runners expose).
   Outputs land under `./output/`.

The example `brief.md` is a generic specialty-coffee market-entry question, included only
to show the format. Swap it for anything.

## License

MIT. See `LICENSE`.
