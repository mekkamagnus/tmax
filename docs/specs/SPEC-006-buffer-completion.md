# Feature: Buffer Completion and Reusable Minibuffer Completion

## Feature Description
Implement interactive buffer completion with the behavior users expect from Emacs configured with Vertico, Orderless, and Marginalia:

- Vertico-style vertical candidates, current-candidate selection, scrolling, and candidate counts
- Orderless-style multi-component matching in any order with visible match highlighting
- Marginalia-style category-aware annotations for buffer metadata
- An interactive `switch-buffer` command bound to `C-x b`

This feature establishes tmax's reusable minibuffer completion framework. It must follow the Emacs C/Lisp boundary already required by this repository: TypeScript is the low-level runtime and display layer, while T-Lisp owns completion behavior, policy, state transitions, commands, and extensibility.

Buffer switching is the first required completion category. M-x must migrate onto the same T-Lisp completion framework to prove the design is generic rather than another buffer-specific prompt.

This spec refers to [RFC-003: Emacs Parity Roadmap](../rfcs/RFC-003-emacs-parity-roadmap.md), especially the current "Minibuffer + completion" gap. It is distinct from RFC-003 section 2.4, "In-Buffer Completion": this spec covers minibuffer selection workflows, not Corfu/Cape-style completion while editing buffer text.

## User Story
As a developer using tmax as my daily editor
I want to switch buffers through a fast, annotated, vertically displayed completion list
So that I can find the correct buffer by partial name, mode, path, or status without remembering its exact name

## Problem Statement
The current implementation has pieces of a minibuffer but not an Emacs-style, Lisp-owned completion system:

1. `src/editor/handlers/mx-handler.ts` hardcodes M-x candidate discovery, fuzzy matching, completion decisions, and command execution in TypeScript.
2. Ambiguous candidates are compressed into `statusMessage`; there is no persistent multi-row candidate list, selected candidate, scroll position, or candidate count.
3. `src/editor/utils/fuzzy-completion.ts` embeds a score-driven completion policy in TypeScript. It cannot be replaced or composed from T-Lisp.
4. `buffer-switch` is only a primitive that requires an exact name. There is no interactive T-Lisp `switch-buffer` command.
5. Minibuffer state is represented by the M-x-specific `mxCommand` field and a global history index. It cannot safely represent a generic completion read or independent sessions in multiple daemon frames.
6. T-Lisp lacks several general runtime primitives needed to implement completion libraries cleanly, including dynamic function invocation, list transformation, regex spans, and terminal display-width queries.
7. Buffer metadata is incomplete. The daemon reports every buffer as unmodified, and major mode, size, current-buffer status, and filename are not available together as factual data.
8. The renderer reserves one line for command input and cannot draw a T-Lisp-produced vertical completion view.
9. The terminal input tokenizer translates arrow escape sequences directly to `hjkl`, so completion keymaps cannot distinguish arrow navigation from typed letters.

## Solution Statement
Build the feature the way Emacs separates its C core from Emacs Lisp:

1. Add only general-purpose T-Lisp runtime primitives that Lisp cannot currently express efficiently or safely.
2. Add frame-local storage for an opaque, JSON-safe T-Lisp minibuffer state and a generic T-Lisp-produced render view. TypeScript stores, transports, and draws these values but does not interpret completion policy.
3. Implement a T-Lisp completion-table and metadata protocol modeled on Emacs `completing-read`, `completion-all-completions`, completion categories, and completion styles.
4. Implement the default completion experience as T-Lisp libraries:
   - `vertico.tlisp` owns selection, scrolling, visible-row arrangement, counts, and the render view.
   - `orderless.tlisp` owns component parsing, matching styles, filtering, and highlight spans.
   - `marginalia.tlisp` owns category-to-annotator registration and buffer annotation formatting.
5. Implement `switch-buffer` and `execute-extended-command` in T-Lisp using the generic completion framework.
6. Keep TypeScript limited to factual buffer/command queries, normalized input events, frame serialization, display-width primitives, and terminal rendering.

