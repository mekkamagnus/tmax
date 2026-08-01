# Bug: regex backreferences (\1..\9) and & not expanded

## Description
Emacs/vim-style backrefs were passed verbatim to JS String.replace (expects
$1/$2), so \1 collapsed to a literal digit.

## Solution
Added `translateReplacement` helper in replace-ops.ts: \1..\9→$1..$9, &→$&,
\&→literal &, \\→literal \, $→$$ (escaped). Wired into `replace-regexp-in-string`.

## Follow-up
The `:%s` path (criterion 2) needs match-group expansion in replace-apply-current
(currently inserts the replacement literally). Deeper work — tracked as follow-up.

## Validation
- daemon: `(replace-regexp-in-string "(a)(b)" "\\1\\2" "xabx")` → `xabx`.
- daemon: `(replace-regexp-in-string "dog" "[&]" "a dog b")` → `a [dog] b`.
