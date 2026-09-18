export const meta = {
  name: 'engine-factbase',
  description: 'Stage 1 of the consulting engine: inventory a project folder, extract every fact, quarantine prior opinions, verify load-bearing claims, and list the data gaps. Produces the fact base the decision stage reads.',
  phases: [
    { title: 'Inventory', detail: 'map the project folder into read packets' },
    { title: 'Read', detail: 'one reader per packet, facts vs opinions' },
    { title: 'Merge', detail: 'dedupe, assign IDs, write FACT_BASE + QUARANTINE' },
    { title: 'Verify', detail: 'fetch sources, recompute derived numbers' },
    { title: 'Gaps', detail: 'what is missing, try to fill what the web can fill' },
    { title: 'Write', detail: 'final fact base, ledger, questions for the client' },
  ],
}

// ---------- args ----------
// Pass as the Workflow tool's `args` (a JSON object, not a string):
// {
//   brief:      absolute path to the engagement brief (see brief.template.md)
//   projectDir: absolute path to the project folder to inherit
//   outDir:     absolute path where outputs land (usually <projectDir>/engine)
//   runDate:    'YYYY-MM-DD' (scripts cannot read the clock)
//   size:       'light' | 'full'
//   mode:       'takeover' | 'greenfield'
//   extraInputs: optional array of absolute paths outside projectDir to read (memory files, Drive exports)
// }
const A = args || {}
const need = ['brief', 'projectDir', 'outDir', 'runDate']
for (const k of need) if (!A[k]) throw new Error(`args.${k} is required`)
const SIZE = A.size === 'full' ? 'full' : 'light'
const MODE = A.mode === 'greenfield' ? 'greenfield' : 'takeover'
const EXTRA = Array.isArray(A.extraInputs) ? A.extraInputs : []
const OUT = A.outDir.replace(/\/$/, '')
const FB = `${OUT}/factbase`

// ---------- models ----------
// Research work (reading, fetching, pulling data) runs on the cheaper tier.
// Judgment work (merging, deciding what is missing) runs on the stronger tier.
// Set JUDGMENT_MODEL to undefined to inherit the session model.
const RESEARCH_MODEL = 'sonnet'
const JUDGMENT_MODEL = 'opus'
const ag = (prompt, opts) => {
  const o = { ...opts }
  if (o.model === undefined) delete o.model
  return agent(prompt, o)
}

// ---------- size knobs ----------
const K = SIZE === 'full'
  ? { packets: 8, factCheckClaims: 30, factCheckBatch: 5, numberAuditBatch: 8, gapFill: 8, searchesPerGap: 8 }
  : { packets: 5, factCheckClaims: 12, factCheckBatch: 4, numberAuditBatch: 8, gapFill: 3, searchesPerGap: 5 }

// ---------- shared context ----------
const GROUND_RULES = `
ENGAGEMENT: You are part of a second consulting team taking over a project from a prior team. Read the brief at ${A.brief} first; it is the source of truth for scope.
MODE: ${MODE.toUpperCase()}. ${MODE === 'takeover'
  ? 'The prior team collected data and also formed strategic opinions along the way. The client has said those opinions must be QUARANTINED, not inherited. Facts stay. Data stays. Conclusions, recommendations, rankings, "the wedge is", "never do X", "everything points at Y" are opinions and go to quarantine. You may later reach the same conclusion only by citing facts.'
  : 'There is no prior work to inherit. Everything must be built from sources.'}
GROUND RULES: Zero fabrication. Every fact carries a source you can point to (file path with line, or URL). Separate measured, derived, assumed, and opinion. A number without a basis is an assumption and is labeled as one. If data does not exist, say so; do not estimate around it. No em dashes anywhere in anything you write. Plain language, short sentences. Write files with mkdir -p first.
`

// ---------- schemas ----------
const INVENTORY_SCHEMA = {
  type: 'object',
  properties: {
    packets: { type: 'array', items: { type: 'object', properties: {
      key: { type: 'string' }, title: { type: 'string' },
      files: { type: 'array', items: { type: 'string' } },
      notes: { type: 'string' },
    }, required: ['key', 'title', 'files'] } },
    dataAssets: { type: 'array', items: { type: 'object', properties: {
      path: { type: 'string' }, rows: { type: 'number' }, whatItIs: { type: 'string' },
    }, required: ['path', 'whatItIs'] } },
    warnings: { type: 'array', items: { type: 'string' } },
    inventoryPath: { type: 'string' },
  },
  required: ['packets', 'dataAssets', 'inventoryPath'],
}

