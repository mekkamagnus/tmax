# Business Model Overview

Monetization strategies for tmax and T-Lisp, organized by product and feasibility.

## tmax Editor

### 1. Secure Remote Editing (DevOps/Enterprise)
Zero external deps + single binary + daemon architecture = ideal for air-gapped servers, containers, and jump hosts. Sell as a secure, auditable remote editor with session persistence (clients detach/reattach to the daemon, like tmux). Targets: regulated industries, infrastructure teams, defense.

### 2. Embedded Editor Component (B2B/OEM)
Daemon speaks JSON-RPC over Unix sockets with pluggable frontends. License the editing engine to other products — cloud IDEs, collaboration tools, internal developer platforms — who need a battle-tested terminal editor they can embed and skin.

### 3. Programmable Dev Environment (SaaS/Enterprise)
T-Lisp extensibility is Emacs' killer feature. Position as zero-config, zero-dependency alternative — teams get infinite customization without the Emacs learning curve or plugin hell. TypeScript core lowers the contribution barrier vs C. Could support a hosted config/module sync service.

### 4. Collaborative Editing (Real-time)
Frame-based multi-client architecture is already most of what's needed for multi-user editing. Add CRDT/OT sync for a terminal-based pair programming tool — a niche Cursor and VS Code Live Share don't serve well for terminal-native devs.

### 5. Education / Onboarding Platform
Built-in Lisp interpreter with TCO and macros is a learn-to-code playground inside a real editor. Build a "build your own editor" curriculum — students extend tmax with T-Lisp and learn functional programming by doing.

## T-Lisp as Standalone Library

### 1. Rules/Config Engine for SaaS (Enterprise)
Every SaaS with complex business rules builds a bad DSL or ships JSON config nightmares. T-Lisp gives a real programming language for pricing rules, approval workflows, feature flags, access control — embeddable and sandboxed. Module system lets customers write and share rule packs. "Stripe Sigma but for your config."

### 2. Lua-for-JS (Developer Tools)
Lua's market position is "tiny embeddable scripting language." T-Lisp could own that niche for TypeScript/JS apps. Target: CI/CD tools, build systems, note-taking apps, notebook environments, browser extensions that want user scripting. Biggest TAM.

### 3. Game Scripting Engine (Indie/Mid-size Studios)
Most TypeScript game engines (Pixi.js, Phaser, Excalibur) lack a safe user-facing scripting layer. T-Lisp gives sandboxed, hot-reloadable game logic — quests, NPC behavior, item systems. Macro system is a natural fit for DSLs like `(defquest ...)` or `(defenemy ...)`. Sell as npm package with game-specific stdlib.

### 4. Plugin System for Open-Core Products
Open-source the interpreter, sell the ecosystem. Grafana, Neovim, Obsidian prove that a good plugin API drives adoption. Offer T-Lisp as the extension language for your own or others' products, then monetize a plugin marketplace, hosted evaluation, or enterprise governance (audit logs, RBAC on scripts).

### 5. Education Platform (B2C)
SICP-style education is having a renaissance. A TypeScript Lisp with TCO, macros, and a module system is a teaching language — runs in browser via Bun/WASM, no install needed. Sell courses, a "build your own programming language" bootcamp, or a Lisp learning platform.

## T-Lisp as a General-Purpose Language

The "full ambition" scenario: T-Lisp becomes a standalone language ecosystem like Clojure, Elixir, or Rust — not just an extension language, but a language people choose for building real software.

### What This Looks Like

A developer writes a web server, a CLI tool, or a data pipeline in T-Lisp the same way they'd write it in TypeScript, Python, or Clojure. The language has its own runtime, standard library, package manager, and toolchain — independent of tmax entirely.

### What T-Lisp Already Has Going For It

- **Lisp semantics**: macros, homoiconicity, REPL-driven development — the qualities that make Clojure, Racket, and Common Lisp enduring
- **Zero-dep runtime**: single binary, no node_modules, no build step — a genuine alternative to the JS/Python dependency sprawl
- **Bun/TypeScript backbone**: compiles to or runs on a fast, modern runtime without the boot time penalty of JVM languages
- **Built-in module system**: `(import ...)` with file-based modules already works
- **TCO and functional core**: pattern-matching, immutable-first — aligned with where modern languages are heading

