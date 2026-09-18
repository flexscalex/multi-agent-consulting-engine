export const meta = {
  name: 'engine-decide',
  description: 'Stage 2 of the consulting engine: independent lenses argue the decision from a verified fact base, a blind red team attacks the consensus, gaps get researched, and a partner writes a decision memo that a QC editor checks against a rubric.',
  phases: [
    { title: 'Lenses', detail: 'independent verdicts from the fact base' },
    { title: 'Challenge', detail: 'traceability audit + blind red team' },
    { title: 'Gap Research', detail: 'only material, web-resolvable challenges' },
    { title: 'Rebuttal', detail: 'full runs only: lenses answer the red team' },
    { title: 'Deliver', detail: 'partner memo + report, QC against rubric' },
  ],
}

// ---------- args (same object as workflow-factbase.js) ----------
const A = args || {}
const need = ['brief', 'projectDir', 'outDir', 'runDate']
for (const k of need) if (!A[k]) throw new Error(`args.${k} is required`)
const SIZE = A.size === 'full' ? 'full' : 'light'
const MODE = A.mode === 'greenfield' ? 'greenfield' : 'takeover'
const OUT = A.outDir.replace(/\/$/, '')
const FB = `${OUT}/factbase`
const RUBRIC = A.rubric || `${A.engineDir || '/Users/chriscousins/multi-agent-consulting-engine'}/rubric.md`

// ---------- models ----------
const RESEARCH_MODEL = 'sonnet'
const JUDGMENT_MODEL = 'opus'
const ag = (prompt, opts) => {
  const o = { ...opts }
  if (o.model === undefined) delete o.model
  return agent(prompt, o)
}

// ---------- lenses ----------
// Each lens is a seat at the table that would genuinely disagree with the others.
// Light runs use the first three. Edit freely; keep the "question" one sentence.
const LENSES = [
  { key: 'operator', title: 'Operator',
    question: 'Could a two-person team actually run this, and what breaks in month three?',
    stance: 'You have run businesses like this. You care about cash cycle, who answers the phone, trucks, liability, and the first ten customers. You distrust any plan that needs software before it needs a customer.' },
  { key: 'underwriter', title: 'Underwriter',
    question: 'Would I fund this, on what terms, and what single fact would make me walk?',
    stance: 'You underwrite small operating businesses. You care about downside, working capital, concentration risk, and whether the revenue is recurring or an event. You price everything against the base rate of comparable attempts.' },
  { key: 'premortem', title: 'Pre-mortem',
    question: 'It is two years from now and this failed. What happened, in order?',
    stance: 'You write the post-mortem before the launch. You look for the assumption everyone shares, the precondition nobody tested, and the failure that the comparable cases actually died of.' },
  { key: 'buyer', title: 'Buyer',
    question: 'I am the customer. Why would I switch to you, and what would make me stop?',
    stance: 'You are the person at the customer who signs the purchase order. You care about your own risk, your incumbent relationships, what happens when something goes wrong, and whether this saves you money or just moves it.' },
  { key: 'counsel', title: 'Counsel',
    question: 'What law, permit, classification, or contract term changes the economics or stops this?',
    stance: 'You are regulatory and commercial counsel. You care about who holds title, who carries liability, what a permit class allows, what dates are in statute versus in a press release, and what a records request can and cannot get.' },
  { key: 'incumbent', title: 'Incumbent',
    question: 'I already serve this market. How do I respond, and where is your moat not a moat?',
    stance: 'You run the established player. You know your margins, your contracts, and which of your customers are unhappy. You decide whether to ignore, copy, undercut, or buy a new entrant.' },
]
const lenses = SIZE === 'full' ? LENSES : LENSES.slice(0, 3)
const K = SIZE === 'full' ? { gapResearch: 6, searchesPerGap: 8, rebuttal: true } : { gapResearch: 2, searchesPerGap: 5, rebuttal: false }

