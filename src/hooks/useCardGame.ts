// The card game's turn STATE MACHINE — the reusable flow layer that sits between
// the pure rules engine (lib/cardgame.ts) and whatever renders the table. It owns
// no card visuals: it exposes a plain view model (hands, counts, top card, whose
// turn, the current question/interaction) plus action callbacks. The 2D table
// today and the 3D table next stage both consume THIS — swapping the presentation
// never touches the flow, and the flow never re-implements a rule (every move
// goes through the engine).
//
// Effects live only here at the edge: a timer paces the AI so the human watches
// each move, Math.random is the injected rng, and sound/reward callbacks are
// passed in. Human interaction is modelled as an explicit in-flight `act`
// (play / stack / draw) that a color pick and/or a solved question resolve.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Difficulty, Question } from '../data/subjects'
import {
  createGame, legalPlays, requiredDifficulty, playCard, stackOrTake, drawToPlay,
  aiChoose, aiSolves, aiCorrectRate, topCard, handCounts,
  type Card, type Color, type GameState,
} from '../lib/cardgame'
import { describeCard, placementFor, cardGameScore } from '../lib/cardgameView'

const HUMAN = 0
const AI_DELAY_MIN = 800 // ms — the field acts slowly enough to follow
const AI_DELAY_SPREAD = 400 // 0.8–1.2s per AI move

const rng = () => Math.random()

/** A card game as configured on the setup screen and dealt by `begin`. */
export interface CardGameConfig {
  playerCount: number
  difficulty: Difficulty // tunes the AI field's accuracy
  aiNames: string[] // length playerCount - 1
  pools: { easy: Question[]; hard: Question[] } // both guaranteed non-empty
}

// What the human is CURRENTLY resolving. Wilds gain a `color` on the color-pick
// step before the question; the question's solve outcome then drives the engine.
type HumanAct =
  | { kind: 'play'; card: Card; color?: Color }
  | { kind: 'stack'; card: Card; color?: Color }
  | { kind: 'draw' }

export type CardPhase =
  | 'idle' // no game yet
  | 'ai' // an AI is thinking/acting (paced by a timer)
  | 'choose' // human's normal turn: play a legal card or draw
  | 'penalty' // human faces a pending draw: stack a matching card or take it
  | 'color' // human is declaring a wild's color
  | 'question' // a question gates the in-flight act
  | 'drawn' // human drew a playable card: play it (same solve) — engine keeps the turn
  | 'gameover'

export interface CardGameResult {
  placement: number
  playerCount: number
  score: number
  rewards: { xp: number; coins: number; best: boolean }
}

export interface CardGameView {
  phase: CardPhase
  state: GameState | null
  hand: Card[] // the human's cards
  legal: Card[] // playable subset of `hand` this turn (empty off-turn)
  stackable: Card[] // cards that could answer a pending penalty ('penalty' phase)
  top: Card | null // the discard's top
  currentColor: Color | null // the active color (a wild may diverge from `top`)
  question: Question | null // shown in 'question' phase
  questionLabel: string // pixel heading for the question panel
  activeCard: Card | null // card being color-picked / drawn (for the overlay)
  pendingDraw: number // size of the penalty facing the human ('penalty' phase)
  seats: { name: string; count: number; current: boolean }[] // opponents 1..n-1
  yourTurn: boolean
  log: string // latest event, for the aria-live ticker
  result: CardGameResult | null
}

export interface CardGameActions {
  begin: (config: CardGameConfig) => void
  replay: () => void
  selectCard: (card: Card) => void // 'choose': play this legal card
  requestDraw: () => void // 'choose' with no legal card: solve to draw
  selectStack: (card: Card) => void // 'penalty': answer with this matching card
  takePenalty: () => void // 'penalty': take the whole stack
  chooseColor: (color: Color) => void // 'color': declare a wild's color
  answer: (correct: boolean) => void // 'question': resolve the in-flight act
  playDrawn: (color?: Color) => void // 'drawn': play the just-drawn card
}

interface Hooks {
  finishGame: (gameKey: string, score: number) => { xp: number; coins: number; best: boolean }
  recordAnswer: (correct: boolean) => void
  onCorrect?: () => void
  onWrong?: () => void
  onWin?: () => void
}

// A refillable, shuffled question queue per difficulty tier. Fresh objects on
// each pull so QuestionPanel (keyed on identity) resets its inputs.
interface Pool { list: Question[]; idx: number }
function shuffled<T>(items: readonly T[]): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
function pull(pool: Pool): Question {
  if (pool.list.length === 0) return { prompt: '—' } // guarded: configs always ship non-empty pools
  if (pool.idx >= pool.list.length) { pool.list = shuffled(pool.list); pool.idx = 0 }
  return { ...pool.list[pool.idx++] }
}