### What It Would Need to Get There

| Capability | Why | Analogues |
|---|---|---|
| Standalone compiler/runtime | Ship `tlisp` as a command, not just a library | `bun`, `node`, `clojure` |
| Standard library beyond editor ops | HTTP, file I/O, JSON, regex, concurrency | Clojure stdlib, Go stdlib |
| Package manager + registry | `tlisp install` with a central package repo | `npm`, `cargo`, `hex` |
| Build tooling | Project scaffolding, dependency resolution, bundling | `cargo`, `mix`, `lein` |
| FFI or host interop | Call JS/TS libraries from T-Lisp | Clojure/JVM, Elixir/BEAM |
| Concurrency story | Async, actors, or CSP for server-grade work | Go goroutines, Elixir processes |
| Type system (optional) | Gradual typing for larger codebases | Clojure spec, Typed Racket |
| Compiler targets | Compile to JS, native (via Bun), or WASM | ClojureScript, Rust, Elixir |

### Comparable Language Journeys

**Clojure (2007→present):** Started as a Lisp on the JVM. Grew through REPL culture, concurrency primitives (STM, atoms), and Java interop. Monetized via Clojure-based products (Datomic) and enterprise support (Nubank runs all backend in Clojure — $2B+ company). Community-driven, no single company owns it.

