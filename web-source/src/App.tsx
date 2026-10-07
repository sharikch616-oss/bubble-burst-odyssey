import { useState, useEffect } from 'react'

export default function App() {
  const [gameActive, setGameActive] = useState(false)
  const [score, setScore] = useState(0)
  const [gameOver, setGameOver] = useState(false)

  useEffect(() => {
    if (!gameActive) return
    // Game loop would go here
  }, [gameActive])

  const startGame = () => {
    setGameActive(true)
    setScore(0)
    setGameOver(false)
  }

  const endGame = () => {
    setGameActive(false)
    setGameOver(true)
  }

  return (
    <div className="w-full h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 flex flex-col items-center justify-center text-white">
      <div className="text-center space-y-6">
        <h1 className="text-6xl font-bold drop-shadow-lg">Bubble Burst Odyssey</h1>
        
        {!gameActive && !gameOver && (
          <div className="space-y-4">
            <p className="text-xl opacity-90">Welcome to the ultimate bubble-bursting adventure!</p>
            <button
              onClick={startGame}
              className="px-8 py-4 bg-gradient-to-r from-pink-500 to-rose-500 rounded-full text-2xl font-bold hover:shadow-2xl transform hover:scale-105 transition-all"
            >
              Start Game
            </button>
          </div>
        )}

        {gameActive && (
          <div className="space-y-4">
            <div className="text-5xl font-bold mb-8">Score: {score}</div>
            <div className="w-96 h-96 bg-blue-300 rounded-2xl flex items-center justify-center text-blue-900">
              <p className="text-2xl">Game Area</p>
            </div>
            <button
              onClick={endGame}
              className="px-6 py-3 bg-red-500 rounded-lg text-xl font-bold hover:bg-red-600 transition"
            >
              End Game
            </button>
          </div>
        )}

        {gameOver && (
          <div className="space-y-4">
            <div className="text-4xl font-bold">Final Score: {score}</div>
            <button
              onClick={startGame}
              className="px-8 py-4 bg-gradient-to-r from-pink-500 to-rose-500 rounded-full text-2xl font-bold hover:shadow-2xl transform hover:scale-105 transition-all"
            >
              Play Again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
