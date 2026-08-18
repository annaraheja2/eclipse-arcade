import { describe, it, expect } from 'vitest'
import { evaluate, holds, namesUsed } from './expr'

const val = (src: string, vars: Record<string, number> = {}) => {
  const r = evaluate(src, vars)
  return r.ok ? r.value : `ERR: ${r.reason}`
}

describe('arithmetic', () => {
  it('reads plain numbers and decimals', () => {
    expect(val('42')).toBe(42)
    expect(val('3.5')).toBe(3.5)
  })
  it('adds and subtracts left to right', () => {
    expect(val('10 - 3 - 2')).toBe(5)
  })
  it('multiplies before adding', () => {
    expect(val('2 + 3 * 4')).toBe(14)
  })
  it('honours brackets', () => {
    expect(val('(2 + 3) * 4')).toBe(20)
  })
  it('divides and takes remainders', () => {
    expect(val('7 / 2')).toBe(3.5)
    expect(val('7 % 3')).toBe(1)
  })
  it('raises to powers, right associatively', () => {
    expect(val('2 ^ 3')).toBe(8)
    expect(val('2 ^ 3 ^ 2')).toBe(512) // 2^(3^2), not (2^3)^2
  })
  it('binds a power tighter than a product', () => {
    expect(val('2 * 3 ^ 2')).toBe(18)
  })
  it('handles unary minus, including on an exponent', () => {
    expect(val('-5')).toBe(-5)
    expect(val('3 - -2')).toBe(5)
    expect(val('2 ^ -1')).toBe(0.5)
  })
})

describe('variables', () => {
  it('substitutes them', () => {
    expect(val('a + (n - 1) * b', { a: 4, b: 7, n: 10 })).toBe(67)
  })
  it('refuses an unknown name instead of guessing zero', () => {
    expect(val('a + q', { a: 1 })).toBe('ERR: unknown name "q"')
  })
  it('accepts multi-character and underscored names', () => {
    expect(val('first_term * 2', { first_term: 6 })).toBe(12)
  })
})

describe('functions', () => {
  it('computes the ones templates need', () => {
    expect(val('abs(-4)')).toBe(4)
    expect(val('sqrt(81)')).toBe(9)
    expect(val('round(2.6)')).toBe(3)
    expect(val('floor(2.6)')).toBe(2)
    expect(val('ceil(2.1)')).toBe(3)
    expect(val('min(3, 9, 5)')).toBe(3)
    expect(val('max(3, 9, 5)')).toBe(9)
    expect(val('pow(3, 4)')).toBe(81)
    expect(val('gcd(12, 18)')).toBe(6)
  })
  it('checks the argument count', () => {
    expect(val('sqrt(1, 2)')).toBe('ERR: sqrt() takes 1 argument')
    expect(val('pow(2)')).toBe('ERR: pow() takes 2 arguments')
    expect(val('min()')).toBe('ERR: min() needs an argument')
  })
  it('rejects an unknown function rather than treating it as a name', () => {
    expect(val('frobnicate(2)')).toBe('ERR: unknown function "frobnicate"')
  })
})

describe('comparisons and guards', () => {
  it('returns 1 or 0', () => {
    expect(val('3 < 5')).toBe(1)
    expect(val('3 > 5')).toBe(0)
    expect(val('4 >= 4')).toBe(1)
    expect(val('4 != 5')).toBe(1)
  })
  it('compares equality with a tolerance, so thirds still match', () => {
    expect(val('1 / 3 * 3 == 1')).toBe(1)
  })
  it('combines with and / or', () => {
    expect(val('1 < 2 && 3 < 4')).toBe(1)
    expect(val('1 > 2 || 3 < 4')).toBe(1)
    expect(val('1 > 2 && 3 < 4')).toBe(0)
  })
  it('drives `holds` for template guards', () => {
    // the guard a template uses to keep answers whole
    expect(holds('a % b == 0', { a: 12, b: 4 })).toBe(true)
    expect(holds('a % b == 0', { a: 12, b: 5 })).toBe(false)
  })
  it('treats an unreadable guard as not holding', () => {
    expect(holds('a +', { a: 1 })).toBe(false)
  })
})

describe('failure is reported, never thrown', () => {
  it('catches a malformed expression', () => {
    expect(val('2 +')).toBe('ERR: expression ended early')
    expect(val('(2 + 3')).toBe('ERR: expression ended early')
    expect(val('2 3')).toBe('ERR: unexpected trailing input')
  })
  it('catches a stray character', () => {
    expect(val('2 $ 3')).toBe('ERR: unexpected character "$"')
  })
  it('catches division by zero rather than returning Infinity', () => {
    expect(val('1 / 0')).toBe('ERR: division by zero')
    expect(val('1 % 0')).toBe('ERR: remainder by zero')
  })
  it('rejects a result that is not a finite number', () => {
    expect(val('sqrt(-1)')).toBe('ERR: result is not a finite number')
  })
  it('never evaluates arbitrary code', () => {
    // no globals, no property access, no calls beyond the allow-list
    expect(val('constructor')).toBe('ERR: unknown name "constructor"')
    expect(val('globalThis')).toBe('ERR: unknown name "globalThis"')
    expect(val('a.b', { a: 1 })).toBe('ERR: unexpected character "."')
  })
  it('is empty-safe', () => {
    expect(val('')).toBe('ERR: expression ended early')
  })
})

describe('namesUsed', () => {
  it('lists the variables an expression reads', () => {
    expect(namesUsed('a + (n - 1) * b').sort()).toEqual(['a', 'b', 'n'])
  })
  it('does not count function names as variables', () => {
    expect(namesUsed('sqrt(a) + max(b, 2)').sort()).toEqual(['a', 'b'])
  })
  it('is empty for a constant, and safe on nonsense', () => {
    expect(namesUsed('42')).toEqual([])
    expect(namesUsed('2 $ 3')).toEqual([])
  })
})
