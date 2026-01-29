import { test, describe, expect } from 'bun:test';
import { Option, Some, None, isSome, isNone } from '../../src/utils/option';

describe('Option<T>', () => {
  test('should create Some with a value', () => {
    const some = Some(42);
    expect(isSome(some)).toBe(true);
    expect(isNone(some)).toBe(false);
    expect(some._tag).toBe('Some');
    expect(some.value).toBe(42);
  });

  test('should create None without a value', () => {
    const none = None;
    expect(isNone(none)).toBe(true);
    expect(isSome(none)).toBe(false);
    expect(none._tag).toBe('None');
  });

  test('map should transform Some value', () => {
    const some = Some(42);
    const mapped = some.map(x => x * 2);
    
    expect(isSome(mapped)).toBe(true);
    expect((mapped as any).value).toBe(84);
  });

  test('map should return None for None', () => {
    const none = None;
    const mapped = none.map((x: number) => x * 2);
    
    expect(isNone(mapped)).toBe(true);
  });

  test('flatMap should transform Some value with function returning Option', () => {
    const some = Some(42);
    const flatMapped = some.flatMap(x => x > 40 ? Some(x * 2) : None);
    
    expect(isSome(flatMapped)).toBe(true);
    expect((flatMapped as any).value).toBe(84);
  });

  test('flatMap should return None when function returns None', () => {
    const some = Some(30);
    const flatMapped = some.flatMap(x => x > 40 ? Some(x * 2) : None);
    
    expect(isNone(flatMapped)).toBe(true);
  });

  test('flatMap should return None for None', () => {
    const none = None;
    const flatMapped = none.flatMap((x: number) => Some(x * 2));
    
    expect(isNone(flatMapped)).toBe(true);
  });

  test('fold should return default for None', () => {
    const none = None;
    const result = none.fold(() => 100, x => x * 2);
    
    expect(result).toBe(100);
  });

  test('fold should apply function to Some value', () => {
    const some = Some(42);
    const result = some.fold(() => 100, x => x * 2);
    
    expect(result).toBe(84);
  });

  test('getOrElse should return value for Some', () => {
    const some = Some(42);
    const result = some.getOrElse(() => 100);
    
    expect(result).toBe(42);
  });

  test('getOrElse should return default for None', () => {
    const none = None;
    const result = none.getOrElse(() => 100);
    
    expect(result).toBe(100);
  });

  test('fromNullable should create Some for non-null/undefined value', () => {
    const option = Option.fromNullable(42);
    expect(isSome(option)).toBe(true);
    expect((option as any).value).toBe(42);
  });

  test('fromNullable should create None for null', () => {
    const option = Option.fromNullable(null);
    expect(isNone(option)).toBe(true);
  });

  test('fromNullable should create None for undefined', () => {
    const option = Option.fromNullable(undefined);
    expect(isNone(option)).toBe(true);
  });

  test('fromNull should create Some for non-null value', () => {
    const option = Option.fromNull(42);
    expect(isSome(option)).toBe(true);
    expect((option as any).value).toBe(42);
  });

  test('fromNull should create None for null', () => {
    const option = Option.fromNull(null);
    expect(isNone(option)).toBe(true);
  });

  test('fromUndefined should create Some for non-undefined value', () => {
    const option = Option.fromUndefined(42);
    expect(isSome(option)).toBe(true);
    expect((option as any).value).toBe(42);
  });

  test('fromUndefined should create None for undefined', () => {
    const option = Option.fromUndefined(undefined);
    expect(isNone(option)).toBe(true);
  });
});