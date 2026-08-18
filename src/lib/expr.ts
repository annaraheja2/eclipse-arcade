// A tiny arithmetic expression evaluator.
//
// Question templates compute their own answers ("a + (n - 1) * b"), which is
// the whole reason a template can't grade you wrong — the answer is worked out,
// not stored or guessed. Those expressions are authored content: they come from
// data/templates.ts today and from an admin form later, so they are NEVER run
// through eval or new Function. This parses them itself, which keeps a template
// unable to reach anything outside the numbers handed to it.
//
// Pure, no dependencies, and a parse error is a returned reason rather than a
// thrown string — callers surface it to the author.

export type Vars = Readonly<Record<string, number>>

// Precedence, loosest first. Comparisons and the logical pair exist for a
// template's `where` guards ("answer is a whole number"), where a non-zero
// result counts as true.
type Tok =
  | { t: 'num'; v: number }
  | { t: 'ident'; v: string }
  | { t: 'op'; v: string }
  | { t: '('; }
  | { t: ')'; }
  | { t: ','; }

const OPS = ['||', '&&', '<=', '>=', '==', '!=', '<', '>', '+', '-', '*', '/', '%', '^']

/** Functions an expression may call. All total: no throwing, no globals. */
const FNS: Record<string, { arity: number | 'any'; fn: (a: number[]) => number }> = {
  abs: { arity: 1, fn: ([x]) => Math.abs(x) },
  sqrt: { arity: 1, fn: ([x]) => Math.sqrt(x) },
  floor: { arity: 1, fn: ([x]) => Math.floor(x) },
  ceil: { arity: 1, fn: ([x]) => Math.ceil(x) },
  round: { arity: 1, fn: ([x]) => Math.round(x) },
  sign: { arity: 1, fn: ([x]) => Math.sign(x) },
  min: { arity: 'any', fn: (a) => Math.min(...a) },
  max: { arity: 'any', fn: (a) => Math.max(...a) },
  pow: { arity: 2, fn: ([x, y]) => Math.pow(x, y) },
  gcd: { arity: 2, fn: ([x, y]) => gcd(x, y) },
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a))
  let y = Math.abs(Math.round(b))
  while (y > 0) { const t = x % y; x = y; y = t }
  return x
}

class ParseError extends Error {}

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue }
    if (c === '(') { out.push({ t: '(' }); i++; continue }
    if (c === ')') { out.push({ t: ')' }); i++; continue }
    if (c === ',') { out.push({ t: ',' }); i++; continue }
    if (c >= '0' && c <= '9') {
      let j = i
      while (j < src.length && /[0-9]/.test(src[j])) j++
      if (src[j] === '.') { j++; while (j < src.length && /[0-9]/.test(src[j])) j++ }
      out.push({ t: 'num', v: Number(src.slice(i, j)) })
      i = j
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++
      out.push({ t: 'ident', v: src.slice(i, j) })
      i = j
      continue
    }
    const op = OPS.find((o) => src.startsWith(o, i))
    if (op) { out.push({ t: 'op', v: op }); i += op.length; continue }
    throw new ParseError(`unexpected character "${c}"`)
  }
  return out
}

// Recursive descent. Each level consumes its own operators and defers to the
// tighter-binding level below it.
class Parser {
  private pos = 0
  constructor(private readonly toks: Tok[], private readonly vars: Vars) {}

  private peek(): Tok | undefined { return this.toks[this.pos] }
  private eat(): Tok {
    const t = this.toks[this.pos++]
    if (!t) throw new ParseError('expression ended early')
    return t
  }
  private isOp(v: string): boolean {
    const t = this.peek()
    return t?.t === 'op' && t.v === v
  }

  parse(): number {
    const v = this.or()
    if (this.pos !== this.toks.length) throw new ParseError('unexpected trailing input')
    return v
  }

