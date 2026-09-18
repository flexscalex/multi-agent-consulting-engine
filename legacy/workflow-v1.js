export const meta = {
  name: 'firm-competition-engine',
  description: 'Three top consulting firms (McKinsey, BCG, Bain personas) compete on a brief you provide: each runs a research+strategy swarm, a review panel ranks them and issues follow-ups, each firm deepens in round 2, then a partner-grade final report is synthesized for the client.',
  phases: [
    { title: 'Firm Round 1', detail: '3 firms x (4 analysts + 1 engagement manager)' },
    { title: 'Competitive Review', detail: 'rank firms, find cross-firm gaps, issue follow-ups' },
    { title: 'Firm Round 2', detail: 'each firm researches its gaps and revises' },
    { title: 'Final Report', detail: 'partner-grade synthesis and recommendation' },
  ],
}

// ---------- shared context ----------
// The engine is brief-agnostic. Drop your strategy question into ./brief.md and the
// whole swarm works off it. Keep the brief tight: the situation, the decision to be
// made, the constraints, and what a great answer looks like.
const PROJECT_CONTEXT = `
PROJECT: A competitive consulting engagement. The full brief lives in ./brief.md.
BEFORE doing anything, read ./brief.md for the complete situation, the decision the client needs made, the constraints, and the definition of a strong answer. Treat that file as the single source of truth for scope.

ENGAGEMENT GROUND RULES (non-negotiable): No assumptions, no speculation. Cite credible, current sources. Differentiate established fact vs. educated guess vs. speculation, and state confidence levels. Say so plainly when data does not exist rather than inventing it. No em dashes in prose. Executive synthesis, not academic prose.
`

const FIRMS = [
  {
    name: 'McKinsey & Company', slug: 'mckinsey', short: 'McK',
    method: 'MECE-structured problem solving, rigorous economic modeling and quantified value-at-stake, top-down transformation logic, fact-based and hypothesis-driven, board-ready executive clarity.',
  },
  {
    name: 'Boston Consulting Group (BCG)', slug: 'bcg', short: 'BCG',
    method: 'Hypothesis-led and intellectually contrarian, innovation and growth orientation, scenario planning, build-measure-learn pilots, willing to challenge the client framing with a bolder thesis.',
  },
  {
    name: 'Bain & Company', slug: 'bain', short: 'Bain',
    method: 'Results-and-implementation first, ROI and operational rigor, private-equity-grade diligence, pragmatic sequencing, relentless focus on what actually gets executed and measured.',
  },
]

const WORKSTREAMS = [
  { key: 'evidence', title: 'Market & Evidence',
    brief: 'Build the evidence base for the brief. Size the problem and the opportunity (market size, growth, competitive dynamics, the relevant data). State clearly what is provable today vs. not. Surface the strongest current, citable data.' },
  { key: 'model', title: 'Strategy & Solution Architecture',
    brief: 'Design the recommended strategy or operating model that answers the brief: the core approach, how it is structured, the key decisions and trade-offs, and why it beats the obvious alternatives. Ground every design choice in a proven precedent or comparable case.' },
  { key: 'pilot', title: 'Business Case & Pilot Design',
    brief: 'Design one concrete, fundable pilot or first move: the target segment/profile, the unit economics, the resourcing and funding, the go-to-market, and a 12-24 month milestone plan with success metrics.' },
  { key: 'risk', title: 'Risk, Governance & Feasibility',
    brief: 'Stress-test the whole thing: execution risk, competitive response, regulatory and legal hurdles, organizational and adoption barriers, and the ways this could fail. Provide mitigations grounded in how real precedents actually handled these.' },
]

