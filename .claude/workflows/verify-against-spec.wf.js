export const meta = {
  name: 'verify-against-spec',
  description: 'Verify-gate: adversarially check an implementation meets its spec completion criteria + codex review. Read-only. Returns PASS | GAPS.',
  phases: [{ title: 'Review' }, { title: 'Adjudicate' }, { title: 'Synthesize' }],
}

// args (passed by the caller): { specPath, diffBase, codexNote, tier }
const specPath = args && typeof args.specPath === 'string' ? args.specPath : ''
const diffBase = args && typeof args.diffBase === 'string' ? args.diffBase : 'HEAD'
const codexNote = args && typeof args.codexNote === 'string' ? args.codexNote : '(no external codex review on file)'
const tier = args && args.tier === 'light' ? 'light' : 'full'

const DIMS = tier === 'light'
  ? [{ key: 'criteria', label: 'Completion-criteria coverage' }]
  : [
      { key: 'criteria', label: 'Completion-criteria coverage' },
      { key: 'behavior', label: 'Behavior-preservation vs the codex review' },
      { key: 'regressions', label: 'Regressions and edge-cases' },
    ]

const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    criteria: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { criterion: { type: 'string' }, met: { type: 'boolean' }, note: { type: 'string' } },
        required: ['criterion', 'met', 'note'],
      },
    },
    concerns: { type: 'array', items: { type: 'string' } },
  },
  required: ['criteria', 'concerns'],
}

const VOTE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { real: { type: 'boolean' }, reasoning: { type: 'string' } },
  required: ['real', 'reasoning'],
}

const RESULT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'GAPS'] },
    gaps: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['verdict', 'gaps', 'summary'],
}

const PREAMBLE =
  'You are an adversarial verifier for a tmax (TypeScript/Bun) implementation. READ-ONLY: do not edit anything.\n' +
  'Spec: ' + specPath + ' (read it, especially its Completion Criteria).\n' +
  'Implementation: run `git diff ' + diffBase + '` to see the change.\n' +
  'External codex review note: """ ' + codexNote + ' """.\n' +
  'Be skeptical. Default to flagging a gap when a criterion is not clearly met.'

phase('Review')
log('verify-against-spec [' + tier + ']: ' + DIMS.length + ' lens(es) over ' + specPath)
const reviews = (await parallel(
  DIMS.map((d) => () =>
    agent(
      PREAMBLE + '\n\nLENS: ' + d.label + '.\n' +
        (d.key === 'criteria' ? 'For EACH Completion Criterion in the spec, decide met=true/false with a one-line note citing the diff.' : '') +
        (d.key === 'behavior' ? 'Per the codex note, is the change truly behavior-preserving (or, for a behavior-change spec, is the change the intended one AND tested)? Flag any smuggled or untested behavior change.' : '') +
        (d.key === 'regressions' ? 'Any regression, missed edge case, or broken invariant in the diff? Be concrete.' : ''),
      { label: 'verify:' + d.key, phase: 'Review', schema: REVIEW_SCHEMA, effort: 'high' }
    )
  )
)).filter(Boolean)

// Gather unmet criteria + raw concerns.
const unmet = []
for (const r of reviews) for (const c of (r.criteria || [])) if (!c.met) unmet.push(c.criterion + ' - ' + c.note)
const rawConcerns = []
for (const r of reviews) for (const c of (r.concerns || [])) rawConcerns.push(c)
const candidates = unmet.map((u) => ({ kind: 'unmet-criterion', text: u }))
  .concat(rawConcerns.map((u) => ({ kind: 'concern', text: u })))

phase('Adjudicate')
let verified = candidates
if (tier === 'full' && candidates.length > 0) {
  // 3-vote each candidate; keep if >=2 vote real.
  verified = (await parallel(
    candidates.map((c) => () =>
      parallel([0, 1, 2].map(() => () =>
        agent(
          'Adversarially check this SINGLE verify finding against the spec criteria and `git diff ' + diffBase + '`. Is it a REAL gap (criterion truly unmet / real regression / real behavior change)? Default real=false if the implementation actually satisfies it.\nFinding: ' + c.text,
          { label: 'vote', phase: 'Adjudicate', schema: VOTE_SCHEMA, effort: 'medium' }
        ).then((v) => (v && v.real) ? 1 : 0)
      )).then((votes) => ({ ...c, real: votes.filter(Boolean).length >= 2 }))
    )
  )).filter((c) => c.real)
} else if (tier === 'full') {
  verified = []
}
// light tier: keep candidates as-raised (no adjudication).

const gaps = verified.map((c) => c.text)

phase('Synthesize')
const result = await agent(
  'You are the verify-gate synthesizer. tmax uses bun (typecheck: `bun run typecheck`; tests: `bun test`). ' +
    'The caller already ran typecheck + tests GREEN, so focus ONLY on whether the diff actually satisfies the spec criteria and honors the codex review.\n' +
    'Decided gaps (adjudicated real for full tier; as-raised for light tier):\n' + JSON.stringify(gaps) + '\n' +
    'Return verdict PASS if there are NO gaps (every completion criterion met, no real regression/behavior-smuggle). Otherwise GAPS with the list.',
  { label: 'synthesize', phase: 'Synthesize', schema: RESULT_SCHEMA, effort: 'medium' }
) || { verdict: 'GAPS', gaps: ['synthesis returned no verdict'], summary: 'no verdict' }

return result