**Elixir (2012→present):** Ruby-like syntax on the BEAM VM. Won adoption through Phoenix (web framework) and the reliability story (WhatsApp runs Erlang). Not directly monetized — the value flows through consultancy, training, and companies built on it (Bleacher Report, Discord's early architecture).

**Rust (2010→present):** Mozilla-funded systems language. Won through memory safety narrative. Monetization came through foundation sponsorship (AWS, Google, Microsoft all sponsor the Rust Foundation), consultancy, and companies built with it.

**Janet (2019→present):** Small Lisp designed to be a "Lisp for everything." Has a compiler, PEG parsing, networking, and a package manager (`jpm`). Much smaller community but proves the model works at indie scale.

### Monetization Paths as a Language

**1. Foundation / Sponsorship Model (Rust, Python)**
Create a T-Lisp Foundation. Once the language has real users, cloud companies will sponsor it because their customers run it in production. Rust Foundation pulls millions/year from AWS, Google, Microsoft. This is a long play but the most sustainable.

**2. Enterprise Support + Training (Red Hat model)**
Sell support contracts, SLAs, and training to companies running T-Lisp in production. Clojure does this through Cognitect ($200-$400/hr consulting, sponsored development). Works once you have 50+ companies depending on it.

**3. Premium Tooling (JetBrains, Clojure)**
Sell or subscription-license the IDE experience — tmax becomes the reference IDE for T-Lisp, with AI features, debugger, profiler, and deployment tooling that the open-source version doesn't have. JetBrains built a $1B+ company on this model.

**4. Hosted Runtime / Serverless (Denormalized, Fly.io)**
Run T-Lisp as a hosted serverless platform. "Deploy your T-Lisp functions to the cloud in one command." The language is free, but the runtime infrastructure is a service. Analogous to Deno Deploy or Fly.io for Elixir.

**5. Vertical-Specific Frameworks (Phoenix, Rails)**
Build a flagship framework in T-Lisp (e.g., a real-time web framework leveraging T-Lisp's async story) and sell training, consulting, and hosting around it. Phoenix made Elixir. Rails made Ruby. A killer framework makes the language.

### Why This Could Work (Honest Assessment)

**Tailwinds:**
- Developer fatigue with JS/TS complexity is real — "simple language with zero deps" resonates
- Lisp is having a moment (Clojure revival, Racket growth, Scheme in SICP courses)
- AI-native languages are an open niche — T-Lisp's homoiconicity makes it uniquely AI-friendly (code is data, macros generate code)
- The tmax editor is a proof-of-concept that T-Lisp can run real, complex software

**Headwinds:**
- Language adoption is a 5-10 year play with no revenue for years
- You're competing against ecosystems with millions of packages and users
- "Another Lisp" is a hard sell — Clojure, Racket, Fennel, Janet, Carp, already exist
- Developer tooling (debugger, LSP, test frameworks) requires enormous investment

**Realistic take:** This is the highest-upside, lowest-probability path. It only works if T-Lisp finds a "killer app" that no other language does well — AI-native metaprogramming and zero-dep embedded scripting are the two strongest candidates. The path runs through the other models first: embed → popularize → stand alone.

## Proven Monetization Patterns

### AI Feature Subscription (Cursor, Zed, Warp) — Detailed Plan

Free core product, subscription for AI-powered features. The T-Lisp interpreter already has full AST/eval context to feed an AI — this is the fastest path to revenue.

#### Pricing Tiers

```
tmax Free                          $0/mo
├── Full editor + T-Lisp runtime
├── Local editing, all modes
├── Community package registry (read)
└── Manual T-Lisp scripting

tmax Pro                           $12/mo
├── Everything in Free
├── AI T-Lisp Authoring
│   ├── "Create a mode that..." → generates working T-Lisp
│   ├── Explain selected T-Lisp code in plain English
│   ├── Refactor my T-Lisp (extract function, simplify)
│   └── Natural language key binding: "map gj to go 5 lines down"
├── AI Inline Assistance
│   ├── Ghost-text completions while editing (like Copilot)
│   ├── Whole-file context awareness via AST
│   └── T-Lisp-aware: suggests editor APIs, knows available functions
├── AI Chat Sidebar
│   ├── "Why did my macro not expand?" → analyzes AST
│   ├── "How do I implement a status-line plugin?" → step-by-step
│   └── Full conversation context with your open buffers
└── 2,000 AI requests/mo

tmax Team                          $25/user/mo
├── Everything in Pro
├── Shared T-Lisp module library (private to org)
├── AI learns from your team's T-Lisp conventions
├── Unified billing + usage dashboards
├── Config sync across team machines
└── 10,000 AI requests/user/mo

tmax Enterprise                    custom pricing
├── Everything in Team
├── Self-hosted AI (on-prem, no data leaves your network)
├── Custom model fine-tuned on your codebase
├── SSO/SAML, audit logs, compliance artifacts
├── Priority T-Lisp feature requests
└── Unlimited AI requests
```

#### User Experience Example

A user wants to create a custom markdown preview mode:

```
User types: SPC ; (enters M-x)
M-x prompt: ai-assist

AI: What would you like to build?
User: A mode that highlights markdown headers, bold, and links
      in different colors, and shows a preview pane on the right

AI generates in a split pane:

  ;; tmax AI generated — press Enter to apply, e to edit, q to dismiss

  (defvar md-preview-active nil)

  (defun md-highlight-headers (text)
    "Apply face properties to markdown headers."
    (let ((lines (split-string text "\n")))
      (mapcar
        (lambda (line)
          (when (string-prefix-p "#" line)
            (add-face-property
              :foreground (cond
                ((string-prefix-p "# " line)     "bright-red")
                ((string-prefix-p "## " line)    "bright-blue")
                ((string-prefix-p "### " line)   "bright-green")
                (t                                "bright-yellow"))
              line)))
        lines)))

  (defun md-preview-buffer ()
    "Open a preview pane for the current markdown buffer."
    (let ((src (buffer-text))
          (preview (create-buffer "*md-preview*")))
      (switch-to-buffer preview)
      (insert (md-highlight-headers src))
      (split-window-right)
      (switch-to-buffer (other-buffer))))

  (define-minor-mode markdown-preview-mode
    "Toggle markdown preview in a side pane."
    :keymap '(("p" . md-preview-buffer))
    :on (lambda () (setq md-preview-active t))
    :off (lambda () (setq md-preview-active nil)))

  Confidence: 87%  |  Uses 3 stdlib functions, 1 editor API
  [Enter] Apply  [e] Edit  [m] Modify: "also highlight code blocks"  [q] Quit
```

#### Why This Beats Generic Copilot

1. **Knows the editor API** — suggests `split-window-right`, `define-minor-mode`, `add-face-property` because the T-Lisp stdlib and editor API are in context
2. **Validates against the interpreter** — evals generated code against the running T-Lisp runtime to confirm it parses and type-checks before showing it
3. **Round-trips through the AST** — modifications like "also highlight code blocks" alter the AST and regenerate, not just append text
4. **Fits the REPL workflow** — iterate in the same session, AI sees eval results

#### Architecture

```
┌─────────────────────────────────────────────┐
│                  tmax editor                 │
│                                             │
│  User action → AI request (JSON-RPC)        │
│       │                                     │
│       ▼                                     │
│  ┌─────────────────────────────────┐        │
│  │  T-Lisp AI Bridge              │        │
│  │  • Extracts AST context        │        │
│  │  • Builds prompt with:         │        │
│  │    - Current buffer + cursor   │        │
│  │    - Available editor APIs     │        │
│  │    - Loaded T-Lisp modules     │        │
│  │    - User's init.tlisp         │        │
│  │  • Validates generated code    │        │
│  │    against live interpreter    │        │
│  └──────────┬──────────────────────┘        │
│             │                               │
└─────────────┼───────────────────────────────┘
              │ HTTPS / streaming SSE
              ▼
┌─────────────────────────────────┐
│        tmax AI backend          │
│                                 │
│  Auth → check subscription tier │
│  Rate limit → check quota       │
│  Prompt → Claude API            │
│  Response → stream back         │
│                                 │
│  System prompt includes:        │
│  • Full T-Lisp stdlib docs      │
│  • Editor API reference         │
│  • Module system docs           │
│  • Best practices / patterns    │
│                                 │
│  Post-processing:               │
│  • Parse generated T-Lisp       │
│  • Run through type checker     │
│  • Return confidence score      │
└─────────────────────────────────┘
```

#### Revenue Projection (Conservative)

```
Month 6:   200 Pro users × $12             = $2,400/mo
Month 12:  800 Pro + 5 Teams (5 seats)     = $12,125/mo
Month 18:  2,000 Pro + 20 Teams            = $30,500/mo
Month 24:  5,000 Pro + 50 Teams + 1 Ent.   = $72,500/mo

AI cost per user: ~$2-4/mo (Claude API with prompt caching)
Gross margin: 70-80%
```

#### Moat

The T-Lisp interpreter is the competitive moat. Generic AI assistants can suggest JavaScript, but only tmax's AI can generate, validate, and iterate on T-Lisp because it has the live interpreter, the AST, and the editor API in the loop. Not replicable by dropping Copilot into any editor.

### Open Core + Hosted Service (Vercel, Supabase, GitLab)
Open-source the editor/language, sell hosted infrastructure. Hosted collaborative editing sessions, config sync, T-Lisp package registry with cloud persistence. Daemon architecture already has the session model.

### Open Core + Enterprise Features (GitLab, Sourcegraph)
Free for individuals, pay for team/enterprise governance. SSO, audit logging for T-Lisp scripts, shared module registries, policy enforcement, centralized config management across a fleet.

### Dual License / BSL (Redis, CockroachDB, Elastic)
Source-available with non-compete license. Free for non-production use, paid for commercial embedding. Strong fit for T-Lisp as a library — anyone can use it personally, but commercial embedding requires a license.

### Marketplace / Registry Cut (JetBrains, Unity)
Open the core, take a cut of the ecosystem. T-Lisp package registry where authors sell premium packages (themes, language modes, specialized workflows) and tmax takes 20-30%. Works at scale only.

### Acquisition Play (Fig, Kite, LightTable)
Build something excellent that a big company needs. A zero-dep TypeScript Lisp interpreter with a working editor is rare tech — companies building developer platforms, cloud IDEs, or browser-based tools would be interested.

### Sponsorware (Sindre Sorhus, Tony Narlock)
Open source but gate new features behind GitHub Sponsors thresholds. Release sponsor-only versions, then open after a funding goal. Works with engaged niche communities.

## Suggested Phasing

| Phase | Model | Revenue |
|-------|-------|---------|
| Now | Open source, build community | $0 |
| Year 1 | AI features subscription | $5-20k/mo |
| Year 1-2 | T-Lisp commercial license (BSL) | Enterprise deals |
| Year 2+ | Hosted collaboration / package registry | SaaS recurring |

## Key Differentiator

Zero dependencies + TypeScript-native + sandboxed. No other embeddable Lisp in the JS ecosystem owns this combination cleanly.
