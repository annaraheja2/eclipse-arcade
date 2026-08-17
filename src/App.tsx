import { Routes, Route } from 'react-router-dom'
import Lobby from './pages/Lobby'
import Game from './pages/Game'
import Battleship from './pages/Battleship'
import BattleshipPvp from './pages/BattleshipPvp'
import Racer from './pages/Racer'
import CardGame from './pages/CardGame'
import Ascend from './pages/Ascend'
import LastStanding from './pages/LastStanding'
import LastStandingOnline from './pages/LastStandingOnline'
import Friends from './pages/Friends'
import Practice from './pages/Practice'
import Admin from './pages/Admin'
import Settings from './pages/Settings'
import InviteToast from './components/InviteToast'

export default function App() {
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
      <Route path="/cardgame" element={<CardGame />} />
      <Route path="/ascend" element={<Ascend />} />
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
