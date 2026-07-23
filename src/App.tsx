import { Routes, Route } from 'react-router-dom'
import Lobby from './pages/Lobby'
import Game from './pages/Game'
import Battleship from './pages/Battleship'
import BattleshipPvp from './pages/BattleshipPvp'
import Racer from './pages/Racer'
import Friends from './pages/Friends'
import Admin from './pages/Admin'
import Settings from './pages/Settings'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Lobby />} />
      <Route path="/battleship" element={<Battleship />} />
      <Route path="/battleship/pvp/:matchId" element={<BattleshipPvp />} />
      <Route path="/racer" element={<Racer />} />
      <Route path="/friends" element={<Friends />} />
      <Route path="/play/:gameKey" element={<Game />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/settings" element={<Settings />} />
    </Routes>
  )
}