export function useCardGame(hooks: Hooks): CardGameView & { actions: CardGameActions } {
  const [phase, setPhase] = useState<CardPhase>('idle')
  const [state, setStateRaw] = useState<GameState | null>(null)
  const [question, setQuestion] = useState<Question | null>(null)
  const [questionLabel, setQuestionLabel] = useState('SOLVE TO PLAY')
  const [act, setAct] = useState<HumanAct | null>(null)
  const [drawnCard, setDrawnCard] = useState<Card | null>(null)
  const [log, setLog] = useState('')
  const [result, setResult] = useState<CardGameResult | null>(null)

  // Refs mirror the pieces the paced AI stepper and the resolvers read
  // synchronously — state must be current the instant a callback fires, before
  // React re-renders.
  const stateRef = useRef<GameState | null>(null)
  const configRef = useRef<CardGameConfig | null>(null)
  const easyRef = useRef<Pool>({ list: [], idx: 0 })
  const hardRef = useRef<Pool>({ list: [], idx: 0 })
  const hooksRef = useRef(hooks)
  hooksRef.current = hooks

  const setGame = useCallback((s: GameState) => { stateRef.current = s; setStateRaw(s) }, [])

  const pullFor = useCallback((tier: 'easy' | 'hard'): Question => {
    return pull(tier === 'hard' ? hardRef.current : easyRef.current)
  }, [])

  const finish = useCallback((s: GameState) => {
    const counts = handCounts(s)
    const placement = placementFor(counts, HUMAN)
    const score = cardGameScore(placement, counts.length, counts[HUMAN])
    const rewards = hooksRef.current.finishGame('cardgame', score)
    if (placement === 1) hooksRef.current.onWin?.()
    setResult({ placement, playerCount: counts.length, score, rewards })
    setPhase('gameover')
  }, [])

  // Commit an engine result and route to the next phase: game over → results,
  // human's turn → play or answer a penalty, otherwise hand off to the AI.
  const settle = useCallback((next: GameState, message: string) => {
    setGame(next)
    setLog(message)
    setAct(null)
    setQuestion(null)
    setDrawnCard(null)
    if (next.winner !== null) { finish(next); return }
    if (next.turn === HUMAN) { setPhase(next.pendingDraw > 0 ? 'penalty' : 'choose'); return }
    setPhase('ai')
  }, [setGame, finish])

  // ---- AI stepper: one move per tick, paced so the human sees it happen ----
  const stepAi = useCallback(() => {
    const s = stateRef.current
    if (!s || s.winner !== null || s.turn === HUMAN) return
    const cfg = configRef.current
    if (!cfg) return
    const ai = s.turn
    const name = cfg.aiNames[ai - 1] ?? `CPU ${ai}`
    const { action } = aiChoose(s, ai, rng)
    const rate = aiCorrectRate(ai - 1, cfg.difficulty)

    switch (action.kind) {
      case 'play': {
        const solved = aiSolves(rng, rate)
        const res = playCard(s, ai, action.card, solved, rng, action.chosenColor)
        settle(res.state, solved
          ? `${name} plays ${describeCard(action.card, action.chosenColor)}`
          : `${name} misreads the question — draws 1`)
        return
      }
      case 'stack': {
        const solved = aiSolves(rng, rate)
        const owed = s.pendingDraw
        const res = stackOrTake(s, ai, action.card, solved, rng, action.chosenColor)
        settle(res.state, res.outcome === 'stacked'
          ? `${name} stacks ${describeCard(action.card, action.chosenColor)}`
          : `${name} takes +${owed}`)
        return
      }
      case 'take': {
        const owed = s.pendingDraw
        const res = stackOrTake(s, ai, null, false, rng)
        settle(res.state, `${name} takes +${owed}`)
        return
      }
      case 'draw': {
        const solved = aiSolves(rng, rate)
        const res = drawToPlay(s, ai, solved, rng)
        // 'drew-playable' keeps the turn on the AI; the next tick plays the card.
        settle(res.state, res.outcome === 'drew-forfeit'
          ? `${name} can't answer — draws 2`
          : `${name} draws a card`)
        return
      }
    }
  }, [settle])

  useEffect(() => {
    if (phase !== 'ai') return
    const t = window.setTimeout(stepAi, AI_DELAY_MIN + Math.random() * AI_DELAY_SPREAD)
    return () => window.clearTimeout(t)
  }, [phase, state, stepAi])

  // ---- setup ----
  const startWith = useCallback((cfg: CardGameConfig) => {
    configRef.current = cfg
    easyRef.current = { list: shuffled(cfg.pools.easy), idx: 0 }
    hardRef.current = { list: shuffled(cfg.pools.hard), idx: 0 }
    const dealt = createGame(cfg.playerCount, rng)
    setResult(null)
    setAct(null)
    setQuestion(null)
    setDrawnCard(null)
    setLog('Cards dealt — your move.')
    setGame(dealt)
    // The opener is never a wild/action-with-pending, so turn 0 always starts on a clean choose.
    setPhase(dealt.turn === HUMAN ? 'choose' : 'ai')
  }, [setGame])

  const begin = useCallback((cfg: CardGameConfig) => { startWith(cfg) }, [startWith])
  const replay = useCallback(() => { if (configRef.current) startWith(configRef.current) }, [startWith])

  // ---- human actions ----
  const selectCard = useCallback((card: Card) => {
    if (phase !== 'choose') return
    const s = stateRef.current
    if (!s || !legalPlays(s, HUMAN).some((c) => c.id === card.id)) return
    if (card.kind === 'wild' || card.kind === 'wild4') {
      setAct({ kind: 'play', card })
      setPhase('color')
      return
    }
    setAct({ kind: 'play', card })
    setQuestion(pullFor(requiredDifficulty(card)))
    setQuestionLabel('SOLVE TO PLAY')
    setPhase('question')
  }, [phase, pullFor])

  const requestDraw = useCallback(() => {
    if (phase !== 'choose') return
    setAct({ kind: 'draw' })
    setQuestion(pullFor('easy'))
    setQuestionLabel('SOLVE TO DRAW')
    setPhase('question')
  }, [phase, pullFor])

  const selectStack = useCallback((card: Card) => {
    if (phase !== 'penalty') return
    const s = stateRef.current
    if (!s || card.kind !== s.pendingKind) return
    if (card.kind === 'wild4') {
      setAct({ kind: 'stack', card })
      setPhase('color')
      return
    }
    setAct({ kind: 'stack', card })
    setQuestion(pullFor('hard'))
    setQuestionLabel('SOLVE TO STACK')
    setPhase('question')
  }, [phase, pullFor])

  const takePenalty = useCallback(() => {
    if (phase !== 'penalty') return
    const s = stateRef.current
    if (!s) return
    const owed = s.pendingDraw
    const res = stackOrTake(s, HUMAN, null, false, rng)
    settle(res.state, `You take +${owed}`)
  }, [phase, settle])

  const chooseColor = useCallback((color: Color) => {
    if (phase !== 'color' || !act || act.kind === 'draw') return
    setAct({ ...act, color })
    setQuestion(pullFor('hard')) // wild plays and wild4 stacks are always the hard tier
    setQuestionLabel(act.kind === 'stack' ? 'SOLVE TO STACK' : 'SOLVE TO PLAY')
    setPhase('question')
  }, [phase, act, pullFor])

  const answer = useCallback((correct: boolean) => {
    if (phase !== 'question' || !act) return
    const s = stateRef.current
    if (!s) return
    hooksRef.current.recordAnswer(correct)
    if (correct) hooksRef.current.onCorrect?.(); else hooksRef.current.onWrong?.()

    if (act.kind === 'play') {
      const res = playCard(s, HUMAN, act.card, correct, rng, act.color)
      settle(res.state, correct
        ? `You play ${describeCard(act.card, act.color)}`
        : `Wrong — you forfeit the play and draw 1`)
      return
    }
    if (act.kind === 'stack') {
      const owed = s.pendingDraw
      const res = stackOrTake(s, HUMAN, act.card, correct, rng, act.color)
      settle(res.state, correct
        ? `You stack ${describeCard(act.card, act.color)}`
        : `Wrong — you take +${owed}`)
      return
    }
    // draw
    const res = drawToPlay(s, HUMAN, correct, rng)
    if (res.outcome === 'drew-playable' && res.playableDrawn) {
      setGame(res.state)
      setAct(null)
      setQuestion(null)
      setDrawnCard(res.playableDrawn)
      setLog(`You drew ${describeCard(res.playableDrawn)} — playable, so play it`)
      setPhase('drawn')
      return
    }
    settle(res.state, correct ? 'You draw a card' : 'Wrong — you draw 2 and pass')
  }, [phase, act, settle, setGame])

  const playDrawn = useCallback((color?: Color) => {
    if (phase !== 'drawn' || !drawnCard) return
    const s = stateRef.current
    if (!s) return
    const isWild = drawnCard.kind === 'wild' || drawnCard.kind === 'wild4'
    if (isWild && !color) return // the overlay must supply a color for a wild
    // Same solve that drew the card — no second question (engine's turn-stays contract).
    const res = playCard(s, HUMAN, drawnCard, true, rng, color)
    settle(res.state, `You play ${describeCard(drawnCard, color)}`)
  }, [phase, drawnCard, settle])

  // ---- derived view ----
  const cfg = configRef.current
  const hand = state ? state.players[HUMAN] : []
  const legal = state && phase === 'choose' ? legalPlays(state, HUMAN) : []
  const stackable = state && phase === 'penalty'
    ? state.players[HUMAN].filter((c) => c.kind === state.pendingKind)
    : []
  const seats = state && cfg
    ? state.players.slice(1).map((h, i) => ({
        name: cfg.aiNames[i] ?? `CPU ${i + 1}`,
        count: h.length,
        current: state.turn === i + 1 && state.winner === null,
      }))
    : []
  const activeCard = phase === 'drawn' ? drawnCard : (phase === 'color' && act && act.kind !== 'draw' ? act.card : null)

  return {
    phase,
    state,
    hand,
    legal,
    stackable,
    top: state ? topCard(state) : null,
    currentColor: state ? state.currentColor : null,
    question,
    questionLabel,
    activeCard,
    pendingDraw: state ? state.pendingDraw : 0,
    seats,
    yourTurn: state?.turn === HUMAN && state.winner === null,
    log,
    result,
    actions: {
      begin, replay, selectCard, requestDraw, selectStack, takePenalty, chooseColor, answer, playDrawn,
    },
  }
}