const READ_SCHEMA = {
  type: 'object',
  properties: {
    packet: { type: 'string' },
    entriesPath: { type: 'string' },
    counts: { type: 'object', properties: {
      fact: { type: 'number' }, derived: { type: 'number' }, assumption: { type: 'number' },
      opinion: { type: 'number' }, gotcha: { type: 'number' }, open_item: { type: 'number' }, source: { type: 'number' },
    } },
    loadBearing: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, text: { type: 'string' }, source: { type: 'string' },
    }, required: ['id', 'text', 'source'] } },
  },
  required: ['packet', 'entriesPath', 'counts', 'loadBearing'],
}

const MERGE_SCHEMA = {
  type: 'object',
  properties: {
    counts: { type: 'object', properties: {
      facts: { type: 'number' }, derived: { type: 'number' }, sources: { type: 'number' },
      quarantined: { type: 'number' }, gotchas: { type: 'number' }, openItems: { type: 'number' },
    } },
    factCheckTargets: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, claim: { type: 'string' }, url: { type: 'string' },
    }, required: ['id', 'claim', 'url'] } },
    numberAuditTargets: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, claim: { type: 'string' }, method: { type: 'string' },
    }, required: ['id', 'claim', 'method'] } },
    files: { type: 'array', items: { type: 'string' } },
  },
  required: ['counts', 'factCheckTargets', 'numberAuditTargets', 'files'],
}

const FACTCHECK_SCHEMA = {
  type: 'object',
  properties: {
    results: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' },
      status: { type: 'string', enum: ['verified', 'unverified', 'contradicted', 'unreachable'] },
      checkedUrl: { type: 'string' },
      found: { type: 'string' },
      note: { type: 'string' },
    }, required: ['id', 'status', 'checkedUrl', 'note'] } },
  },
  required: ['results'],
}

const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    results: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' },
      status: { type: 'string', enum: ['reproduced', 'not_reproduced', 'cannot_check'] },
      recomputed: { type: 'string' },
      inputsUsed: { type: 'string' },
      note: { type: 'string' },
    }, required: ['id', 'status', 'note'] } },
  },
  required: ['results'],
}

const GAPS_SCHEMA = {
  type: 'object',
  properties: {
    gaps: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, gap: { type: 'string' }, whyItMatters: { type: 'string' },
      route: { type: 'string', enum: ['api', 'scrape', 'records_request', 'phone', 'purchase', 'unknown'] },
      candidateSource: { type: 'string' }, blocking: { type: 'boolean' },
    }, required: ['id', 'gap', 'whyItMatters', 'route', 'blocking'] } },
    gapsPath: { type: 'string' },
    questionsPath: { type: 'string' },
  },
  required: ['gaps', 'gapsPath', 'questionsPath'],
}

const GAPFILL_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    outcome: { type: 'string', enum: ['filled', 'located', 'blocked', 'does_not_exist'] },
    whatFound: { type: 'string' },
    url: { type: 'string' },
    howToPull: { type: 'string' },
    outputPath: { type: 'string' },
    newFacts: { type: 'array', items: { type: 'object', properties: {
      text: { type: 'string' }, source: { type: 'string' },
      basis: { type: 'string', enum: ['measured', 'derived', 'assumed'] },
    }, required: ['text', 'source', 'basis'] } },
  },
  required: ['id', 'outcome', 'whatFound'],
}

// ---------- Phase 1: inventory ----------
phase('Inventory')
log(`Stage 1 (${SIZE}, ${MODE}): inventorying ${A.projectDir}`)
const inventory = await ag(`${GROUND_RULES}
YOU ARE: the intake analyst. Map the project folder so readers can split it up.
PROJECT FOLDER: ${A.projectDir}
EXTRA INPUTS (read these too, they are part of the inherited work): ${EXTRA.length ? EXTRA.join(', ') : 'none'}

DO:
1. List every markdown, text, and notes file (skip node_modules, .git, .venv, __pycache__, binaries). Record path and line count.
2. For every CSV/JSON under a derived/ or output/ folder: path, row count, header line, one sentence on what it is (from the README or the script that made it). For raw data folders, list file names and sizes only. Do not open large raw files.
3. For every script: path and a one-line purpose from its docstring or first comment.
4. Group the prose documents (md/txt, plus scripts' doc headers if long) into at most ${K.packets} read packets of roughly equal size, around 40k characters each. Long files may be split across packets by line range: write "path#L1-L400". Put README, HANDOVER, any coefficients or methodology notes, and the extra inputs in the FIRST packet. Every prose file must land in exactly one packet.
5. Write the full inventory to ${FB}/inventory.md.
Return structured output. inventoryPath is the file you wrote.`, { label: 'inventory', phase: 'Inventory', model: RESEARCH_MODEL, effort: 'medium', schema: INVENTORY_SCHEMA })
if (!inventory) throw new Error('inventory agent returned nothing')
log(`Inventory: ${inventory.packets.length} packets, ${inventory.dataAssets.length} data assets`)

