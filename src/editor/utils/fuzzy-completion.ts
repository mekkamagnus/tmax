/**
 * @file fuzzy-completion.ts
 * @description Fuzzy command completion utilities (US-1.10.2)
 * 
 * Implements fuzzy matching for command completion:
 * - Matches patterns like 'buf-s' to 'buffer-save'
 * - Supports fuzzy matching like 'bs' to 'buffer-save'
 * - Returns scored, sorted completion lists
 * - Handles hyphen substitution and regex-like patterns
 */

/**
 * Result of a fuzzy match operation
 */
export interface FuzzyMatchResult {
  /** Whether the pattern matched */
  matches: boolean;
  /** Match score (higher = better match) */
  score: number;
  /** Matched character positions (for highlighting) */
  positions: number[];
}

/**
 * Completion candidate with score
 */
export interface CompletionCandidate {
  /** Command name */
  command: string;
  /** Match score (higher = better) */
  score: number;
  /** Matched character positions */
  positions: number[];
}

/**
 * Maximum number of completions to return
 */
const MAX_COMPLETIONS = 10;

/**
 * Fuzzy match a pattern against a target string
 * @param pattern - Pattern to match (e.g., 'buf-s', 'bs')
 * @param target - Target string to match against (e.g., 'buffer-save')
 * @returns Match result with score and positions
 */
export function fuzzyMatch(pattern: string, target: string): FuzzyMatchResult {
  if (!pattern || !target) {
    return { matches: false, score: 0, positions: [] };
  }

  // Handle special characters pattern (like 'buf.*save')
  // Remove special regex chars and treat as normal pattern
  const cleanPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '');
  
  // Check if pattern is empty or only contains separators
  if (!cleanPattern || cleanPattern.replace(/[-\s]/g, '').length === 0) {
    return { matches: false, score: 0, positions: [] };
  }

  // Convert to lowercase for case-insensitive matching
  const patternLower = cleanPattern.toLowerCase();
  const targetLower = target.toLowerCase();

  // Replace hyphens in pattern with spaces for flexible matching
  const patternNormalized = patternLower.replace(/-/g, ' ');
  const targetNormalized = targetLower.replace(/-/g, ' ');

  // Try exact match first (highest score)
  if (targetLower === patternLower) {
    return {
      matches: true,
      score: 1000,
      positions: Array.from({ length: target.length }, (_, i) => i)
    };
  }

  // Try prefix match (very high score)
  if (targetLower.startsWith(patternLower)) {
    return {
      matches: true,
      score: 900,
      positions: Array.from({ length: pattern.length }, (_, i) => i)
    };
  }

  // Try consecutive character match (high score)
  const consecutiveResult = matchConsecutive(patternNormalized, targetNormalized);
  if (consecutiveResult.matches) {
    return {
      matches: true,
      score: 700 + consecutiveResult.score,
      positions: consecutiveResult.positions
    };
  }

  // Try command abbreviation match (like 'buf-s' or 'bs' in 'buffer-save')
  const abbreviationResult = matchCommandAbbreviation(patternLower, targetLower);
  if (abbreviationResult.matches) {
    return {
      matches: true,
      score: abbreviationResult.score,
      positions: abbreviationResult.positions
    };
  }

  // Try fuzzy match (characters in order, not necessarily consecutive)
  const fuzzyResult = matchFuzzy(patternNormalized, targetNormalized);
  if (fuzzyResult.matches) {
    return {
      matches: true,
      score: fuzzyResult.score,
      positions: fuzzyResult.positions
    };
  }

  return { matches: false, score: 0, positions: [] };
}

/**
 * Match abbreviations against command word boundaries and hyphen-separated parts.
 */
function matchCommandAbbreviation(pattern: string, target: string): FuzzyMatchResult {
  const compactPattern = pattern.replace(/[-\s]/g, "");
  if (compactPattern.length === 0) {
    return { matches: false, score: 0, positions: [] };
  }

  const targetParts = target.split("-");

  if (pattern.includes("-")) {
    const patternParts = pattern.split("-").filter(part => part.length > 0);
    if (patternParts.length > targetParts.length) {
      return { matches: false, score: 0, positions: [] };
    }

    const positions: number[] = [];
    let offset = 0;
    let matchedAllParts = true;

    for (let i = 0; i < patternParts.length; i++) {
      const partPattern = patternParts[i]!;
      const targetPart = targetParts[i];
      if (!targetPart || !targetPart.startsWith(partPattern)) {
        matchedAllParts = false;
        break;
      }

      positions.push(...Array.from({ length: partPattern.length }, (_, index) => offset + index));
      offset += targetPart.length + 1;
    }

    if (matchedAllParts) {
      return {
        matches: true,
        score: 820 + (compactPattern.length * 20) - ((target.length - compactPattern.length) * 6),
        positions
      };
    }
  }

  if (compactPattern.length <= targetParts.length) {
    const initials = targetParts.map(part => part[0] ?? "").join("");
    if (initials.startsWith(compactPattern)) {
      const positions: number[] = [];
      let offset = 0;
      for (let i = 0; i < compactPattern.length; i++) {
        positions.push(offset);
        offset += targetParts[i]!.length + 1;
      }

      return {
        matches: true,
        score: 780 + (compactPattern.length * 25) - ((target.length - compactPattern.length) * 6),
        positions
      };
    }
  }

  return { matches: false, score: 0, positions: [] };
}

