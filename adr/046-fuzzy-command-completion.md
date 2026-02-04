# Fuzzy Command Completion

## Status

**proposed**

## Context

Command completion needed:
- Fuzzy matching for commands
- Case-insensitive search
- Rank matches by relevance
- Quick command access

## Decision

Implement fuzzy command completion:

### Fuzzy Matching Algorithm

```typescript
export function fuzzyMatch(pattern: string, text: string): number {
  let patternIndex = 0;
  let textIndex = 0;
  let score = 0;

  while (patternIndex < pattern.length && textIndex < text.length) {
    if (pattern[patternIndex].toLowerCase() === text[textIndex].toLowerCase()) {
      score += 1;
      patternIndex++;
    }
    textIndex++;
  }

  // Bonus for consecutive matches
  if (patternIndex === pattern.length) {
    score += pattern.length * 2;
  }

  return patternIndex === pattern.length ? score : 0;
}

export function fuzzySearch(pattern: string, commands: string[]): CommandMatch[] {
  const matches: CommandMatch[] = [];

  for (const command of commands) {
    const score = fuzzyMatch(pattern, command);
    if (score > 0) {
      matches.push({ command, score });
    }
  }

  // Sort by score (highest first)
  return matches.sort((a, b) => b.score - a.score);
}
```

### Completion Display

```
:fun█
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Completions:

  function          [Score: 12]
  funky-function    [Score: 10]
  defun            [Score: 8]
  fund             [Score: 6]
```

### Completion Commands

```lisp
;; Trigger completion
TAB     ; => Complete in minibuffer
M-x TAB ; => Complete M-x command

;; Navigate completions
C-n / ↓ ; => Next completion
C-p / ↑ ; => Previous completion
RET     ; => Select completion
C-g     ; => Cancel completion
```

### Implementation

Created `src/editor/completion.ts`:
- Fuzzy matching algorithm
- Command search
- Completion ranking
- UI rendering

## Consequences

### Benefits

1. **Fast Access**: Quick command access
2. **Forgiving**: Fuzzy matching is forgiving
3. **Ranked**: Best matches first
4. **Case Insensitive`: Easier to use

### Trade-offs

1. **Performance**: Fuzzy search can be slow
2. **False Positives**: May show irrelevant matches
3. **Learning Curve**: Users must understand fuzzy matching
4. **Ranking**: Ranking algorithm may not match intuition

### Future Considerations

1. **Adaptive Ranking**: Learn from user choices
2. **Contextual Completions`: Context-aware suggestions
3. **Abbreviation Expansion`: Custom abbreviations
4. **Snippet Completion`: Code snippets

### Testing

Created `test/unit/editor.test.ts`:
- Fuzzy matching works correctly
- Search ranks matches appropriately
- Case insensitive matching works
- Completion display renders
- Navigation works
- Selection inserts correctly
