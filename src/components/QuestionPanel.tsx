import { useEffect, useState } from 'react'
import type { Question } from '../data/subjects'
import PinBoard from './PinBoard'
import SliderBoard from './SliderBoard'
import FillInput from './FillInput'

function normalize(s: string) { return s.trim().toLowerCase().replace(/\s+/g, ' ') }

export function checkAnswer(q: Question, guess: { pt?: { x: number; y: number }; val?: number | null; text?: string }): boolean {
  if (q.x !== undefined) { // graph
    if (!guess.pt) return false
    return Math.abs(guess.pt.x - q.x) <= 0.5 && Math.abs(guess.pt.y - (q.y ?? 0)) <= 0.5
  }
  if (q.answer !== undefined) { // slider
    if (guess.val === null || guess.val === undefined) return false
    return Math.abs(guess.val - q.answer) <= (q.step ?? 0.5)
  }
  // fill
  const a = normalize(q.fill ?? '')
  const t = normalize(guess.text ?? '')
  if (a === t) return true
  const na = Number(a), nt = Number(t)
  return !Number.isNaN(na) && !Number.isNaN(nt) && na === nt
}

export default function QuestionPanel({ q, color, onSubmit }: { q: Question; color: string; onSubmit: (correct: boolean) => void }) {
  const [pt, setPt] = useState<{ x: number; y: number } | null>(null)
  const [val, setVal] = useState<number | null>(null)
  const [text, setText] = useState('')

  useEffect(() => { setPt(null); setVal(null); setText('') }, [q])

  const ready = q.x !== undefined ? pt !== null : q.answer !== undefined ? val !== null : text.trim() !== ''

  function submit() {
    if (!ready) return
    onSubmit(checkAnswer(q, { pt: pt ?? undefined, val, text }))
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="text-center text-[10px] font-pixel mb-3" style={{ color }}>ANSWER TO EARN A SHOT</div>
      <p className={`text-center text-lg font-semibold ${q.explain ? 'mb-2' : 'mb-4'}`}>{q.prompt}</p>
      {q.explain && <p className="text-center text-xs text-white/70 mb-4">{q.explain}</p>}
      <div className="mb-4">
        {q.x !== undefined && <PinBoard range={q.range ?? 8} color={color} guess={pt} answer={null} onPlace={(x, y) => setPt({ x, y })} />}
        {q.answer !== undefined && <SliderBoard min={q.min!} max={q.max!} step={q.step ?? 0.5} color={color} guess={val} answer={null} onPlace={setVal} />}
        {q.fill !== undefined && <FillInput value={text} onChange={setText} color={color} onEnter={submit} />}
      </div>
      <button onClick={submit} disabled={!ready}
        className="w-full font-pixel text-[11px] py-3.5 rounded-xl text-[#0a0620] disabled:opacity-40 transition"
        style={{ background: color, boxShadow: ready ? `0 0 18px ${color}88` : 'none' }}>
        SUBMIT
      </button>
    </div>
  )
}