// ---------- shared context ----------
const GROUND_RULES = `
ENGAGEMENT: Second consulting team on a takeover. Brief: ${A.brief}. Mode: ${MODE.toUpperCase()}.
YOUR INPUTS are the Stage 1 files under ${FB}: FACT_BASE.md (verified facts, each with an ID), SOURCES.md, GOTCHAS.md, DATA_GAPS.md, OPEN_ITEMS.md, plus ${OUT}/CLIENT_ANSWERS.md if it exists.
QUARANTINE.md holds the prior team's opinions and unsourced assumptions. Read it so you know what they thought, then set it aside. Nothing in it is evidence. You may reach the same conclusion only by citing F-IDs.
GROUND RULES: Every reason cites fact IDs. A statement with no ID is an assumption; label it and say why you needed it. Numbers are tagged measured, derived, or assumed. Use the client's answers where they exist; where a question is unanswered, say "unanswered" rather than guessing. No em dashes anywhere. Plain language, short sentences. Write files with mkdir -p first.
`

// ---------- schemas ----------
const LENS_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    verdict: { type: 'string', enum: ['proceed', 'proceed_with_conditions', 'do_not_proceed', 'insufficient_evidence'] },
    options: { type: 'array', items: { type: 'object', properties: {
      name: { type: 'string' }, oneLine: { type: 'string' },
    }, required: ['name', 'oneLine'] } },
    recommendedOption: { type: 'string' },
    reasons: { type: 'array', items: { type: 'object', properties: {
      text: { type: 'string' }, factIds: { type: 'array', items: { type: 'string' } },
    }, required: ['text', 'factIds'] } },
    risks: { type: 'array', items: { type: 'object', properties: {
      text: { type: 'string' }, severity: { type: 'string', enum: ['fatal', 'material', 'minor'] },
      factIds: { type: 'array', items: { type: 'string' } },
    }, required: ['text', 'severity'] } },
    wouldChangeMyMind: { type: 'array', items: { type: 'string' } },
    assumptionsMade: { type: 'array', items: { type: 'object', properties: {
      text: { type: 'string' }, whyNeeded: { type: 'string' },
    }, required: ['text', 'whyNeeded'] } },
    primaryResearchNeeded: { type: 'array', items: { type: 'object', properties: {
      question: { type: 'string' }, who: { type: 'string' }, whyItMatters: { type: 'string' },
    }, required: ['question', 'who', 'whyItMatters'] } },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    filePath: { type: 'string' },
  },
  required: ['lens', 'verdict', 'options', 'recommendedOption', 'reasons', 'risks', 'wouldChangeMyMind', 'confidence', 'filePath'],
}

const TRACE_SCHEMA = {
  type: 'object',
  properties: {
    issues: { type: 'array', items: { type: 'object', properties: {
      lens: { type: 'string' }, claim: { type: 'string' },
      problem: { type: 'string', enum: ['no_fact_id', 'fact_id_does_not_support', 'quarantined_opinion_adopted', 'number_untagged'] },
      note: { type: 'string' },
    }, required: ['lens', 'claim', 'problem'] } },
    filePath: { type: 'string' },
  },
  required: ['issues', 'filePath'],
}

const REDTEAM_SCHEMA = {
  type: 'object',
  properties: {
    challenges: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, target: { type: 'string' }, attack: { type: 'string' },
      severity: { type: 'string', enum: ['material', 'minor'] },
      resolvableBy: { type: 'string', enum: ['web', 'data', 'client', 'none'] },
      factIds: { type: 'array', items: { type: 'string' } },
    }, required: ['id', 'target', 'attack', 'severity', 'resolvableBy'] } },
    filePath: { type: 'string' },
  },
  required: ['challenges', 'filePath'],
}

const RESEARCH_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    outcome: { type: 'string', enum: ['resolved', 'partly_resolved', 'unresolved'] },
    finding: { type: 'string' },
    evidence: { type: 'array', items: { type: 'object', properties: {
      claim: { type: 'string' }, url: { type: 'string' }, quote: { type: 'string' },
      basis: { type: 'string', enum: ['measured', 'derived', 'assumed'] },
    }, required: ['claim', 'url', 'basis'] } },
    filePath: { type: 'string' },
  },
  required: ['id', 'outcome', 'finding', 'evidence', 'filePath'],
}