// ---------- Phase 2: read packets ----------
const readPrompt = (p) => `${GROUND_RULES}
YOU ARE: a reader on the intake team. Packet "${p.title}" (key ${p.key}).
FILES IN YOUR PACKET (read every one, fully, respecting line ranges): ${p.files.join(' | ')}
${p.notes ? `NOTES: ${p.notes}` : ''}

Extract every distinct claim into entries. Each entry has:
  id: "${p.key}-NNN" (zero-padded, sequential)
  kind: one of
    fact        = measured or pulled from a named dataset or document, with a source
    derived     = computed from facts with a stated method (say what the method is)
    assumption  = a number or premise used without a source, or with a source that only supports part of it
    opinion     = a strategic conclusion, recommendation, ranking, framing, or "do not chase X". Quarantine material.
    gotcha      = a data-quality or access caveat (nulls mean unknown, bot-blocked host, stale table)
    open_item   = a stated unknown or to-do
    source      = a dataset, endpoint, registry, or document, with URL/path, auth, and vintage
  text: the claim in one or two plain sentences, numbers kept exact
  source: file path with line (path:L123) or the URL the file cites
  asStatedConfidence: whatever the prior team said (high/medium/low/tier letter/none)
  numbers: list of {value, unit, basis} for each number in the claim; basis = measured | derived | assumed
  loadBearing: true if a decision would change were this claim wrong
  urls: any URLs cited for the claim

Be exhaustive. A packet with 400 lines typically yields 60 to 150 entries. Do not summarize; extract.
Write all entries as a JSON array to ${FB}/entries/${p.key}.json (mkdir -p first).
Return structured output: counts by kind, and the loadBearing entries (id, text, source) only. Do not return the full list.`

phase('Read')
const reads = (await pipeline(inventory.packets, (p) =>
  ag(readPrompt(p), { label: `read:${p.key}`, phase: 'Read', model: RESEARCH_MODEL, effort: 'medium', schema: READ_SCHEMA })
)).filter(Boolean)
const dropped = inventory.packets.length - reads.length
if (dropped) log(`WARNING: ${dropped} packet(s) failed to read and are missing from the fact base`)
log(`Read: ${reads.length} packets, ${reads.reduce((n, r) => n + (r.loadBearing || []).length, 0)} load-bearing entries flagged`)

// ---------- Phase 3: merge ----------
phase('Merge')
const merged = await ag(`${GROUND_RULES}
YOU ARE: the engagement manager assembling the fact base. Readers wrote entry files here: ${reads.map(r => r.entriesPath).join(', ')}. Read every file. Also read ${FB}/inventory.md.

DO:
1. Dedupe entries that state the same claim. Keep the most specific source.
2. Assign final IDs: F### facts and derived (mark derived in a column), S### sources, G### gotchas, Q### quarantined (opinions AND unsourced assumptions), O### open items.
3. Write these files:
   ${FB}/FACT_BASE.md      facts and derived, grouped by topic. Per entry: ID, claim, basis (measured/derived), source, as-stated confidence, verification: pending. Derived entries name their inputs and method.
   ${FB}/SOURCES.md        every dataset and endpoint: what it is, URL or path, auth, vintage, known gotchas (link G IDs).
   ${FB}/QUARANTINE.md     every opinion and assumption, verbatim, with where it came from and this line for each: "Reinstate only if: <the fact that would be needed>". State at the top that nothing in this file is an input to the decision stage.
   ${FB}/GOTCHAS.md        data caveats, each linked to the sources and facts it affects.
   ${FB}/OPEN_ITEMS.md     the prior team's stated unknowns.
   ${FB}/claims_ledger.csv header exactly: id,kind,basis,claim,source,as_stated_confidence,load_bearing,verify_status,verify_note
4. Pick verification targets:
   factCheckTargets: the load-bearing facts that cite a URL. Rank by how much the decision leans on them. Return up to ${K.factCheckClaims}.
   numberAuditTargets: the load-bearing derived numbers, with the method and input files as the prior team described them. Return up to ${K.numberAuditBatch * 3}.
Return structured output with counts, both target lists, and the files you wrote.`, { label: 'merge', phase: 'Merge', model: JUDGMENT_MODEL, effort: 'high', schema: MERGE_SCHEMA })
if (!merged) throw new Error('merge agent returned nothing')
log(`Fact base: ${merged.counts.facts || 0} facts, ${merged.counts.sources || 0} sources, ${merged.counts.quarantined || 0} quarantined`)

