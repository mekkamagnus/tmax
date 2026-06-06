# AI Subscription Feature — Gap Analysis

What tmax needs to build to ship the AI subscription model described in business-model-overview.md, measured against what exists today.

## Executive Summary

tmax has a solid foundation — daemon/client architecture, full T-Lisp interpreter with AST access, modular frontend — but none of the infrastructure for AI features exists yet. The work breaks into four layers: AI bridge, subscription system, frontend components, and backend service. Estimated effort: 4-6 months for a paid beta.

---

## Layer 1: AI Bridge (Editor ↔ AI Backend)

The piece that extracts T-Lisp context, sends it to the AI, validates the response, and presents it to the user.

### What Exists

- `src/tlisp/parser.ts` — `parse()` returns full AST nodes
- `src/tlisp/interpreter.ts` — `evaluate()` with environment chain, `globalEnv` for introspection
- `src/tlisp/tokenizer.ts` — source positions available via tokenizer
- `src/server/server.ts` — JSON-RPC 2.0 bidirectional communication between client and daemon
- T-Lisp module system — `defmodule`, `import`, module registry for discovering loaded modules

### Gaps

| Gap | Why It Matters | Effort |
|-----|---------------|--------|
| **Context builder** | No way to assemble "current buffer + loaded modules + editor APIs + user config" into a structured AI prompt | 2-3 weeks |
| **AST serializer** | AST nodes exist but have no serialization to a format an LLM can consume (e.g., JSON representation with types and positions) | 1 week |
| **Editor API docs extraction** | No machine-readable docs for the 100+ T-Lisp editor functions — the AI needs these in its system prompt | 1-2 weeks |
| **Code validator** | No way to take AI-generated T-Lisp, parse it, eval it in a sandbox, and return pass/fail + error messages | 1-2 weeks |
| **Streaming response handler** | JSON-RPC is request/response — AI responses need streaming (SSE/WebSocket) for incremental display | 1-2 weeks |
| **Confidence scoring** | No mechanism to score how likely generated code is to work (parse success, available APIs referenced, etc.) | 1 week |

### New Files Needed

```
src/ai/
├── context-builder.ts    # Assemble prompt from editor state
├── ast-serializer.ts     # AST → LLM-friendly format
├── code-validator.ts     # Parse + sandbox eval of AI output
├── response-handler.ts   # Stream AI responses to client
└── types.ts              # AI request/response types
```

---

## Layer 2: Subscription System

Authentication, feature gating, usage tracking, and tier enforcement.

### What Exists

- `src/server/server.ts` — client lifecycle tracking, frame management
- `~/.config/tmax/init.tlisp` — per-user configuration
- Editor state with settings (theme, tabSize, etc.)

### Gaps

| Gap | Why It Matters | Effort |
|-----|---------------|--------|
| **User authentication** | No user identity — daemon trusts all Unix socket connections | 2-3 weeks |
| **API key management** | No way to store, validate, or rotate API keys | 1 week |
| **Feature gate framework** | No mechanism to enable/disable features per tier (Free vs Pro vs Team vs Enterprise) | 1-2 weeks |
| **Usage tracking** | No request counting, quota enforcement, or usage persistence | 1-2 weeks |
| **Tier configuration** | No config schema for subscription tiers, limits, and included features | 1 week |
| **License validation** | No offline license verification or grace period handling | 1 week |

### New Files Needed

```
src/server/
├── auth.ts               # User auth, API key validation
├── feature-gate.ts       # Tier-based feature access
├── usage-tracker.ts      # Request counting, quota enforcement
└── license.ts            # Offline license validation

src/types/
└── subscription.ts       # Tier definitions, feature flags
```

### Tier Feature Matrix

| Feature | Free | Pro ($12) | Team ($25/user) | Enterprise |
|---------|------|-----------|-----------------|------------|
| Editor + T-Lisp | Yes | Yes | Yes | Yes |
| AI code generation | No | Yes | Yes | Yes |
| AI inline completion | No | Yes | Yes | Yes |
| AI chat | No | Yes | Yes | Yes |
| AI requests/mo | 0 | 2,000 | 10,000 | Unlimited |
| Team module library | No | No | Yes | Yes |
| Config sync | No | No | Yes | Yes |
| Self-hosted AI | No | No | No | Yes |
| SSO/SAML | No | No | No | Yes |
| Audit logs | No | No | No | Yes |