const QC_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    violations: { type: 'array', items: { type: 'object', properties: {
      file: { type: 'string' }, location: { type: 'string' }, rule: { type: 'string' }, fix: { type: 'string' },
    }, required: ['file', 'location', 'rule', 'fix'] } },
  },
  required: ['pass', 'violations'],
}

// ---------- Phase 1: lenses ----------
phase('Lenses')
log(`Stage 2 (${SIZE}): ${lenses.length} lenses reading ${FB}`)
const lensPrompt = (L) => `${GROUND_RULES}
YOU ARE: the ${L.title} lens. ${L.stance}
YOUR QUESTION: ${L.question}
You do not do research. You reason from the fact base. If a fact you need is missing, that is a finding: put it in primaryResearchNeeded or assumptionsMade, do not fill it in.
You may fetch at most 2 URLs from SOURCES.md to check a specific figure. No web search.

DO:
1. Read the brief and every Stage 1 file. Read QUARANTINE.md last and set it aside.
2. Lay out the real options the facts support (including "do nothing" and "do less"). Two to five options.
3. Give your verdict and the option you would pick, with reasons that cite fact IDs. Where the facts are thin, say so and lower your confidence.
4. Risks with severity. What would change your mind. Assumptions you had to make. Primary research you would commission (question, who to ask, why it matters).
5. Write your full memo to ${OUT}/lenses/${L.key}.md (dated ${A.runDate}) in the same structure, plain prose plus short lists.
Return structured output.`
const lensResults = (await pipeline(lenses, (L) =>
  ag(lensPrompt(L), { label: `lens:${L.key}`, phase: 'Lenses', model: JUDGMENT_MODEL, effort: 'high', schema: LENS_SCHEMA })
)).filter(Boolean)
if (!lensResults.length) throw new Error('no lens returned a result')
log(`Lenses: ${lensResults.map(r => `${r.lens}=${r.verdict}`).join(', ')}`)

// ---------- Phase 2: challenge ----------
phase('Challenge')
// The red team is BLIND to agreement levels and to the lenses' reasoning.
// It gets only the distinct conclusions, deduplicated, in neutral order.
const conclusions = []
for (const r of lensResults) {
  const line = `${r.recommendedOption}: ${r.options.find(o => o.name === r.recommendedOption)?.oneLine || ''}`.trim()
  if (!conclusions.includes(line)) conclusions.push(line)
}
const verdictsSeen = [...new Set(lensResults.map(r => r.verdict))]

const [trace, redteam] = await parallel([
  () => ag(`${GROUND_RULES}
YOU ARE: the traceability auditor. Mechanical job. Read every lens memo under ${OUT}/lenses/ and ${FB}/FACT_BASE.md and ${FB}/QUARANTINE.md.
Flag: any reason or risk with no fact ID; any fact ID whose text does not support the claim made; any conclusion that restates a quarantined opinion without new fact support; any number without a measured/derived/assumed tag.
Write ${OUT}/TRACEABILITY.md listing every issue. Return structured output.`,
    { label: 'traceability', phase: 'Challenge', model: RESEARCH_MODEL, effort: 'low', schema: TRACE_SCHEMA }),
  () => ag(`${GROUND_RULES}
YOU ARE: the red team. You have NOT seen the lens memos and you will not read them. You know only that the lenses' conclusions, in no particular order, were:
${conclusions.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}
and that the verdicts given included: ${verdictsSeen.join(', ')}.
Your job is to break these conclusions using only the fact base, the gotchas, the data gaps, and the client's answers. For each conclusion: the weakest assumption it rests on, the precondition nobody has tested, the comparable case where it failed, and the fact in the base that cuts against it. Also attack anything ALL conclusions seem to share. If a conclusion survives your best attack, say so plainly; do not invent a weakness.
Rate each challenge material or minor, and say what would resolve it: web (a source could settle it), data (a pull from an existing source), client (only the client knows), none (unknowable now).
Write ${OUT}/RED_TEAM.md. Return structured output.`,
    { label: 'red-team', phase: 'Challenge', model: JUDGMENT_MODEL, effort: 'high', schema: REDTEAM_SCHEMA }),
])
const challenges = redteam?.challenges || []
const traceIssues = trace?.issues || []
log(`Challenge: ${challenges.filter(c => c.severity === 'material').length} material / ${challenges.length} total; traceability issues: ${traceIssues.length}`)