// ---------- Phase 4: verify ----------
phase('Verify')
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }
const fcTargets = (merged.factCheckTargets || []).slice(0, K.factCheckClaims)
const fcDropped = (merged.factCheckTargets || []).length - fcTargets.length
if (fcDropped > 0) log(`Fact-check: checking ${fcTargets.length}, skipping ${fcDropped} lower-ranked claims (size=${SIZE})`)
const fcBatches = chunk(fcTargets, K.factCheckBatch)

const factCheckPrompt = (batch, i) => `${GROUND_RULES}
YOU ARE: a fact checker. Fetch only. Do NOT use web search. For each claim, fetch its URL and find the statement or number.
If the host blocks you or the page changed, try the Wayback Machine: https://web.archive.org/web/2026/<url> (also try 2025). Record which URL you actually read.
Statuses: verified (source says this, numbers match), unverified (could not find the statement on the page), contradicted (source says something different; quote it), unreachable (no live or archived copy).
A number that is close but not equal is contradicted, not verified. Say the difference.
CLAIMS:
${JSON.stringify(batch, null, 2)}
Return structured output.`
const factChecks = (await pipeline(fcBatches, (b, _, i) =>
  ag(factCheckPrompt(b, i), { label: `factcheck:${i + 1}`, phase: 'Verify', model: RESEARCH_MODEL, effort: 'low', schema: FACTCHECK_SCHEMA })
)).filter(Boolean).flatMap(r => r.results)

const auditBatches = chunk((merged.numberAuditTargets || []), K.numberAuditBatch)
const auditPrompt = (batch, i) => `${GROUND_RULES}
YOU ARE: the numbers auditor. For each derived claim, find its inputs and method in the project (scripts, coefficient notes, derived CSVs) and recompute it. You may run existing scripts read-only or compute directly from the CSVs with python3 or awk. Do not modify any project file.
Statuses: reproduced (your recomputation matches within rounding), not_reproduced (you got a different number; give yours and the inputs), cannot_check (inputs or method not available; say what is missing).
Record every input you used so a reader can repeat it.
PROJECT: ${A.projectDir}
CLAIMS:
${JSON.stringify(batch, null, 2)}
Return structured output.`
const audits = (await pipeline(auditBatches, (b, _, i) =>
  ag(auditPrompt(b, i), { label: `audit:${i + 1}`, phase: 'Verify', model: RESEARCH_MODEL, effort: 'high', schema: AUDIT_SCHEMA })
)).filter(Boolean).flatMap(r => r.results)
const tally = (arr, key) => arr.reduce((m, r) => { m[r[key]] = (m[r[key]] || 0) + 1; return m }, {})
log(`Verify: fact-check ${JSON.stringify(tally(factChecks, 'status'))}; number audit ${JSON.stringify(tally(audits, 'status'))}`)

// ---------- Phase 5: gaps ----------
phase('Gaps')
const gaps = await ag(`${GROUND_RULES}
YOU ARE: the completeness analyst. The client's words: "decide what you need to validate or dive into more for the data set to be more complete." Read the brief's "what complete looks like" section, then ${FB}/FACT_BASE.md, ${FB}/SOURCES.md, ${FB}/GOTCHAS.md, ${FB}/OPEN_ITEMS.md.
Verification results so far (use them; a contradicted or not_reproduced item is a gap):
FACT CHECKS: ${JSON.stringify(factChecks)}
NUMBER AUDITS: ${JSON.stringify(audits)}

DO:
1. List every gap in the data set, ranked by how much a decision depends on it. For each: what is missing, why it matters, the route to get it (api, scrape, records_request, phone, purchase, unknown), a candidate source, and whether it blocks a decision.
   Include gaps the prior team never noticed, not just their open items. Ask: which data pools exist for this problem that are not in SOURCES.md at all?
2. Write ${FB}/DATA_GAPS.md.
3. Write ${FB}/QUESTIONS_FOR_CLIENT.md: only questions the client can answer and the web cannot (relationships, budget, what they will and will not do, what a contact told them). Keep it short. Number them.
Return structured output.`, { label: 'completeness', phase: 'Gaps', model: JUDGMENT_MODEL, effort: 'high', schema: GAPS_SCHEMA })
if (!gaps) throw new Error('completeness agent returned nothing')