// ---------- schemas ----------
const WS_SCHEMA = {
  type: 'object',
  properties: {
    workstream: { type: 'string' },
    keyFindings: { type: 'array', items: { type: 'string' } },
    recommendations: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'array', items: { type: 'object', properties: {
      claim: { type: 'string' }, source: { type: 'string' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    }, required: ['claim', 'source', 'confidence'] } },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['workstream', 'keyFindings', 'recommendations'],
}

const DELIVERABLE_SCHEMA = {
  type: 'object',
  properties: {
    firm: { type: 'string' },
    headlineThesis: { type: 'string' },
    recommendedModel: { type: 'string' },
    pilotDesign: { type: 'string' },
    valueAtStake: { type: 'string' },
    uniqueInsights: { type: 'array', items: { type: 'string' } },
    keyRisks: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    filePath: { type: 'string' },
  },
  required: ['firm', 'headlineThesis', 'recommendedModel', 'pilotDesign', 'uniqueInsights', 'keyRisks', 'filePath'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    ranking: { type: 'array', items: { type: 'object', properties: {
      firm: { type: 'string' }, rank: { type: 'number' }, rationale: { type: 'string' },
    }, required: ['firm', 'rank', 'rationale'] } },
    perFirm: { type: 'array', items: { type: 'object', properties: {
      firm: { type: 'string' },
      strengths: { type: 'array', items: { type: 'string' } },
      gapsVsCompetitors: { type: 'array', items: { type: 'string' } },
      specificFollowUps: { type: 'array', items: { type: 'string' } },
    }, required: ['firm', 'strengths', 'gapsVsCompetitors', 'specificFollowUps'] } },
    crossCuttingInsights: { type: 'array', items: { type: 'string' } },
  },
  required: ['ranking', 'perFirm'],
}

// ---------- prompts ----------
function analystPrompt(firm, ws) {
  return `${PROJECT_CONTEXT}
YOU ARE: a senior analyst at ${firm.name}, on the engagement team competing to win this client.
YOUR FIRM'S SIGNATURE METHODOLOGY: ${firm.method}
YOUR WORKSTREAM: ${ws.title}. ${ws.brief}
Do targeted web research to strengthen your workstream (find current, citable sources). Then deliver rigorous, specific findings, clearly separating established fact from inference and flagging confidence. Your output feeds your firm's engagement manager who synthesizes the full proposal. Return structured output.`
}

function emPrompt(firm, streams) {
  return `${PROJECT_CONTEXT}
YOU ARE: the Engagement Manager / Partner at ${firm.name} leading this competitive pitch.
YOUR FIRM'S SIGNATURE METHODOLOGY: ${firm.method}
Your four workstream analysts delivered the findings below. Synthesize them into ${firm.name}'s COMPETITIVE PROPOSAL to win this client. It must unmistakably reflect your firm's distinctive methodology and voice, and withstand a sophisticated client's scrutiny.

WORKSTREAM OUTPUTS:
${JSON.stringify(streams, null, 2)}

Produce a complete, consulting-grade written deliverable with: executive summary, the recommended model/structure, a concrete pilot design with unit economics, quantified value-at-stake, the top risks with mitigations, and a clear case for why ${firm.name} is the right partner.
THEN write the full deliverable to disk: run "mkdir -p ./output/firm-competition/${firm.slug}/round1" and write it as proposal.md in that folder.
Return structured output with filePath set to the exact file you wrote.`
}

function reviewPrompt(deliverables) {
  return `${PROJECT_CONTEXT}
YOU ARE: the client's internal Chief Strategy advisor, reviewing competitive Round 1 proposals from three top consulting firms. Structured summaries are below; read the full proposals at each filePath for detail before judging.

THREE PROPOSALS:
${JSON.stringify(deliverables, null, 2)}

YOUR JOB: (1) Rank the three firms with clear rationale. (2) For EACH firm, list its strengths, the gaps relative to what COMPETITORS discovered that this firm missed or under-developed, and specific, pointed follow-up challenges to force them to deepen in Round 2. (3) Capture cross-cutting insights that emerged across all three. Be demanding and concrete. These firms are competing for a real partnership, so push them hard. Return structured output.`
}

function gapResearchPrompt(firm, question) {
  return `${PROJECT_CONTEXT}
YOU ARE: a research analyst at ${firm.name}. The client's review panel raised this specific challenge against your Round 1 proposal:
"${question}"
Do focused web research to answer it credibly with current, citable sources. Separate fact from inference, flag confidence, and note where solid data does not exist. Return structured output (treat "workstream" as the challenge you addressed).`
}

function reviserPrompt(firm, prior, feedback, competitorContext, gapResearch) {
  return `${PROJECT_CONTEXT}
YOU ARE: the Engagement Manager / Partner at ${firm.name}, revising your proposal for Round 2 to win the engagement.
YOUR FIRM'S SIGNATURE METHODOLOGY: ${firm.method}

YOUR ROUND 1 PROPOSAL (structured):
${JSON.stringify(prior, null, 2)}

THE CLIENT REVIEW PANEL'S FEEDBACK ON YOU:
${JSON.stringify(feedback, null, 2)}

WHAT COMPETING FIRMS DISCOVERED (close these gaps or beat them):
${JSON.stringify(competitorContext, null, 2)}

YOUR TEAM'S NEW GAP RESEARCH:
${JSON.stringify(gapResearch, null, 2)}

Produce a stronger, revised proposal that directly answers every follow-up, incorporates the new research, and outclasses the competitors while staying true to your firm's voice. Write it to disk: run "mkdir -p ./output/firm-competition/${firm.slug}/round2" and write it as proposal.md there. Return structured output with filePath set to the round2 file.`
}

function finalReportPrompt(round1, review, round2) {
  return `${PROJECT_CONTEXT}
YOU ARE: the client's trusted independent senior partner, writing the FINAL REPORT to the client that summarizes a competitive engagement in which three top firms (McKinsey, BCG, Bain) bid on this brief across two rounds.

ROUND 1 PROPOSALS (structured):
${JSON.stringify(round1.map(r => r.deliverable), null, 2)}

COMPETITIVE REVIEW (ranking + per-firm feedback + cross-cutting insights):
${JSON.stringify(review, null, 2)}

ROUND 2 REVISED PROPOSALS (structured):
${JSON.stringify(round2.map(r => r.revised), null, 2)}

You may read any full proposal file under ./output/firm-competition/ for detail.

Write THE definitive client report at consulting-grade standard. It must include: (1) Executive summary and the single recommended direction. (2) A side-by-side comparison of the three firms across both rounds (a clear table). (3) The synthesized best-of-all-three recommendation and a concrete recommended pilot with unit economics and a 12-24 month plan. (4) The hardest unsolved problems and how to handle them. (5) Honest confidence levels and what would need to be validated next. (6) An appendix pointing to each firm's full proposal files and the most credible sources.
No assumptions or speculation beyond what the evidence supports. No em dashes. Write the report to ./output/FINAL_REPORT_firm-competition.md, then return a tight executive summary (the headline recommendation, the firm ranking, and the recommended pilot in a few paragraphs) as your final message.`
}

function sameFirm(a, b) {
  if (!a || !b) return false
  const x = a.toLowerCase(), y = b.toLowerCase()
  return x.includes(y) || y.includes(x) || x.slice(0, 4) === y.slice(0, 4)
}

// ---------- run ----------
log('Stage 1: three firm swarms (McKinsey, BCG, Bain) each run 4 analysts + an engagement manager.')
const round1 = await parallel(FIRMS.map(firm => async () => {
  const streams = await parallel(WORKSTREAMS.map(ws => () =>
    agent(analystPrompt(firm, ws), { label: `${firm.short}:${ws.key}`, phase: 'Firm Round 1', schema: WS_SCHEMA })
  ))
  const cleanStreams = streams.filter(Boolean)
  const deliverable = await agent(emPrompt(firm, cleanStreams), { label: `${firm.short}:synthesis`, phase: 'Firm Round 1', schema: DELIVERABLE_SCHEMA })
  return { firm, streams: cleanStreams, deliverable }
}))
const live1 = round1.filter(r => r && r.deliverable)
log(`Stage 1 complete: ${live1.length} firm proposals submitted.`)

log('Stage 2: competitive review panel ranks the firms and issues follow-ups.')
const review = await agent(reviewPrompt(live1.map(r => r.deliverable)), { label: 'review-panel', phase: 'Competitive Review', schema: REVIEW_SCHEMA })

log('Stage 3: each firm researches its gaps and revises.')
const round2 = await parallel(live1.map((entry, i) => async () => {
  const firm = entry.firm
  const fb = (review.perFirm || []).find(f => sameFirm(f.firm, firm.name)) || (review.perFirm || [])[i] || { specificFollowUps: [], strengths: [], gapsVsCompetitors: [] }
  const competitorContext = live1
    .filter(r => r.firm.slug !== firm.slug)
    .map(r => ({ firm: r.firm.name, recommendedModel: r.deliverable.recommendedModel, uniqueInsights: r.deliverable.uniqueInsights }))
  const followUps = (fb.specificFollowUps || []).slice(0, 2)
  const gapResearch = (await parallel(followUps.map((q, qi) => () =>
    agent(gapResearchPrompt(firm, q), { label: `${firm.short}:gap${qi + 1}`, phase: 'Firm Round 2', schema: WS_SCHEMA })
  ))).filter(Boolean)
  const revised = await agent(reviserPrompt(firm, entry.deliverable, fb, competitorContext, gapResearch), { label: `${firm.short}:revised`, phase: 'Firm Round 2', schema: DELIVERABLE_SCHEMA })
  return { firm, revised }
}))
const live2 = round2.filter(r => r && r.revised)
log(`Stage 3 complete: ${live2.length} revised proposals.`)

log('Stage 4: synthesizing the final partner-grade report.')
const finalSummary = await agent(finalReportPrompt(live1, review, live2), { label: 'final-report', phase: 'Final Report' })

return {
  firmsCompleted: live1.length,
  revisedCompleted: live2.length,
  reportPath: './output/FINAL_REPORT_firm-competition.md',
  executiveSummary: finalSummary,
}