// ---------- Phase 3: gap research (conditional) ----------
phase('Gap Research')
const researchable = challenges.filter(c => c.severity === 'material' && c.resolvableBy === 'web')
const toResearch = researchable.slice(0, K.gapResearch)
if (researchable.length > toResearch.length) log(`Gap research: ${researchable.length - toResearch.length} material web-resolvable challenges NOT researched (size=${SIZE}); they stay open in RED_TEAM.md`)
log(`Gap research: ${toResearch.length} challenge(s)`)
const researchPrompt = (c) => `${GROUND_RULES}
YOU ARE: a research analyst answering one red-team challenge. Use at most ${K.searchesPerGap} web searches, then fetch primary sources. Prefer government, regulator, court, filing, and academic sources over news; prefer news over blogs; never cite a page you did not open.
CHALLENGE ${c.id} against "${c.target}": ${c.attack}
Return an outcome (resolved, partly_resolved, unresolved) and evidence with URLs and short quotes. If the honest answer is "no public source settles this", say unresolved and say who would know.
Write ${OUT}/gap_research/${c.id}.md. Return structured output.`
const research = (await pipeline(toResearch, (c) =>
  ag(researchPrompt(c), { label: `research:${c.id}`, phase: 'Gap Research', model: RESEARCH_MODEL, effort: 'medium', schema: RESEARCH_SCHEMA })
)).filter(Boolean)

// ---------- Phase 4: rebuttal (full only) ----------
phase('Rebuttal')
let rebuttals = []
if (K.rebuttal) {
  rebuttals = (await pipeline(lensResults, (r) => {
    const L = lenses.find(l => l.title === r.lens || l.key === r.lens) || lenses[0]
    return ag(`${GROUND_RULES}
YOU ARE: the ${L.title} lens, revising after the red team. Your memo is ${r.filePath}. Read ${OUT}/RED_TEAM.md, ${OUT}/TRACEABILITY.md, and every file under ${OUT}/gap_research/.
Answer every challenge that touches your conclusion. Fix every traceability issue in your memo. Change your verdict if the facts now say so; keep it if they do not, and say why. Do not add new assumptions to save a conclusion.
Rewrite ${OUT}/lenses/${L.key}.md in place (dated ${A.runDate}, note "revised after red team"). Return structured output.`,
      { label: `rebut:${L.key}`, phase: 'Rebuttal', model: JUDGMENT_MODEL, effort: 'medium', schema: LENS_SCHEMA })
  })).filter(Boolean)
  log(`Rebuttal: ${rebuttals.map(r => `${r.lens}=${r.verdict}`).join(', ')}`)
} else {
  log('Rebuttal: skipped (light run). The partner reads the red team directly.')
}
const finalLenses = rebuttals.length ? rebuttals : lensResults