## Assumptions and Scope
- Buffer completion and M-x are the required first consumers of the reusable T-Lisp completion framework.
- Named T-Lisp functions and symbols are used for completion tables, predicates, annotators, sort functions, and accept actions so active sessions remain serializable across daemon frames.
- Completion tables may return a candidate snapshot on each input update. Asynchronous and streaming completion tables are future work.
- The default visible candidate count is 10. Selection does not wrap by default.
- `Enter` accepts the selected candidate. If the prompt/input row is selected and raw input is allowed, `Enter` accepts the raw input.
- For `switch-buffer`, accepting non-existing raw input creates and switches to a new buffer, matching Emacs `switch-to-buffer` behavior.
- `Tab` inserts the selected candidate into the minibuffer input without accepting it.
- `C-n`, `C-p`, `Down`, and `Up` navigate candidates; moving above the first candidate selects the prompt when raw input is allowed.
- `C-g` and `Escape` cancel and restore the previous mode/focus without running the accept action.
- The default Orderless subset includes smart case, all-components-in-any-order matching, default literal/regexp matching, and affix dispatch for `=`, `^`, `~`, `,`, `!`, and `&`.
- Vertico, Orderless, and Marginalia behavior is built in as default-loaded T-Lisp libraries, but their policy functions and registries remain replaceable from user T-Lisp configuration.
- This feature does not implement Corfu/Cape-style in-buffer completion, recursive minibuffers, asynchronous sources, file/project completion, Embark actions, or the full Emacs completion API.
- No external dependency is added.

## Architecture Boundary
### T-Lisp Owns
- `read-from-minibuffer`, `completing-read`, completion-table dispatch, completion metadata, categories, and histories
- The active completion session's semantic fields and every state transition
- Candidate discovery, filtering, ordering, grouping, and selection policy
- Orderless component parsing, style dispatch, matching composition, and highlight assignment
- Marginalia annotator registration, category lookup, and annotation formatting
- Vertico navigation, scrolling, visible-row arrangement, candidate counts, and render-view construction
- User-facing commands such as `switch-buffer` and `execute-extended-command`
- Accept/cancel behavior, raw-input policy, minibuffer key semantics, and default key bindings
- User customization and replacement of completion styles, annotators, sort functions, and keymaps

### TypeScript Owns
- General T-Lisp runtime primitives such as `funcall`, `apply`, list transforms, stable sort, regex match spans, and display-width queries
- Factual buffer and callable-command metadata queries with no presentation or ordering policy
- Frame-local storage and JSON transport for opaque serializable T-Lisp minibuffer state
- A generic render transport containing prompt/input text and T-Lisp-produced styled rows
- Input token identity, terminal dimensions, ANSI drawing, clipping safety, and cursor placement
- Thin primitives that get/set/clear state and publish the T-Lisp-produced render view

### Explicitly Forbidden in TypeScript
- An Orderless matcher or completion-style dispatcher
- Buffer or command candidate filtering and ordering
- Marginalia annotation formatting or category-to-annotator decisions
- Vertico selection, scrolling, visible-window, or candidate-count decisions
- Buffer/M-x-specific accept, cancel, or navigation decision trees

## T-Lisp Completion Contract
The exact names may follow local conventions, but the T-Lisp layer must expose equivalents of:

```lisp
(completing-read prompt table
                 :predicate predicate
                 :require-match require-match
                 :initial-input initial-input
                 :history history-symbol
                 :default default
                 :accept-function accept-function)

(completion-table-dispatch table input action)
;; action is one of: metadata, all-completions, try-completion

(completion-metadata-get metadata "category")
(completion-all-completions input table predicate)
(completion-try-completion input table predicate)
```

Completion table, predicate, annotator, sort, and accept references stored in an active frame must be globally named T-Lisp symbols. Do not store JavaScript callbacks, interpreter objects, buffer objects, closures, or other non-JSON values in frame state.

The semantic session is a T-Lisp hashmap stored opaquely by TypeScript. It includes prompt, input, input point, table symbol, predicate symbol, category, require-match policy, history symbol/index, selection, scroll offset, return context, and accept function symbol. T-Lisp reads and replaces this state through raw storage primitives.

Vertico publishes a separate render-only view equivalent to:

```lisp
(hashmap
  "prompt" "Switch to buffer: "
  "input" "mes"
  "input-point" 3
  "rows" (list
    (hashmap "selected" t
             "segments" (list
               (hashmap "text" "*Messages*" "face" "completion-match")
               (hashmap "text" "  *  Messages" "face" "annotation"))))
  "message" ""
  "cursor-row" 10
  "cursor-column" 21)
```

TypeScript validates this generic view for transport safety and draws it. It must not decide which candidates appear, which row is selected, or how annotations are formatted.

## Relevant Files
Use these files to implement the feature:

- `rfcs/RFC-003-emacs-parity-roadmap.md` - Clarify that this spec delivers minibuffer completion while RFC-003 section 2.4 remains in-buffer completion.
- `src/tlisp/evaluator.ts` - Add only missing general Lisp runtime primitives required by completion libraries.
- `src/tlisp/stdlib.ts` - Add general hashmap/list/function helpers when they belong in the reusable T-Lisp standard library.
- `src/core/types.ts` - Add generic serialized T-Lisp state and render-view transport fields to `EditorState` and `Frame`; do not add completion-policy types.
- `src/editor/editor.ts` - Register raw primitives, load completion libraries, synchronize generic minibuffer transport, and remove M-x-specific policy.
- `src/editor/tlisp-api.ts` - Register factual metadata and generic minibuffer storage/display primitives.
- `src/editor/api/minibuffer-ops.ts` - Replace M-x-only operations with raw frame-local state/view/history storage primitives.
- `src/editor/api/buffer-ops.ts` - Expose factual per-buffer metadata and preserve exact-name `buffer-switch`.
- `src/editor/api/documentation.ts` - Expose factual callable-command documentation without choosing annotations.
- `src/editor/handlers/mx-handler.ts` - Reduce to normalized-key routing into T-Lisp; rename only if all imports and tests are migrated.
- `src/editor/utils/fuzzy-completion.ts` - Remove after M-x policy migrates to T-Lisp unless a non-completion user remains.
- `src/server/serialize.ts` - Serialize and deserialize opaque minibuffer state and generic render views.
- `src/server/server.ts` - Synchronize frame-local minibuffer transport and report factual buffer metadata instead of hardcoded `modified: false`.
- `src/frontend/render/input.ts` - Preserve arrow-key identity instead of translating arrows directly to `hjkl`.
- `src/frontend/render/command-input.ts` - Delegate to the generic minibuffer render view.
- `src/frontend/frontends/steep/index.ts` - Draw the generic T-Lisp-produced minibuffer view.
- `src/client/tui-client.ts` - Draw the serialized generic minibuffer view in daemon clients.
- `src/frontend/components/Editor.tsx` - Draw the same generic view in the Ink-compatible frontend.
- `src/frontend/frontends/ink/components/Editor.tsx` - Keep the mirrored Ink frontend behavior aligned.
- `src/tlisp/core/bindings/command.tlisp` - Bind generic minibuffer commands in the compatibility `mx` mode.
- `src/tlisp/core/bindings/normal.tlisp` - Bind `C-x b` to `switch-buffer`.
- `test/unit/lisp-owned-commands.test.ts` - Verify completion commands and libraries load from T-Lisp.
- `test/unit/minibuffer-input.test.ts` - Migrate M-x tests onto the Lisp-owned generic minibuffer.
- `test/unit/server-client.test.ts` - Verify serialized, frame-local minibuffer state and views.
- `test/ui/tests/08_buffers_files.py` - Preserve existing buffer/file behavior.

