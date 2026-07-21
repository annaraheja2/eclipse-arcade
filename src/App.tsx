import { Routes, Route } from 'react-router-dom'
import Lobby from './pages/Lobby'
import Game from './pages/Game'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Lobby />} />
      <Route path="/play/:gameKey" element={<Game />} />
    </Routes>
  )
}