const fillable = (gaps.gaps || []).filter(g => g.route === 'api' || g.route === 'scrape')
const toFill = fillable.slice(0, K.gapFill)
log(`Gaps: ${(gaps.gaps || []).length} total, ${fillable.length} web-reachable, filling ${toFill.length} now (size=${SIZE})${fillable.length > toFill.length ? `, ${fillable.length - toFill.length} left in DATA_GAPS.md` : ''}`)
const gapFillPrompt = (g) => `${GROUND_RULES}
YOU ARE: a research analyst closing one data gap. Use at most ${K.searchesPerGap} web searches, then fetch.
GAP ${g.id}: ${g.gap}
WHY IT MATTERS: ${g.whyItMatters}
CANDIDATE SOURCE: ${g.candidateSource || 'none given'}
Outcomes: filled (you obtained the data and saved it), located (you found where it lives and how to pull it, but did not pull), blocked (exists but unreachable; say why), does_not_exist (you looked properly and it is not published anywhere).
If you pull data, save it under ${FB}/gapfill/${g.id}/ with a README.md stating the URL, the date ${A.runDate}, and the exact request. Never invent a row.
Return structured output. newFacts only for things you actually read.`
const fills = (await pipeline(toFill, (g) =>
  ag(gapFillPrompt(g), { label: `gapfill:${g.id}`, phase: 'Gaps', model: RESEARCH_MODEL, effort: 'medium', schema: GAPFILL_SCHEMA })
)).filter(Boolean)
log(`Gap fill: ${JSON.stringify(tally(fills, 'outcome'))}`)

// ---------- Phase 6: write ----------
phase('Write')
const summary = await ag(`${GROUND_RULES}
YOU ARE: the engagement manager finishing Stage 1. Fold the verification and gap-fill results into the fact base so Stage 2 reads one clean set of files.
INPUTS: ${FB}/FACT_BASE.md, ${FB}/claims_ledger.csv, ${FB}/DATA_GAPS.md, ${FB}/QUESTIONS_FOR_CLIENT.md
FACT CHECKS: ${JSON.stringify(factChecks)}
NUMBER AUDITS: ${JSON.stringify(audits)}
GAP FILLS: ${JSON.stringify(fills)}

DO:
1. Update claims_ledger.csv: set verify_status and verify_note for every checked ID. Unchecked load-bearing claims get verify_status "unchecked".
2. Update FACT_BASE.md: replace "verification: pending" with the result. Downgrade the confidence of anything contradicted or not_reproduced and say why. Add new facts from gap fills with new F IDs and their sources.
3. Write ${OUT}/V1_FACTBASE_SUMMARY.md (one page): what is solid (verified), what is shaky (unverified or not reproduced), what is missing (top gaps), what the client must answer before Stage 2, and which prior opinions are now sitting in quarantine. Date it ${A.runDate}. Every statement points at an ID.
Return the summary text as your final message.`, { label: 'write', phase: 'Write', model: JUDGMENT_MODEL, effort: 'medium' })

return {
  size: SIZE, mode: MODE, runDate: A.runDate,
  packetsRead: reads.length, packetsDropped: dropped,
  counts: merged.counts,
  factCheck: tally(factChecks, 'status'),
  numberAudit: tally(audits, 'status'),
  gaps: (gaps.gaps || []).length, gapFill: tally(fills, 'outcome'),
  factBase: `${FB}/FACT_BASE.md`,
  summaryPath: `${OUT}/V1_FACTBASE_SUMMARY.md`,
  nextStep: `Read ${OUT}/V1_FACTBASE_SUMMARY.md and ${FB}/QUESTIONS_FOR_CLIENT.md. Answer what you can in ${OUT}/CLIENT_ANSWERS.md. Then run workflow-decide.js with the same args.`,
  summary,
}