### New Files
- `src/tlisp/core/completion/minibuffer.tlisp` - Lisp-owned minibuffer session, histories, dispatch, acceptance, cancellation, and `completing-read`.
- `src/tlisp/core/completion/completion.tlisp` - Completion-table protocol, metadata, categories, styles, and completion dispatch.
- `src/tlisp/core/completion/orderless.tlisp` - Orderless component parsing, style dispatch, filtering, and highlight spans.
- `src/tlisp/core/completion/marginalia.tlisp` - Category annotator registry and default buffer/command annotators.
- `src/tlisp/core/completion/vertico.tlisp` - Vertical navigation, scrolling, row arrangement, counts, and render-view publication.
- `src/tlisp/core/commands/buffers.tlisp` - Interactive buffer completion table, accept action, and `switch-buffer`.
- `src/tlisp/core/commands/execute-extended-command.tlisp` - M-x completion table, accept action, and command execution.
- `src/frontend/render/minibuffer.ts` - Generic renderer for T-Lisp-produced styled prompt and row segments.
- `test/unit/tlisp-completion-runtime.test.ts` - General runtime primitive tests.
- `test/unit/tlisp-completion-framework.test.ts` - T-Lisp completion-table, metadata, history, and minibuffer transition tests.
- `test/unit/orderless-tlisp.test.ts` - T-Lisp Orderless matching, styles, and highlighting tests.
- `test/unit/vertico-marginalia-tlisp.test.ts` - T-Lisp navigation, view generation, and annotations.
- `test/unit/buffer-completion.test.ts` - Buffer completion command and metadata integration tests.
- `test/unit/minibuffer-renderer.test.ts` - Generic render-view drawing, clipping, and ANSI tests.
- `test/ui/tests/16_buffer_completion.py` - Real-key renderer verification for buffer and M-x completion.

## Related Upstream Code
These pinned source links are behavioral and architectural references, not dependencies.