---

## Layer 3: Frontend Components

The UI elements users interact with: chat sidebar, ghost-text completions, AI panels.

### What Exists

- `src/client/tui-client.ts` — ANSI terminal renderer with buffer, status line, command input, minibuffer
- `src/frontend/` — Ink/React components (BufferView, StatusLine, CommandInput, MinibufferView)
- Strict "dumb component" pattern — no business logic in rendering layer
- Key handling with raw mode input and T-Lisp integration

### Gaps

| Gap | Why It Matters | Effort |
|-----|---------------|--------|
| **AI chat sidebar/panel** | No split-pane or overlay UI — the entire screen is the editor buffer + status line | 2-3 weeks |
| **Ghost-text inline completion** | No mechanism to render "phantom" text (suggested but not yet accepted) at cursor position | 2 weeks |
| **AI action bar** | No UI for [Enter] Apply / [e] Edit / [m] Modify / [q] Quit on AI suggestions | 1 week |
| **Streaming text display** | Terminal rendering is snapshot-based — no incremental text append for streaming AI responses | 1 week |
| **M-x integration for AI** | `ai-assist` needs to be a new command mode or M-x command with text input | 1 week |
| **Diff/apply preview** | No way to show "what will change" before accepting AI-generated code | 1-2 weeks |

### New Files Needed

```
src/client/
├── ai-panel.ts           # Split-pane AI chat display
├── ghost-text.ts         # Inline suggestion rendering
└── ai-actions.ts         # Accept/edit/modify/quit UI

src/frontend/
├── AiChat.tsx            # Ink component for AI conversation
├── GhostText.tsx         # Inline completion overlay
└── AiActionBar.tsx       # Suggestion action buttons
```

---

## Layer 4: Backend Service

The cloud service that authenticates users, routes AI requests, and manages subscriptions.

### What Exists

- Nothing. tmax is fully local — no cloud component exists.

### Gaps

| Gap | Why It Matters | Effort |
|-----|---------------|--------|
| **User accounts** | Signup, login, email verification, password reset | 2-3 weeks |
| **Subscription billing** | Stripe integration for recurring payments, tier changes, invoices | 2-3 weeks |
| **AI request proxy** | HTTPS endpoint that takes editor context, calls Claude API, streams response back | 2 weeks |
| **Rate limiting + quota** | Per-user request counting with monthly reset | 1 week |
| **Admin dashboard** | Usage metrics, revenue tracking, user management | 2-3 weeks |
| **Self-hosted option** | For Enterprise tier — bundle AI backend for on-prem deployment | 2-3 weeks |

### Tech Stack Decision Needed

| Option | Pros | Cons |
|--------|------|------|
| **Bun + tmax server** | Same stack as editor, reuse T-Lisp knowledge | No ecosystem for billing/auth |
| **Next.js + Supabase** | Auth + DB + edge functions built in | Different stack from core project |
| **Cloudflare Workers** | Edge-fast, cheap, streaming support | Cold starts, limited runtime |
| **Hono + Turso** | Lightweight, Bun-compatible, fast DB | Build auth from scratch |

**Recommendation:** Hono + Turso + Stripe. Keeps the Bun runtime, minimal dependencies, and Hono has first-class Bun support.

### Infrastructure

```
├── api/                      # Cloud backend
│   ├── routes/
│   │   ├── auth.ts           # Login, signup, API keys
│   │   ├── ai.ts             # AI request proxy → Claude API
│   │   ├── subscription.ts   # Stripe webhooks, tier changes
│   │   └── usage.ts          # Quota queries, usage history
│   ├── middleware/
│   │   ├── auth.ts           # JWT validation
│   │   └── rate-limit.ts     # Per-user throttling
│   ├── db/
│   │   ├── schema.sql        # Users, subscriptions, usage
│   │   └── migrations/
│   └── stripe/
│       ├── webhooks.ts       # Payment events
│       └── tiers.ts          # Plan definitions
```

---

## Dependency Graph

