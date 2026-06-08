# docs/memos/ — Decision Memos and Analysis

Long-form analysis documents exploring tradeoffs, options, and design decisions before formal ADRs or RFCs.

## Distribution & Business

| File | Description | Related |
|------|-------------|---------|
| [distribution-strategy.md](distribution-strategy.md) | Binary distribution via GitHub Releases vs npm | [ADR-0071](../adrs/ADR-0071-binary-distribution.md), [RFC-010](../rfcs/RFC-010-loom-package-manager.md) |
| [business-model-overview.md](business-model-overview.md) | Business model analysis for tmax as a product | — |
| [ai-subscription-gap-analysis.md](ai-subscription-gap-analysis.md) | Gap analysis for AI subscription integration | [ADR-0020](../adrs/ADR-0020-ai-agent-control.md) |

## Language Design

| File | Description | Related |
|------|-------------|---------|
| [clojure-lessons-for-tlisp.md](clojure-lessons-for-tlisp.md) | Lessons from Clojure applicable to T-Lisp design | [elisp-pain-points.md](elisp-pain-points.md), [ADR-0003](../adrs/ADR-0003-final-architecture-tlisp-first.md) |
| [elisp-pain-points.md](elisp-pain-points.md) | Pain points in Emacs Lisp that T-Lisp should avoid | [clojure-lessons-for-tlisp.md](clojure-lessons-for-tlisp.md) |
| [module-system-gap-analysis.md](module-system-gap-analysis.md) | Gaps in the T-Lisp module system vs Guile/Racket | [RFC-005](../rfcs/RFC-005-tlisp-module-system.md), [SPEC-007](../specs/SPEC-007-tlisp-module-system.md) |

## Tooling & Infrastructure

| File | Description | Related |
|------|-------------|---------|
| [glamour-gap-analysis.md](glamour-gap-analysis.md) | Gap analysis for Glamour-style tooling | [RFC-008](../rfcs/RFC-008-steep-bubbletea-gap-analysis.md) |
| [package-registry-options-analysis.md](package-registry-options-analysis.md) | Options analysis for a T-Lisp package registry | [RFC-010](../rfcs/RFC-010-loom-package-manager.md), [ADR-0052](../adrs/ADR-0052-plugin-repository.md) |
| [standalone-tlisp-gap-analysis.md](standalone-tlisp-gap-analysis.md) | Gaps for standalone T-Lisp REPL use | [standalone-tlisp-options-analysis.md](standalone-tlisp-options-analysis.md), [SPEC-008](../specs/SPEC-008-standalone-tlisp-option-b.md) |
| [standalone-tlisp-options-analysis.md](standalone-tlisp-options-analysis.md) | Options for standalone T-Lisp distribution | [standalone-tlisp-gap-analysis.md](standalone-tlisp-gap-analysis.md) |
| [syntax-highlighting-ast-analysis.md](syntax-highlighting-ast-analysis.md) | Analysis of AST-based syntax highlighting approach | [SPEC-013](../specs/SPEC-013-native-ast-engine.md), [ADR-0076](../adrs/ADR-0076-syntax-highlighting-in-render-pipeline.md) |
| [elm-purity-tradeoff-analysis.md](elm-purity-tradeoff-analysis.md) | Tradeoff analysis for Elm purity: performance, coordination cost, benefit weighting | [RFC-009](../rfcs/RFC-009-elm-purity-gap-analysis.md), [technical-vision.md](../technical-vision.md) |