### Emacs Core and Emacs Lisp
- [Emacs repository](https://github.com/emacs-mirror/emacs)
- [Lisp completion metadata and categories](https://github.com/emacs-mirror/emacs/blob/35f69be393fbd5815501770f37ea0d5a4da1bdf5/lisp/minibuffer.el#L117-L167)
- [Lisp completion styles](https://github.com/emacs-mirror/emacs/blob/35f69be393fbd5815501770f37ea0d5a4da1bdf5/lisp/minibuffer.el#L1236-L1287)
- [Lisp completion orchestration](https://github.com/emacs-mirror/emacs/blob/35f69be393fbd5815501770f37ea0d5a4da1bdf5/lisp/minibuffer.el#L1438-L1461)
- [Lisp `completing-read-default`](https://github.com/emacs-mirror/emacs/blob/35f69be393fbd5815501770f37ea0d5a4da1bdf5/lisp/minibuffer.el#L5151-L5235)
- [Lisp buffer-read and switch commands](https://github.com/emacs-mirror/emacs/blob/35f69be393fbd5815501770f37ea0d5a4da1bdf5/lisp/window.el#L9462-L9588)
- [Lisp `execute-extended-command`](https://github.com/emacs-mirror/emacs/blob/35f69be393fbd5815501770f37ea0d5a4da1bdf5/lisp/simple.el#L2601-L2690)
- [C `read-from-minibuffer` primitive](https://github.com/emacs-mirror/emacs/blob/35f69be393fbd5815501770f37ea0d5a4da1bdf5/src/minibuf.c#L1298-L1602)
- [C low-level completion primitives](https://github.com/emacs-mirror/emacs/blob/35f69be393fbd5815501770f37ea0d5a4da1bdf5/src/minibuf.c#L1604-L2035)

### Vertico
- [Repository](https://github.com/minad/vertico)
- [Minibuffer keymap and navigation bindings](https://github.com/minad/vertico/blob/6e45be6105819297da8472dd8f37a38eb4a0b6e5/vertico.el#L127-L145)
- [Completion state computation, metadata, sorting, and prompt selection](https://github.com/minad/vertico/blob/6e45be6105819297da8472dd8f37a38eb4a0b6e5/vertico.el#L256-L312)
- [Annotation and affixation handling](https://github.com/minad/vertico/blob/6e45be6105819297da8472dd8f37a38eb4a0b6e5/vertico.el#L195-L207)
- [Candidate arrangement, scrolling, formatting, and display](https://github.com/minad/vertico/blob/6e45be6105819297da8472dd8f37a38eb4a0b6e5/vertico.el#L539-L604)
- [Next/previous, selected-candidate exit, raw-input exit, and insertion](https://github.com/minad/vertico/blob/6e45be6105819297da8472dd8f37a38eb4a0b6e5/vertico.el#L650-L715)

### Orderless
- [Repository](https://github.com/oantolin/orderless)
- [Component separator and matching-style configuration](https://github.com/oantolin/orderless/blob/09c90d93efce4fdac52edfe8b22591b773f3e607/orderless.el#L96-L130)
- [Affix style dispatchers](https://github.com/oantolin/orderless/blob/09c90d93efce4fdac52edfe8b22591b773f3e607/orderless.el#L137-L205)
- [Annotation matching and per-component highlighting](https://github.com/oantolin/orderless/blob/09c90d93efce4fdac52edfe8b22591b773f3e607/orderless.el#L326-L364)
- [Pattern compilation into independent components](https://github.com/oantolin/orderless/blob/09c90d93efce4fdac52edfe8b22591b773f3e607/orderless.el#L446-L480)
- [Stable filtering, highlighted completions, and unique completion behavior](https://github.com/oantolin/orderless/blob/09c90d93efce4fdac52edfe8b22591b773f3e607/orderless.el#L537-L625)

### Marginalia
- [Repository](https://github.com/minad/marginalia)
- [Category-to-annotator registry and classifiers](https://github.com/minad/marginalia/blob/feb66c02bbd88dba867cdd92b94fe24279ed578a/marginalia.el#L91-L136)
- [Buffer status, file information, and buffer annotations](https://github.com/minad/marginalia/blob/feb66c02bbd88dba867cdd92b94fe24279ed578a/marginalia.el#L905-L946)
- [Completion category classification](https://github.com/minad/marginalia/blob/feb66c02bbd88dba867cdd92b94fe24279ed578a/marginalia.el#L1219-L1253)
- [Annotation caching, alignment, affixation, and metadata integration](https://github.com/minad/marginalia/blob/feb66c02bbd88dba867cdd92b94fe24279ed578a/marginalia.el#L1255-L1343)
- [Mode integration and annotator cycling](https://github.com/minad/marginalia/blob/feb66c02bbd88dba867cdd92b94fe24279ed578a/marginalia.el#L1369-L1420)

## Implementation Plan
### Phase 1: Foundation
Add the small set of general runtime and editor primitives T-Lisp needs, plus frame-local opaque state and generic render-view transport. Add factual buffer and command metadata without embedding completion policy.

### Phase 2: Core Implementation
Implement the completion framework, minibuffer state machine, Orderless styles, Marginalia annotators, Vertico view generation, buffer completion, and M-x entirely in T-Lisp.

### Phase 3: Integration
Draw T-Lisp-produced views consistently in all frontends, preserve semantic key identity, verify daemon frame isolation, and update documentation/RFC references.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Add Regression and Architecture-Boundary Tests
- Add failing tests that require ambiguous M-x candidates to appear in a generic vertical view instead of only `statusMessage`.
- Add failing tests for `C-x b` opening an interactive buffer prompt.
- Add failing tests for two daemon frames maintaining independent opaque minibuffer states and render views.
- Add a failing real-key renderer test that expects a visible multi-row candidate list.
- Add architecture tests that fail if Orderless, Marginalia, Vertico, buffer-source, or M-x decision logic is implemented in TypeScript modules or handlers.
- Verify the new tests fail for the intended missing behavior before implementation.

### 2. Add Missing General T-Lisp Runtime Primitives
- Add general dynamic invocation equivalents for `funcall` and `apply`.
- Add reusable list transformation helpers needed by completion libraries, including map, filter, and stable sort.
- Add low-level regex/literal primitives that return match spans and handle invalid regex safely.
- Add terminal/display primitives for display width and safe truncation.
- Keep these primitives domain-neutral. Do not mention buffers, candidates, Orderless, Marginalia, or Vertico in their implementations.
- Add focused evaluator/stdlib tests and preserve tail-call behavior.

### 3. Add Frame-Local Opaque Minibuffer State and View Transport
- Replace M-x-specific state storage with generic primitives to get, replace, and clear an opaque JSON-safe T-Lisp value for the active frame.
- Add a separate primitive for T-Lisp to publish a generic styled minibuffer render view.
- Extend `EditorState`, `Frame`, server serialization, and frame synchronization only enough to transport these values.
- Deep-copy values between editor and frames so concurrent frames cannot share mutable lists or hashmaps.
- Keep `mode: "mx"` and `mxCommand` only as temporary compatibility surfaces; `mxCommand` mirrors the active T-Lisp input during migration.
- Ensure TypeScript never reads semantic completion fields to make a completion decision.

### 4. Provide Factual Metadata Primitives
- Add a `buffer-list-details`-style primitive that returns buffer name, filename, major mode, modified state, character/line counts, current status, special-buffer status, and recency facts.
- Update metadata on buffer create, switch, edit, save, rename, and kill paths.
- Replace hardcoded daemon `modified: false` results with factual metadata.
- Add a callable-command-details primitive that returns names, first-line documentation, and known bindings without choosing presentation or order.
- Keep annotation formatting, filtering, grouping, and ordering out of TypeScript.

### 5. Implement the T-Lisp Completion Framework
- Create `src/tlisp/core/completion/completion.tlisp`.
- Implement named completion-table dispatch for metadata, all completions, and try completion.
- Implement completion category and style registries that users can replace or extend from T-Lisp.
- Implement predicate application, stable source ordering, and metadata lookup in T-Lisp.
- Make Orderless the default completion style without hardcoding it in TypeScript.
- End the library with `(provide "completion")` and load it before completion consumers.

### 6. Implement the T-Lisp Minibuffer State Machine
- Create `src/tlisp/core/completion/minibuffer.tlisp`.
- Implement `read-from-minibuffer`, `completing-read`, keyed histories, input editing, refresh, navigation dispatch, acceptance, raw-input acceptance, and cancellation in T-Lisp.
- Store and replace the semantic session through the opaque frame-local state primitives.
- Store only named function symbols in serializable sessions.
- Route normalized keys from the TypeScript handler into one T-Lisp minibuffer dispatch function.
- Keep TypeScript handlers free of accept, cancel, navigation, history, or completion decisions.

### 7. Implement Orderless in T-Lisp
- Create `src/tlisp/core/completion/orderless.tlisp`.
- Split input into escapable space-separated components in T-Lisp.
- Require every component to match independently of component order.
- Implement smart case and affix dispatch for:
  - `=` literal
  - `^` prefix
  - `~` flex
  - `,` initialism
  - `!` negation
  - `&` annotation
- Use only general regex/string primitives from TypeScript.
- Produce per-component display/annotation highlight spans in T-Lisp.
- Preserve source order and avoid fuzzy-score auto-selection.
- Register the style through the T-Lisp completion-style registry.

### 8. Implement Marginalia in T-Lisp
- Create `src/tlisp/core/completion/marginalia.tlisp`.
- Implement a T-Lisp category-to-annotator registry and lookup.
- Implement buffer annotations from factual metadata: modified/current indicators, size, major mode, and abbreviated filename.
- Implement command annotations from factual documentation and bindings.
- Keep annotation alignment and formatting policy in T-Lisp, using display-width/truncation primitives where required.
- Allow user T-Lisp configuration to replace or extend annotators.

### 9. Implement Vertico in T-Lisp
- Create `src/tlisp/core/completion/vertico.tlisp`.
- Implement selection, prompt selection, no-wrap navigation, scrolling, visible-row slicing, candidate counts, Tab insertion, and no-match behavior.
- Combine candidates, Orderless spans, and Marginalia annotations into styled row segments.
- Publish the complete render-only view through the generic display primitive after every session transition.
- Keep the default maximum visible row count configurable from T-Lisp.
- Ensure no TypeScript renderer computes selection, scrolling, candidate visibility, counts, or annotation layout.

### 10. Implement Buffer Completion in T-Lisp
- Create `src/tlisp/core/commands/buffers.tlisp`.
- Implement a named buffer completion table backed by `buffer-list-details`.
- Return category `buffer` metadata and let Marginalia select the buffer annotator.
- Order buffers by factual recency in T-Lisp while preserving stable order during filtering.
- Implement the accept action to switch to an existing buffer or create and switch to raw input.
- Implement `(switch-buffer)` using `completing-read` with prompt `Switch to buffer: `.
- Bind `C-x b` to `(switch-buffer)` in T-Lisp.

### 11. Migrate M-x to T-Lisp
- Create `src/tlisp/core/commands/execute-extended-command.tlisp`.
- Build a named command completion table from factual callable-command details.
- Return category `command` metadata and let Marginalia select the command annotator.
- Implement `execute-extended-command` and its accept action in T-Lisp.
- Move M-x entry, history, candidate discovery, completion, and execution policy out of `mx-handler.ts`.
- Remove score-driven auto-completion and status-message-only ambiguous match display.
- Remove `src/editor/utils/fuzzy-completion.ts` if it has no non-completion users.

### 12. Draw the Generic T-Lisp-Produced View
- Create `src/frontend/render/minibuffer.ts`.
- Validate and draw prompt/input text and styled row segments exactly as published by T-Lisp.
- Clip defensively for terminal bounds without changing candidate selection, visibility, order, annotation content, or counts.
- Reserve published row space above the minibuffer input and reduce the buffer viewport height accordingly.
- Integrate the generic renderer into Steep, the daemon TUI client, and both Ink editor components.
- Keep the cursor on the T-Lisp-published input position.

### 13. Preserve Navigation Key Identity
- Change terminal escape-sequence tokenization to emit semantic `Up`, `Down`, `Left`, `Right`, `PageUp`, and `PageDown` keys instead of translating arrows directly to `hjkl`.
- Add T-Lisp normal-mode aliases so existing arrow navigation still works outside the minibuffer.
- Bind completion navigation keys through the T-Lisp minibuffer keymap.
- Add tokenizer and real-key renderer tests for arrow navigation.

### 14. Add Completion and Integration Coverage
- Test general runtime primitives independently from completion behavior.
- Test completion tables, metadata, styles, histories, and minibuffer transitions by evaluating T-Lisp libraries.
- Test Orderless behavior through T-Lisp entry points for every required style, smart case, invalid regex, annotation matching, stable ordering, and highlight spans.
- Test Marginalia annotations and Vertico view models through T-Lisp entry points.
- Test buffer completion, new-buffer creation, M-x execution, serialization, and two-frame isolation.
- Test generic rendering separately from T-Lisp policy.
- Extend `test/unit/lisp-owned-commands.test.ts` to prove the default completion behavior is loaded from T-Lisp.

### 15. Add Renderer E2E Coverage
- Create `test/ui/tests/16_buffer_completion.py` using the Python daemon-tmux harness.
- Open multiple named buffers and send real `C-x b` keys.
- Assert the prompt, multiple candidates, and buffer annotations are visible in captured renderer output.
- Type two Orderless components in reverse order and assert the expected candidate remains visible.
- Move selection with real navigation keys and press Enter; assert the active buffer changes.
- Reopen completion, cancel with `C-g`, and assert the active buffer does not change.
- Open M-x and assert it uses the same vertical completion behavior.

### 16. Update Documentation and Roadmap References
- Update `rfcs/RFC-003-emacs-parity-roadmap.md` to reference this spec as the minibuffer completion foundation.
- Keep RFC-003 section 2.4 explicitly scoped to in-buffer completion.
- Document the Emacs-style TypeScript/T-Lisp boundary and T-Lisp completion-table contract.
- Document how user T-Lisp configuration can replace completion styles and annotators.
- Correct any documentation that claims generic minibuffer completion is complete before this spec's acceptance criteria pass.

### 17. Run Validation Commands
- Execute every command in the Validation Commands section.
- Fix every failure before marking the feature complete.
- Do not weaken existing tests or preserve stale "complete" claims when required behavior is missing.

## Testing Strategy
### Unit Tests
- General, domain-neutral T-Lisp runtime primitives
- Opaque state/view JSON serialization and frame isolation
- Factual buffer and command metadata
- T-Lisp completion tables, metadata, styles, predicates, and histories
- T-Lisp minibuffer state transitions and accept/cancel actions
- T-Lisp Orderless component compilation, matching, stable filtering, and spans
- T-Lisp Marginalia registries and annotations
- T-Lisp Vertico selection, scrolling, visible rows, counts, and view generation
- Generic TypeScript renderer drawing and clipping only
- Arrow-key token identity
- Architecture boundary checks that prevent completion policy from moving into TypeScript

### Integration Tests
- `C-x b` starts Lisp-owned buffer completion and switches/creates buffers through real editor key handling
- M-x uses the same T-Lisp completion framework and generic renderer
- Buffer edits and saves update annotations
- User T-Lisp can replace an annotator or completion style without TypeScript changes
- Daemon frames maintain independent active minibuffer states and views
- Direct editor, daemon TUI, Steep, and Ink draw the same published view

### Edge Cases
- No buffers beyond the current buffer
- Empty input with many candidates
- No matching candidates
- More than 10 matching candidates and scrolling near both ends
- Prompt selected with and without raw input allowed
- Accepting raw input equal to an existing candidate
- Special buffer names such as `*Messages*`
- Buffer names and filenames containing spaces, quotes, backslashes, Unicode, or regex metacharacters
- Duplicate display strings with distinct accepted values
- Very narrow and very short terminals
- Long annotations that must be truncated
- Candidate removed by another frame after a completion table query
- Two frames typing and selecting different candidates concurrently
- Invalid regex component
- Uppercase smart-case component
- Annotation-only `&` matching
- Negated `!` component
- Missing or renamed T-Lisp table/accept symbols in a restored frame session

## Acceptance Criteria
1. `C-x b` opens a visible vertical buffer candidate list without requiring Tab.
2. The buffer list filters after every printable input and Backspace.
3. Space-separated components match in any order and all components are required.
4. Smart case and the required `=`, `^`, `~`, `,`, `!`, and `&` dispatch styles work.
5. Matching text in candidate names and annotations is visibly highlighted per component.
6. Candidate source order remains stable; ambiguous input is not silently replaced by a score-selected winner.
7. At most 10 candidates are visible by default, selection scrolls through larger result sets, and the UI displays selected/total count.
8. `C-n`, `C-p`, `Down`, and `Up` navigate candidates; `Tab` inserts; `Enter` accepts; `C-g` and `Escape` cancel.
9. Selecting the prompt and pressing Enter creates/switches to a new buffer when the typed name does not exist.
10. Buffer annotations show factual modified/current status, size, major mode, and filename information where available.
11. Editing and saving a buffer updates its modified annotation correctly.
12. M-x uses the same T-Lisp completion tables, styles, annotations, minibuffer state machine, and Vertico behavior.
13. Completion table dispatch, matching, filtering, annotations, ordering, selection, scrolling, counts, histories, key semantics, and accept/cancel behavior are implemented in T-Lisp.
14. TypeScript completion-related code contains only general runtime primitives, factual queries, opaque frame transport, input normalization, and generic drawing.
15. User T-Lisp can register or replace a completion style and category annotator without modifying TypeScript.
16. Active minibuffer state and published views are independent per daemon frame and serialize without callbacks or non-JSON values.
17. Existing exact-name `(buffer-switch "name")` behavior remains available.
18. No external dependency is added.
19. All validation commands pass with zero errors and zero skipped required checks.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun test test/unit/tlisp-completion-runtime.test.ts test/unit/tlisp-completion-framework.test.ts test/unit/orderless-tlisp.test.ts test/unit/vertico-marginalia-tlisp.test.ts test/unit/buffer-completion.test.ts test/unit/minibuffer-renderer.test.ts test/unit/minibuffer-input.test.ts test/unit/lisp-owned-commands.test.ts test/unit/server-client.test.ts`
- `bun test`
- `bun run typecheck:src`
- `bun run typecheck:test`
- `bun run typecheck`
- `bun run check`
- `bun run test:daemon`
- `bun run test:ui:renderer`
- `bun run test:ui`

## Notes
- The project rules explicitly define TypeScript as Emacs's C layer and T-Lisp as Emacs Lisp. Completion behavior is editor logic and therefore belongs in T-Lisp.
- Emacs itself exposes low-level minibuffer/completion primitives from C while implementing most completion orchestration and all three referenced packages in Emacs Lisp.
- The current `src/editor/api/minibuffer-ops.ts` is imported but not used by `createEditorAPI`, while `editor.ts` defines duplicate raw minibuffer functions. Consolidate these into generic storage/display primitives.
- The current `mx` mode name and `mxCommand` field may remain temporarily for compatibility, but new behavior must use the T-Lisp-owned generic minibuffer state.
- The current daemon buffer queries hardcode `modified: false`; Marginalia-style buffer annotations must not ship with fabricated metadata.
- Orderless does not inherently rank candidates. Preserve source/history order and use matching only for narrowing and highlighting.
- No new library is required.