```
Phase 1 (Month 1-2): Foundation
├── Feature gate framework
├── API key management
├── AST serializer
└── Context builder

Phase 2 (Month 2-3): Core AI
├── Code validator (depends on: AST serializer)
├── AI request proxy backend (depends on: auth)
├── Streaming response handler (depends on: proxy)
└── M-x ai-assist command (depends on: context builder)

Phase 3 (Month 3-4): Frontend
├── AI chat panel (depends on: streaming handler)
├── Ghost-text completion (depends on: code validator)
├── AI action bar (depends on: chat panel)
└── Diff/apply preview (depends on: action bar)

Phase 4 (Month 4-5): Billing
├── Stripe integration (depends on: auth)
├── Usage tracking (depends on: rate limiting)
├── Admin dashboard (depends on: usage tracking)
└── Self-hosted packaging (depends on: all above)

Phase 5 (Month 5-6): Polish + Launch
├── Editor API docs extraction for AI system prompt
├── Confidence scoring refinement
├── Load testing
├── Security audit
└── Beta rollout
```

---

## Honest Assessment: Are We Just Building an AI Harness?

The AI subscription is essentially:

1. **Gather context** from the editor state
2. **Format it** into a prompt
3. **Call Claude API**
4. **Validate** the response against the live interpreter
5. **Display** it to the user
6. **Bill** them for steps 2-4

Steps 1, 2, 3, 5, and 6 are generic harness work — the same code any AI-powered dev tool would need. Step 4 (validate against the live interpreter) is the only part unique to tmax.

### What Actually Differentiates It

- The interpreter can parse + eval AI output before showing it (most tools display raw LLM output)
- The AST gives structured context (most tools just send file text)
- T-Lisp is small enough that the AI can know the entire API surface

### What's Generic Harness Work

Context builder, streaming, ghost text, chat panel, billing, rate limiting, accounts — same code you'd write for any AI-powered dev tool. Most of the engineering effort (and most of the 4-6 month timeline) goes into this scaffolding, not into something tmax-specific.

### Implication

This raises a strategic question: are we building a SaaS business to justify the editor, or does the editor generate the SaaS naturally? If it feels like the tail wagging the dog, the lower-investment monetization paths should come first:

| Path | Investment | Time to Revenue |
|------|-----------|-----------------|
| BSL license for T-Lisp embedding | Low (legal + licensing work) | Weeks |
| Secure remote editing (enterprise) | Medium (hardening + packaging) | 1-2 months |
| AI subscription | High (full stack: auth, billing, streaming, UI) | 4-6 months |

The AI subscription may still be the right play — but it should be a conscious choice, not the default. The BSL license and enterprise packaging can generate early revenue that funds the AI work, rather than betting everything on the longest build.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **AI generates broken T-Lisp** | High | Medium | Sandbox validation before display; confidence scoring |
| **Latency too high for inline completion** | Medium | High | Local model fallback (Ollama) for completions, cloud for chat |
| **Users won't pay for AI in a terminal editor** | Medium | High | Free tier generous enough to hook users; AI must feel indispensable |
| **Claude API cost exceeds subscription revenue** | Low | High | Prompt caching, quota limits, rate limiting, local fallback |
| **Competitor ships same feature** | Low | Medium | T-Lisp interpreter moat — competitors can't validate generated code |
| **Self-hosted enterprise deployment complexity** | Medium | Medium | Docker image + single-command install; defer to Phase 4 |

---

## What We Can Ship Without

Not everything in the vision is needed for a v1 paid beta. Here's what can be deferred:

- **Self-hosted AI** (Enterprise-only, ship after proving cloud model)
- **Team module library** (requires package registry, separate project)
- **Config sync** (requires cloud storage, separate project)
- **Custom model fine-tuning** (Enterprise-only, requires significant data)
- **Diff/apply preview** (nice-to-have, accept/reject is sufficient for v1)

### Minimum Viable Paid Product

1. AI code generation from natural language (M-x ai-assist)
2. AI inline ghost-text completions
3. Explain selected code
4. Free tier (editor only) → Pro tier ($12/mo, 2,000 AI requests)
5. Stripe billing
6. That's it. Ship it, learn, iterate.
