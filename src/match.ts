/* eslint-disable @typescript-eslint/no-explicit-any */
export type Predicate =
  | ((this: undefined, value: any, key: undefined, object: any, matcher: undefined) => unknown)
  | (<T extends Predicates>(this: T, value: any, key: string, object: any, matcher: T) => unknown)

export interface RegExpLike {
  /**
   * Returns a Boolean value that indicates whether or not a pattern exists in a searched string.
   * @param string String on which to perform the search.
   */
  test(string: string): boolean
}

export type Matcher = Predicate | Predicates | RegExp | unknown

/**
 * Defines the predicate properties to be invoked with the corresponding property values of a given object.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Predicates extends Record<string | number | symbol, Matcher | Matcher[]> {
  // Support cyclic references
}

export function match(
  value: unknown,
  predicate: Matcher,
  key?: string | undefined,
  object?: unknown,
  matcher?: Matcher | Matcher[],
): boolean {
  if (isEqual(value, predicate)) {
    return true
  }

  if (Array.isArray(predicate)) {
    return predicate.some((item) => match(value, item, key, object, matcher))
  }

  if (typeof predicate == 'function') {
    return Boolean(predicate.call(matcher, value, key, object, matcher))
  }

  if (typeof value == 'string' && isRegExpLike(predicate)) {
    return predicate.test(value)
  }

  if (isObjectLike(value) && isObjectLike(predicate)) {
    return Object.keys(predicate).every((key) =>
      match((value as any)[key], (predicate as any)[key], key, value, predicate),
    )
  }

  return false
}

/**
 * Performs a [SameValueZero](https://ecma-international.org/ecma-262/7.0/#sec-samevaluezero) comparison
 * between two values to determine if they are equivalent.
 *
 * **Note** SameValueZero differs from SameValue only in its treatment of `+0` and `-0`.
 * For SameValue comparison use `Object.is()`.
 */
function isEqual(value: unknown, other: unknown): boolean {
  return value === other || (Number.isNaN(value) && Number.isNaN(other))
}

/**
 * Return `true` if `value` is an object-like.
 *
 * A value is object-like if it's not `null` and has a `typeof` result of `"object"`.
 *
 * **Note** Keep in mind that functions are objects too.
 *
 * @param value to check
 */
// eslint-disable-next-line @typescript-eslint/ban-types
function isObjectLike(value: unknown): value is object {
  return value != null && typeof value == 'object'
}

function isRegExpLike(value: unknown): value is RegExpLike {
  return isObjectLike(value) && typeof (value as RegExp).test == 'function'
}
