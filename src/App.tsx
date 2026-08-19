import { Routes, Route } from 'react-router-dom'
import Lobby from './pages/Lobby'
import Game from './pages/Game'
import Battleship from './pages/Battleship'
import BattleshipPvp from './pages/BattleshipPvp'
import Racer from './pages/Racer'
import RacerOnline from './pages/RacerOnline'
import CardGame from './pages/CardGame'
import CardGameOnline from './pages/CardGameOnline'
import Ascend from './pages/Ascend'
import AscendOnline from './pages/AscendOnline'
import LastStanding from './pages/LastStanding'
import LastStandingOnline from './pages/LastStandingOnline'
import Friends from './pages/Friends'
import Practice from './pages/Practice'
import Admin from './pages/Admin'
import Settings from './pages/Settings'
import InviteToast from './components/InviteToast'
import Onboarding from './pages/Onboarding'
import { useState } from 'react'
import { useAuth } from './lib/auth'
import { usePlayer } from './lib/player'

/**
 * Whether a signed-in player still needs the welcome screens.
 *
 * Derived from the two answers themselves rather than a separate "done" flag,
 * so it is right on a new device without anything extra syncing — and a player
 * who already had a name and a course before this existed is never asked.
 */
function useNeedsOnboarding(): boolean {
  const { user, loading } = useAuth()
  const { player } = usePlayer()
  if (loading || !user) return false
  return !player.username || !player.preferredCourseId
}

export default function App() {
  const { user } = useAuth()
  const [justFinished, setJustFinished] = useState(false)
  const needsOnboarding = useNeedsOnboarding() && !justFinished

  // Signed in but not set up yet: the welcome screens stand in for the whole
  // app. Signed out play is untouched — the arcade has always been playable
  // without an account, and gating that would be a regression.
  if (user && needsOnboarding) {
    return <Onboarding onDone={() => setJustFinished(true)} />
  }

  return (
    <>
      {/* Mounted outside the routes so an invite reaches you mid-game, not only
          on the Friends page. */}
      <InviteToast />
      <Routes>
        <Route path="/" element={<Lobby />} />
        <Route path="/battleship" element={<Battleship />} />
        <Route path="/battleship/pvp/:matchId" element={<BattleshipPvp />} />
        <Route path="/racer" element={<Racer />} />
        <Route path="/racer/room/:roomId" element={<RacerOnline />} />
        <Route path="/cardgame" element={<CardGame />} />
        <Route path="/cardgame/room/:roomId" element={<CardGameOnline />} />
        <Route path="/ascend" element={<Ascend />} />
        <Route path="/ascend/room/:roomId" element={<AscendOnline />} />
        <Route path="/laststanding" element={<LastStanding />} />
        <Route path="/laststanding/room/:roomId" element={<LastStandingOnline />} />
        <Route path="/friends" element={<Friends />} />
        <Route path="/practice" element={<Practice />} />
        <Route path="/play/:gameKey" element={<Game />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </>
  )
}