// ---------- Phase 5: deliver ----------
phase('Deliver')
const partnerPrompt = (violations) => `${GROUND_RULES}
YOU ARE: the partner writing to the client. Read the rubric at ${RUBRIC} first; QC will check your work against it line by line.
INPUTS: the brief; every Stage 1 file; every memo under ${OUT}/lenses/; ${OUT}/RED_TEAM.md; ${OUT}/TRACEABILITY.md; everything under ${OUT}/gap_research/; ${OUT}/CLIENT_ANSWERS.md if present.
LENS VERDICTS: ${finalLenses.map(r => `${r.lens}: ${r.verdict}, picks "${r.recommendedOption}", confidence ${r.confidence}`).join('; ')}
${violations ? `QC REJECTED YOUR PREVIOUS DRAFT. Fix every one of these, then rewrite the files:\n${JSON.stringify(violations, null, 2)}` : ''}

WRITE these files, dated ${A.runDate}:
1. ${OUT}/V1_DECISION_MEMO.md   One page. Verdict. The recommended option in two sentences. Three reasons (fact IDs). Three risks (severity). What would flip the verdict. The five things to validate next, in order, with who to call. Confidence, and what the confidence rests on.
2. ${OUT}/V1_REPORT.md          The full report per the rubric: situation from the facts; the options considered with the criteria used to compare them; the recommendation; where the lenses disagreed and why; what the red team broke and what survived; the roadmap for the next 90 days as validation steps, not a launch plan; risks; confidence by section; appendix listing every fact ID used.
3. ${OUT}/ASSUMPTIONS_REGISTER.md  Every assumption any lens or you made: text, why needed, what it changes if wrong, how to replace it with a fact.
4. ${OUT}/PRIMARY_RESEARCH_LIST.md  Every interview, records request, and data pull that would raise confidence, ranked by how much each moves the decision. Each has: what to ask, who, why it matters, what answer would change the verdict.
Rules: options and criteria before recommendation. Every number tagged. Every claim carries an F-ID or is in the assumptions register. Where the client's questions are unanswered, the report says so and shows both branches. The prior team's quarantined opinions appear only in a short section titled "What the prior team believed, and what the facts say now".
Return a short executive summary as your final message.`
let exec = await ag(partnerPrompt(null), { label: 'partner', phase: 'Deliver', model: JUDGMENT_MODEL, effort: 'high' })

const qcPrompt = () => `${GROUND_RULES}
YOU ARE: the QC editor. Read ${RUBRIC}, then ${OUT}/V1_DECISION_MEMO.md, ${OUT}/V1_REPORT.md, ${OUT}/ASSUMPTIONS_REGISTER.md, ${OUT}/PRIMARY_RESEARCH_LIST.md, and ${FB}/FACT_BASE.md and ${FB}/QUARANTINE.md for cross-checking.
Check every rubric rule. For each violation give file, location (heading or quoted phrase), the rule, and the fix. Spot-check at least ten fact IDs against FACT_BASE.md. Search for em dashes explicitly. Pass only if there are zero material violations. Return structured output.`
let qc = await ag(qcPrompt(), { label: 'qc:1', phase: 'Deliver', model: JUDGMENT_MODEL, effort: 'high', schema: QC_SCHEMA })
let qcRounds = 1
if (qc && !qc.pass) {
  log(`QC round 1: ${qc.violations.length} violation(s). Partner revising once.`)
  exec = await ag(partnerPrompt(qc.violations), { label: 'partner:revise', phase: 'Deliver', model: JUDGMENT_MODEL, effort: 'high' })
  qc = await ag(qcPrompt(), { label: 'qc:2', phase: 'Deliver', model: JUDGMENT_MODEL, effort: 'medium', schema: QC_SCHEMA })
  qcRounds = 2
}
if (qc && !qc.pass) {
  log(`QC round 2 still failing (${qc.violations.length}). Delivering with QC_NOTES.md so the reader sees what is unresolved.`)
  await ag(`Write ${OUT}/QC_NOTES.md: a plain list of these unresolved QC violations, dated ${A.runDate}, so the reader knows what to distrust in V1_REPORT.md. No em dashes.\n${JSON.stringify(qc.violations, null, 2)}`,
    { label: 'qc-notes', phase: 'Deliver', model: RESEARCH_MODEL, effort: 'low' })
}

return {
  size: SIZE, mode: MODE, runDate: A.runDate,
  lenses: finalLenses.map(r => ({ lens: r.lens, verdict: r.verdict, pick: r.recommendedOption, confidence: r.confidence })),
  redTeam: { material: challenges.filter(c => c.severity === 'material').length, total: challenges.length },
  traceabilityIssues: traceIssues.length,
  gapResearch: research.map(r => ({ id: r.id, outcome: r.outcome })),
  qc: { pass: !!(qc && qc.pass), rounds: qcRounds, openViolations: qc ? qc.violations.length : null },
  deliverables: [`${OUT}/V1_DECISION_MEMO.md`, `${OUT}/V1_REPORT.md`, `${OUT}/ASSUMPTIONS_REGISTER.md`, `${OUT}/PRIMARY_RESEARCH_LIST.md`],
  executiveSummary: exec,
}
