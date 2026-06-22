/**
 * @file keys.test.ts
 * @description Unit tests for the tmax-use key parser. No daemon, no IPC.
 */
import { describe, test, expect } from 'bun:test';
import {
  parseKeys, headlessBytes, headlessValues, tmuxDispatch, compileHeadless,
  type KeyToken, type TmuxKey,
} from '../../../tmax-use/src/keys.ts';
import { Either } from '../../../src/utils/task-either.ts';

function compile(seq: string): readonly string[] {
  const r = compileHeadless(seq);
  if (Either.isLeft(r)) throw new Error(`parse failed: ${seq}`);
  return r.right;
}

function tokens(seq: string): KeyToken[] {
  const r = parseKeys(seq);
  if (Either.isLeft(r)) throw new Error(`parse failed: ${seq}`);
  return r.right;
}

function tmux(seq: string): TmuxKey[] {
  return tmuxDispatch(tokens(seq));
}

describe('parseKeys — special keys', () => {
  test('<Esc> parses to a single key', () => {
    expect(tokens('<Esc>').length).toBe(1);
  });

  test('<Enter>, <BS>, <Tab>, <Space> all recognized', () => {
    for (const k of ['<Enter>', '<BS>', '<Tab>', '<Space>']) {
      expect(tokens(k).length).toBe(1);
    }
  });

  test('arrow keys recognized', () => {
    for (const k of ['<Up>', '<Down>', '<Left>', '<Right>']) {
      expect(tokens(k).length).toBe(1);
    }
  });

  test('shifted arrows recognized', () => {
    for (const k of ['<S-Up>', '<S-Down>', '<S-Left>', '<S-Right>']) {
      expect(tokens(k).length).toBe(1);
    }
  });

  test('<S-Tab> recognized', () => {
    expect(tokens('<S-Tab>').length).toBe(1);
  });

  test('aliases accepted: <Escape>, <RET>, <Return>, <TAB>, <Backspace>, <DEL>, <SPC>', () => {
    for (const k of ['<Escape>', '<RET>', '<Return>', '<TAB>', '<Backspace>', '<DEL>', '<SPC>']) {
      expect(tokens(k).length).toBe(1);
    }
  });
});

describe('parseKeys — control keys', () => {
  test('<C-a> through <C-z> all recognized', () => {
    for (const c of 'abcdefghijklmnopqrstuvwxyz') {
      expect(tokens(`<C-${c}>`).length).toBe(1);
    }
  });

  test('<C-a> compiles to byte 0x01', () => {
    expect(compile('<C-a>')).toEqual(['\x01']);
  });

  test('<C-c> compiles to byte 0x03 (ETX)', () => {
    expect(compile('<C-c>')).toEqual(['\x03']);
  });

  test('<C-m> compiles to CR (alias for Enter)', () => {
    expect(compile('<C-m>')).toEqual(['\r']);
  });

  test('<C-i> compiles to TAB (alias for Tab)', () => {
    expect(compile('<C-i>')).toEqual(['\t']);
  });

  test('<C-[> compiles to ESC', () => {
    expect(compile('<C-[>')).toEqual(['\x1b']);
  });

  test('<C-z> compiles to 0x1a', () => {
    expect(compile('<C-z>')).toEqual(['\x1a']);
  });
});

describe('parseKeys — meta keys', () => {
  test('<M-x> compiles to ESC + x', () => {
    expect(compile('<M-x>')).toEqual(['\x1b', 'x']);
  });

  test('<M-a> through <M-z> all recognized', () => {
    for (const c of 'abcdefghijklmnopqrstuvwxyz') {
      expect(tokens(`<M-${c}>`).length).toBe(1);
    }
  });

  test('<M-X> (uppercase) preserves case', () => {
    expect(compile('<M-X>')).toEqual(['\x1b', 'X']);
  });
});

describe('parseKeys — shift letters', () => {
  test('<S-a> through <S-z> recognized', () => {
    for (const c of 'abcdefghijklmnopqrstuvwxyz') {
      expect(tokens(`<S-${c}>`).length).toBe(1);
    }
  });

  test('<S-a> compiles to uppercase "A"', () => {
    expect(compile('<S-a>')).toEqual(['A']);
  });
});

describe('parseKeys — plain text', () => {
  test('hello world splits into individual chars', () => {
    expect(tokens('hi').length).toBe(2);
  });

  test('mixed plain + special parses correctly', () => {
    expect(tokens('i<Esc>').length).toBe(2);
  });

  test('multi-key sequence: gg', () => {
    const ts = tokens('gg');
    expect(ts.length).toBe(2);
    expect(ts[0]!.source).toBe('g');
    expect(ts[1]!.source).toBe('g');
  });

  test('empty string → empty array', () => {
    expect(tokens('').length).toBe(0);
  });
});