/**
 * Match consecutive characters (like 'buf' in 'buffer')
 */
function matchConsecutive(pattern: string, target: string): FuzzyMatchResult {
  const start = target.indexOf(pattern);

  if (start >= 0) {
    const positions = Array.from({ length: pattern.length }, (_, index) => start + index);
    // Bonus for matching at start of word
    const startBonus = start === 0 ? 100 : 0;
    // Score based on how much we had to skip
    const skipPenalty = start;
    // Bonus for shorter overall target (prefer shorter matches)
    const lengthBonus = Math.max(0, 100 - (target.length - pattern.length) * 2);
    // Bonus for matching pattern characters to unique target characters
    const uniquenessBonus = positions.length * 30;
    // Bonus based on how much of the target is covered by the match
    const coverageRatio = pattern.length / target.length;
    const coverageBonus = coverageRatio * 200;

    return {
      matches: true,
      score: 700 + startBonus - skipPenalty + lengthBonus + uniquenessBonus + coverageBonus,
      positions
    };
  }

  return { matches: false, score: 0, positions: [] };
}

/**
 * Fuzzy match - characters must appear in order but can be separated
 */
function matchFuzzy(pattern: string, target: string): FuzzyMatchResult {
  if (pattern.length === 0) {
    return { matches: false, score: 0, positions: [] };
  }

  const positions: number[] = [];
  let patternIndex = 0;
  let targetIndex = 0;

  while (patternIndex < pattern.length && targetIndex < target.length) {
    if (pattern[patternIndex] === target[targetIndex]) {
      positions.push(targetIndex);
      patternIndex++;
    }
    targetIndex++;
  }

  if (patternIndex === pattern.length) {
    // Calculate score based on compactness of match
    const spread = positions[positions.length - 1] - positions[0];
    const compactnessBonus = Math.max(0, 100 - spread);
    const startBonus = positions[0] === 0 ? 50 : 0;
    
    return {
      matches: true,
      score: 100 + compactnessBonus + startBonus + (pattern.length * 5),
      positions
    };
  }

  return { matches: false, score: 0, positions: [] };
}

/**
 * Find all fuzzy matches in a list of commands
 * @param pattern - Pattern to match
 * @param commands - List of command names
 * @returns Array of completion candidates sorted by score
 */
export function fuzzyMatches(pattern: string, commands: string[]): CompletionCandidate[] {
  if (!pattern || commands.length === 0) {
    return [];
  }

  const candidates: CompletionCandidate[] = [];

  for (const command of commands) {
    const result = fuzzyMatch(pattern, command);
    if (result.matches) {
      candidates.push({
        command,
        score: result.score,
        positions: result.positions
      });
    }
  }

  // Sort by score (highest first)
  candidates.sort((a, b) => b.score - a.score);

  return candidates;
}

/**
 * Get the best single match for a pattern
 * @param pattern - Pattern to match
 * @param commands - List of command names
 * @returns Best matching command, or null if ambiguous/no match
 */
export function getBestMatch(pattern: string, commands: string[]): string | null {
  const matches = fuzzyMatches(pattern, commands);

  if (matches.length === 0) {
    return null;
  }

  if (matches.length === 1) {
    return matches[0].command;
  }

  // Check if there's a clear winner (score significantly higher than second best)
  const best = matches[0];
  const second = matches[1];
  // Adaptive threshold: lower for shorter patterns
  // For very short patterns (2 chars), be lenient. For longer, be stricter.
  const scoreThreshold = pattern.length <= 2 ? 5 : 10;

  if (best.score - second.score >= scoreThreshold) {
    return best.command;
  }

  // Ambiguous - return null
  return null;
}

/**
 * Get fuzzy completions for a pattern
 * @param pattern - Pattern to match
 * @param commands - List of command names
 * @returns Array of completion candidates (limited to MAX_COMPLETIONS)
 */
export function getFuzzyCompletions(pattern: string, commands: string[]): CompletionCandidate[] {
  const matches = fuzzyMatches(pattern, commands);
  
  // Limit results
  return matches.slice(0, MAX_COMPLETIONS);
}

/**
 * Get common prefix of matched strings (for partial completion)
 * @param candidates - List of completion candidates
 * @returns Common prefix string
 */
export function getCommonPrefix(candidates: CompletionCandidate[]): string {
  if (candidates.length === 0) {
    return "";
  }

  if (candidates.length === 1) {
    return candidates[0].command;
  }

  const first = candidates[0].command;
  let prefix = "";
  let i = 0;

  while (i < first.length) {
    const char = first[i];
    const allMatch = candidates.every(c => c.command[i] === char);
    
    if (allMatch) {
      prefix += char;
      i++;
    } else {
      break;
    }
  }

  return prefix;
}