  private or(): number {
    let left = this.and()
    while (this.isOp('||')) { this.eat(); const r = this.and(); left = left !== 0 || r !== 0 ? 1 : 0 }
    return left
  }
  private and(): number {
    let left = this.cmp()
    while (this.isOp('&&')) { this.eat(); const r = this.cmp(); left = left !== 0 && r !== 0 ? 1 : 0 }
    return left
  }
  private cmp(): number {
    let left = this.sum()
    for (;;) {
      const t = this.peek()
      if (t?.t !== 'op') return left
      const o = t.v
      if (!['<', '<=', '>', '>=', '==', '!='].includes(o)) return left
      this.eat()
      const r = this.sum()
      // Authored numbers land on halves and thirds, so equality is compared
      // with a tolerance rather than exactly.
      const eq = Math.abs(left - r) < 1e-9
      left =
        o === '<' ? (left < r ? 1 : 0)
          : o === '<=' ? (left <= r ? 1 : 0)
            : o === '>' ? (left > r ? 1 : 0)
              : o === '>=' ? (left >= r ? 1 : 0)
                : o === '==' ? (eq ? 1 : 0)
                  : (eq ? 0 : 1)
    }
  }
  private sum(): number {
    let left = this.product()
    for (;;) {
      if (this.isOp('+')) { this.eat(); left += this.product(); continue }
      if (this.isOp('-')) { this.eat(); left -= this.product(); continue }
      return left
    }
  }
  private product(): number {
    let left = this.unary()
    for (;;) {
      if (this.isOp('*')) { this.eat(); left *= this.unary(); continue }
      if (this.isOp('/')) {
        this.eat()
        const r = this.unary()
        if (r === 0) throw new ParseError('division by zero')
        left /= r
        continue
      }
      if (this.isOp('%')) {
        this.eat()
        const r = this.unary()
        if (r === 0) throw new ParseError('remainder by zero')
        left %= r
        continue
      }
      return left
    }
  }
  private unary(): number {
    if (this.isOp('-')) { this.eat(); return -this.unary() }
    if (this.isOp('+')) { this.eat(); return this.unary() }
    return this.power()
  }
  // Right-associative, and the exponent may itself be signed: 2^-1.
  private power(): number {
    const base = this.primary()
    if (this.isOp('^')) { this.eat(); return Math.pow(base, this.unary()) }
    return base
  }
  private primary(): number {
    const t = this.eat()
    if (t.t === 'num') return t.v
    if (t.t === '(') {
      const v = this.or()
      const close = this.eat()
      if (close.t !== ')') throw new ParseError('missing closing bracket')
      return v
    }
    if (t.t === 'ident') {
      const fn = FNS[t.v]
      if (this.peek()?.t === '(') {
        if (!fn) throw new ParseError(`unknown function "${t.v}"`)
        this.eat()
        const args: number[] = []
        if (this.peek()?.t !== ')') {
          args.push(this.or())
          while (this.peek()?.t === ',') { this.eat(); args.push(this.or()) }
        }
        const close = this.eat()
        if (close.t !== ')') throw new ParseError('missing closing bracket')
        if (fn.arity !== 'any' && args.length !== fn.arity) {
          throw new ParseError(`${t.v}() takes ${fn.arity} argument${fn.arity === 1 ? '' : 's'}`)
        }
        if (fn.arity === 'any' && args.length === 0) throw new ParseError(`${t.v}() needs an argument`)
        return fn.fn(args)
      }
      // hasOwnProperty, not `in`: `in` walks the prototype chain, so a name
      // like "constructor" or "toString" would resolve to a function off
      // Object.prototype instead of being rejected as unknown.
      if (!Object.prototype.hasOwnProperty.call(this.vars, t.v)) {
        throw new ParseError(`unknown name "${t.v}"`)
      }
      return this.vars[t.v]
    }
    throw new ParseError('expected a number, name or bracket')
  }
}

export type EvalResult =
  | { ok: true; value: number }
  | { ok: false; reason: string }

/**
 * Evaluates `src` against `vars`. Never throws: a malformed expression, an
 * unknown name, or a result that isn't a finite number all come back as a
 * reason the author can read.
 */
export function evaluate(src: string, vars: Vars): EvalResult {
  try {
    const value = new Parser(tokenize(src), vars).parse()
    if (!Number.isFinite(value)) return { ok: false, reason: 'result is not a finite number' }
    return { ok: true, value }
  } catch (err) {
    return { ok: false, reason: err instanceof ParseError ? err.message : 'could not read the expression' }
  }
}

/** True when the expression holds — a template's `where` guard. */
export function holds(src: string, vars: Vars): boolean {
  const r = evaluate(src, vars)
  return r.ok && r.value !== 0
}

/** Every variable name an expression reads, for checking a template up front. */
export function namesUsed(src: string): string[] {
  let toks: Tok[]
  try { toks = tokenize(src) } catch { return [] }
  const names = new Set<string>()
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (t.t === 'ident' && toks[i + 1]?.t !== '(') names.add(t.v)
  }
  return [...names]
}