describe('parseKeys — error cases', () => {
  test('unterminated bracket fails', () => {
    const r = parseKeys('<C-a');
    expect(Either.isLeft(r)).toBe(true);
  });

  test('<S-foo> fails for unknown shift target (not arrow/tab/letter)', () => {
    const r = parseKeys('<S-foo>');
    expect(Either.isLeft(r)).toBe(true);
  });

  test('<S-1> fails (shift only valid for letters/arrows/tab)', () => {
    const r = parseKeys('<S-1>');
    expect(Either.isLeft(r)).toBe(true);
  });
});

describe('compileHeadless — integration', () => {
  test(':w<Enter> produces correct bytes', () => {
    expect(compile(':w<Enter>')).toEqual([':', 'w', '\r']);
  });

  test('hjkl navigation produces plain letters', () => {
    expect(compile('hjkl')).toEqual(['h', 'j', 'k', 'l']);
  });

  test('<Esc> produces 0x1b', () => {
    expect(compile('<Esc>')).toEqual(['\x1b']);
  });

  test('<Enter> produces carriage return', () => {
    expect(compile('<Enter>')).toEqual(['\r']);
  });

  test('<Tab> produces tab', () => {
    expect(compile('<Tab>')).toEqual(['\t']);
  });

  test('<BS> produces DEL', () => {
    expect(compile('<BS>')).toEqual(['\x7f']);
  });
});

describe('tmuxDispatch', () => {
  test('<Esc> maps to named "Escape"', () => {
    const r = tmux('<Esc>');
    expect(r).toEqual([{ kind: 'named', value: 'Escape' }]);
  });

  test('<C-a> maps to named "C-a"', () => {
    expect(tmux('<C-a>')).toEqual([{ kind: 'named', value: 'C-a' }]);
  });

  test('<Enter> maps to named "C-m"', () => {
    expect(tmux('<Enter>')).toEqual([{ kind: 'named', value: 'C-m' }]);
  });

  test('plain text passes through as literals', () => {
    const r = tmux('hi');
    expect(r).toEqual([
      { kind: 'literal', value: 'h' },
      { kind: 'literal', value: 'i' },
    ]);
  });

  test('<S-Tab> maps to named "BTab"', () => {
    expect(tmux('<S-Tab>')).toEqual([{ kind: 'named', value: 'BTab' }]);
  });

  test('<S-Up> maps to named "S-Up"', () => {
    expect(tmux('<S-Up>')).toEqual([{ kind: 'named', value: 'S-Up' }]);
  });
});

describe('headlessValues', () => {
  test('flattens tokens into one keypress value per token', () => {
    const ts = tokens(':w<Enter>');
    expect(headlessValues(ts)).toEqual([':', 'w', '\r']);
  });

  test('<Space> produces " "', () => {
    expect(headlessValues(tokens('<Space>'))).toEqual([' ']);
  });

  test('<Up> produces semantic name "Up" (not ANSI)', () => {
    expect(headlessValues(tokens('<Up>'))).toEqual(['Up']);
  });

  test('<Down> produces semantic name "Down"', () => {
    expect(headlessValues(tokens('<Down>'))).toEqual(['Down']);
  });

  test('<Left>/<Right> produce semantic names', () => {
    expect(headlessValues(tokens('<Left>'))).toEqual(['Left']);
    expect(headlessValues(tokens('<Right>'))).toEqual(['Right']);
  });

  test('<S-Tab> produces semantic "S-Tab"', () => {
    expect(headlessValues(tokens('<S-Tab>'))).toEqual(['S-Tab']);
  });

  test('<S-Up>/<S-Down>/<S-Left>/<S-Right> produce semantic S- names', () => {
    expect(headlessValues(tokens('<S-Up>'))).toEqual(['S-Up']);
    expect(headlessValues(tokens('<S-Down>'))).toEqual(['S-Down']);
    expect(headlessValues(tokens('<S-Left>'))).toEqual(['S-Left']);
    expect(headlessValues(tokens('<S-Right>'))).toEqual(['S-Right']);
  });

  test('<M-x> splits into ESC + x (two keypress values)', () => {
    expect(headlessValues(tokens('<M-x>'))).toEqual(['\x1b', 'x']);
  });
});

describe('headlessBytes (legacy join)', () => {
  test('flattens tokens into a single byte string', () => {
    const ts = tokens(':w<Enter>');
    expect(headlessBytes(ts)).toBe(':w\r');
  });

  test('<Space> produces " "', () => {
    expect(headlessBytes(tokens('<Space>'))).toBe(' ');
  });

  test('<Up> produces semantic name (not ANSI)', () => {
    // Single token, single name — joined string equals the name.
    expect(headlessBytes(tokens('<Up>'))).toBe('Up');
  });

  test('<S-Tab> produces semantic name (not ANSI)', () => {
    expect(headlessBytes(tokens('<S-Tab>'))).toBe('S-Tab');
  });
});
