// The waiting room every shared table uses.
//
// Ascend and Racer both open a gameRooms table, fill it from the host's friends
// list, and start when the host says so — the only differences are the accent
// colour and the sentence explaining the game. Written twice these would drift,
// the way accepting an invite drifted between the pop-up and the Friends list
// before it was pulled into one place.
import { useEffect, useState } from 'react'
import { subscribeFriendships, type Friendship } from '../lib/social'
import { useUsernames } from '../lib/useUsernames'
import { displayNameFor } from '../lib/username'
import type { GameRoom } from '../lib/gameroom'

export default function TableLobby({
  room, uid, iAmHost, seated, busy, maxSeats, accent, heading, blurb,
  nameOf, onInvite, onJoin, onStart, onLeave,
}: {
  room: GameRoom
  uid: string
  iAmHost: boolean
  seated: boolean
  busy: boolean
  maxSeats: number
  accent: string
  heading: string
  /** One line telling the table what they're about to play. */
  blurb: React.ReactNode
  nameOf: (uid: string) => string
  onInvite: (friendUid: string) => void
  onJoin: () => void
  onStart: () => void
  onLeave: () => void
}) {
  const [friends, setFriends] = useState<Friendship[]>([])
  useEffect(() => subscribeFriendships(uid, setFriends, (err) =>
    console.error('[eclipse-arcade] friends feed failed:', err)), [uid])

  const friendUids = friends.map((f) => f.uids.find((u) => u !== uid) ?? '').filter(Boolean)
  const usernames = useUsernames(friendUids)
  const full = room.members.length >= maxSeats
  const btn = { background: accent, color: '#06140d' }

  return (
    <div className="grid gap-6">
      <div className="text-center">
        <p className="font-pixel text-[11px]" style={{ color: accent }}>{heading}</p>
        <div className="mt-2 text-sm text-white/70">{blurb}</div>
      </div>

      <section>
        <h2 className="font-pixel text-[10px] text-white/60 mb-2">
          AT THE TABLE · {room.members.length}/{maxSeats}
        </h2>
        <ul className="grid gap-2">
          {room.members.map((u) => (
            <li key={u} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
              <span className="text-sm text-white/90 truncate">
                {nameOf(u)}
                {u === room.host && <span className="ml-2 font-pixel text-[8px]" style={{ color: accent }}>HOST</span>}
                {u === uid && <span className="ml-2 text-xs text-white/45">you</span>}
              </span>
            </li>
          ))}
          {room.invited.map((u) => (
            <li key={u} className="flex items-center justify-between rounded-lg border border-white/10 border-dashed px-4 py-3">
              <span className="text-sm text-white/50 truncate">{nameOf(u)}</span>
              <span className="text-xs text-white/40">invited…</span>
            </li>
          ))}
        </ul>
      </section>

      {iAmHost && (
        <section>
          <h2 className="font-pixel text-[10px] text-white/60 mb-2">INVITE A FRIEND</h2>
          {friendUids.length === 0 ? (
            <p className="text-sm text-white/55">
              No friends yet — add some on the Friends page and they'll show up here.
            </p>
          ) : (
            <ul className="grid gap-2">
              {friendUids.map((f) => {
                const already = room.members.includes(f) || room.invited.includes(f)
                return (
                  <li key={f} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2.5">
                    <span className="text-sm text-white/85 truncate">{displayNameFor(usernames[f], null)}</span>
                    <button onClick={() => onInvite(f)} disabled={busy || already || full}
                      className="font-pixel text-[9px] px-3 py-2 rounded-lg disabled:opacity-40" style={btn}>
                      {already ? 'ASKED' : 'INVITE'}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      <div className="flex flex-wrap justify-center gap-3">
        {!seated && (
          <button onClick={onJoin} disabled={busy || full}
            className="font-pixel text-[11px] px-5 py-3 rounded-lg disabled:opacity-40" style={btn}>
            {full ? 'TABLE FULL' : 'TAKE A SEAT'}
          </button>
        )}
        {iAmHost && (
          <button onClick={onStart} disabled={busy || room.members.length < 2}
            className="font-pixel text-[11px] px-5 py-3 rounded-lg disabled:opacity-40" style={btn}>
            START
          </button>
        )}
        <button onClick={onLeave} disabled={busy}
          className="font-pixel text-[11px] px-5 py-3 rounded-lg bg-white/5 border border-white/10 text-white/80 hover:bg-white/10">
          {iAmHost ? 'CLOSE TABLE' : 'LEAVE'}
        </button>
      </div>
      {iAmHost && room.members.length < 2 && (
        <p className="text-center text-xs text-white/50">Invite at least one friend to start.</p>
      )}
    </div>
  )
}
