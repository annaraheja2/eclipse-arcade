import { Routes, Route } from 'react-router-dom'
import Lobby from './pages/Lobby'
import Game from './pages/Game'
import Battleship from './pages/Battleship'
import Admin from './pages/Admin'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Lobby />} />
      <Route path="/battleship" element={<Battleship />} />
      <Route path="/play/:gameKey" element={<Game />} />
      <Route path="/admin" element={<Admin />} />
    </Routes>
  )
}
