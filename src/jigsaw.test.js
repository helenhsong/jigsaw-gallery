import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_ARTWORK, DIFFICULTIES, TABLE_HEIGHT, TABLE_WIDTH,
  angleDifference, createPieces, fitPieceCenter, groupCount, moveGroup, pieceBounds, rotateGroup, rotatePoint, scatterPieces, snapNearbyGroups,
} from './jigsaw.js'
import {
  loadPuzzleCollection, loadPuzzleProgress, PUZZLE_COLLECTION_KEY, PUZZLE_STORAGE_KEY,
  savePuzzleCollection, savePuzzleProgress,
} from './persistence.js'

function assembledPositions(pieces, rotation, connected = false) {
  return Object.fromEntries(pieces.map((piece) => {
    const offset = rotatePoint(piece.centerX - DEFAULT_ARTWORK.width / 2, piece.centerY - DEFAULT_ARTWORK.height / 2, rotation)
    return [piece.id, { x: TABLE_WIDTH / 2 + offset.x, y: TABLE_HEIGHT / 2 + offset.y, rotation, group: connected ? 0 : piece.id }]
  }))
}

function checkBounds(pieces, positions, floor = { width: TABLE_WIDTH, height: TABLE_HEIGHT }) {
  for (const piece of pieces) {
    const b = pieceBounds(piece, positions[piece.id])
    assert.ok(b.left >= -1e-7 && b.top >= -1e-7 && b.right <= floor.width + 1e-7 && b.bottom <= floor.height + 1e-7, 'Every rotated piece stays reachable on the floor')
  }
}

function checkConnectedGeometry(pieces, positions) {
  const anchor = pieces[0]
  const origin = positions[anchor.id]
  for (const piece of pieces) {
    const offset = rotatePoint(piece.centerX - anchor.centerX, piece.centerY - anchor.centerY, origin.rotation)
    assert.ok(Math.abs(positions[piece.id].x - origin.x - offset.x) < 1e-6)
    assert.ok(Math.abs(positions[piece.id].y - origin.y - offset.y) < 1e-6)
    assert.ok(Math.abs(angleDifference(origin.rotation, positions[piece.id].rotation)) < 1e-6)
  }
}

test('all difficulty levels have complementary curved edges and preserve the image proportions', () => {
  for (const difficulty of DIFFICULTIES) {
    const pieces = createPieces(difficulty)
    assert.equal(pieces.length, difficulty.pieces)
    const curves = new Map()
    for (const piece of pieces) {
      assert.ok(!/NaN|undefined|Infinity/.test(piece.path))
      assert.ok(Math.abs(piece.width * difficulty.columns - DEFAULT_ARTWORK.width) < 1e-9)
      assert.ok(Math.abs(piece.height * difficulty.rows - DEFAULT_ARTWORK.height) < 1e-9)
      let start
      for (const match of piece.path.matchAll(/([MLC])\s+([^MLCZ]+)/g)) {
        const numbers = match[2].trim().split(/\s+/).map(Number)
        if (match[1] === 'C') {
          const points = [start, numbers.slice(0, 2), numbers.slice(2, 4), numbers.slice(4)]
          const signature = (ordered) => ordered.flat().map((n) => n.toFixed(6)).join(',')
          const key = [signature(points), signature([...points].reverse())].sort()[0]
          curves.set(key, (curves.get(key) ?? 0) + 1)
        }
        start = numbers.slice(-2)
      }
    }
    for (const count of curves.values()) assert.equal(count, 2, 'Each cut is shared by exactly two neighboring pieces')
  }
})

test('scattered pieces land at varied angles and remain fully inside the floor', () => {
  for (const difficulty of DIFFICULTIES) {
    const pieces = createPieces(difficulty)
    for (let drop = 0; drop < 8; drop += 1) {
      const positions = scatterPieces(pieces)
      assert.equal(groupCount(positions), difficulty.pieces)
      assert.ok(new Set(Object.values(positions).map((p) => Math.round(p.rotation))).size > pieces.length / 2)
      checkBounds(pieces, positions)
    }
  }
})

test('piece silhouettes stay roughly the same physical size within each puzzle', () => {
  for (const difficulty of DIFFICULTIES.slice(0, 3)) {
    const pieces = createPieces(difficulty)
    const footprintAreas = pieces.map((piece) => (
      (piece.localBounds.right - piece.localBounds.left)
      * (piece.localBounds.bottom - piece.localBounds.top)
    ))
    assert.ok(Math.max(...footprintAreas) / Math.min(...footprintAreas) < 1.4)
  }
})

test('the playable puzzle grids produce square-ish pieces', () => {
  for (const difficulty of DIFFICULTIES.slice(0, 3)) {
    const [piece] = createPieces(difficulty)
    const aspectRatio = piece.width / piece.height
    assert.ok(aspectRatio > 0.82 && aspectRatio < 1.2)
  }
})

test('a puzzle seed preserves every piece shape across page refreshes', () => {
  const difficulty = DIFFICULTIES[1]
  const firstLoad = createPieces(difficulty, DEFAULT_ARTWORK, 'puzzle-03')
  const nextLoad = createPieces(difficulty, DEFAULT_ARTWORK, 'puzzle-03')
  const otherPuzzle = createPieces(difficulty, DEFAULT_ARTWORK, 'puzzle-04')

  assert.deepEqual(firstLoad, nextLoad)
  assert.notDeepEqual(firstLoad.map((piece) => piece.path), otherPuzzle.map((piece) => piece.path))
})

test('a scatter seed preserves the landing arrangement across page refreshes', () => {
  const pieces = createPieces(DIFFICULTIES[1], DEFAULT_ARTWORK, 'puzzle-03')
  const firstLoad = scatterPieces(pieces, { width: TABLE_WIDTH, height: TABLE_HEIGHT }, 'puzzle-03-initial-scatter')
  const nextLoad = scatterPieces(pieces, { width: TABLE_WIDTH, height: TABLE_HEIGHT }, 'puzzle-03-initial-scatter')
  const otherPuzzle = scatterPieces(pieces, { width: TABLE_WIDTH, height: TABLE_HEIGHT }, 'puzzle-04-initial-scatter')

  assert.deepEqual(firstLoad, nextLoad)
  assert.notDeepEqual(firstLoad, otherPuzzle)
})

test('a narrow responsive floor pushes pieces inward without scaling their geometry', () => {
  const floor = { width: 560, height: TABLE_HEIGHT }
  for (const difficulty of DIFFICULTIES) {
    const pieces = createPieces(difficulty)
    let positions = scatterPieces(pieces, floor)
    checkBounds(pieces, positions, floor)
    const pieceWidth = pieces[0].width
    positions = moveGroup(positions, pieces, positions[0].group, 5000, 0, floor)
    checkBounds(pieces, positions, floor)
    assert.equal(pieces[0].width, pieceWidth)
  }
})

test('scaled rotated pieces stay fully inside preview surfaces', () => {
  const surface = { width: 260, height: 176 }
  for (const difficulty of DIFFICULTIES.slice(0, 3)) {
    const [piece] = createPieces(difficulty)
    const scale = Math.max(0.1, Math.min(0.5, 21 / Math.sqrt(piece.width * piece.height)))
    for (const rotation of [-165, -70, 0, 48, 137]) {
      for (const candidate of [{ x: -100, y: -100 }, { x: 400, y: 300 }]) {
        const center = fitPieceCenter(piece, rotation, candidate, surface, scale, 2)
        const bounds = pieceBounds(piece, { x: 0, y: 0, rotation })
        assert.ok(center.x + bounds.left * scale >= 2 - 1e-7)
        assert.ok(center.y + bounds.top * scale >= 2 - 1e-7)
        assert.ok(center.x + bounds.right * scale <= surface.width - 2 + 1e-7)
        assert.ok(center.y + bounds.bottom * scale <= surface.height - 2 + 1e-7)
      }
    }
  }
})

test('matching edges connect at arbitrary angles at every difficulty', () => {
  for (const difficulty of DIFFICULTIES) {
    const pieces = createPieces(difficulty)
    for (const rotation of [-175, -45, 0, 37, 95, 179]) {
      const source = assembledPositions(pieces, rotation)
      const result = snapNearbyGroups(source, pieces, difficulty, 0)
      assert.equal(result.joins, difficulty.pieces - 1)
      assert.equal(groupCount(result.positions), 1)
      assert.equal(groupCount(source), difficulty.pieces, 'Snapping does not mutate source positions')
      checkConnectedGeometry(pieces, result.positions)
      checkBounds(pieces, result.positions)
    }
  }
})

test('rotating and moving a completed group preserves every connection at the floor edges', () => {
  const pieces = createPieces(DIFFICULTIES[1])
  let positions = assembledPositions(pieces, 0, true)
  for (let turn = 0; turn < 12; turn += 1) {
    positions = rotateGroup(positions, pieces, 0, 30)
    positions = moveGroup(positions, pieces, 0, turn % 2 ? 5000 : -5000, turn % 3 ? 5000 : -5000)
    checkConnectedGeometry(pieces, positions)
    checkBounds(pieces, positions)
  }
})

test('nearby pieces need compatible angles and receive gentle rotational snap assistance', () => {
  const difficulty = DIFFICULTIES[1]
  const pieces = createPieces(difficulty)
  const positions = assembledPositions(pieces, 42, true)
  positions[0] = { ...positions[0], x: positions[0].x + 5, y: positions[0].y + 3, rotation: 12, group: 10 }
  assert.equal(snapNearbyGroups(positions, pieces, difficulty, 10).joins, 0)
  positions[0].rotation = 30
  const result = snapNearbyGroups(positions, pieces, difficulty, 10)
  assert.equal(result.joins, 1)
  checkConnectedGeometry(pieces, result.positions)
})

test('puzzle progress survives a storage round trip and invalid data is ignored', () => {
  const values = new Map()
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  const difficulty = DIFFICULTIES[1]
  const pieces = createPieces(difficulty)
  const progress = {
    difficultyKey: difficulty.key,
    imageIndex: 0,
    artwork: DEFAULT_ARTWORK,
    floorBounds: { width: TABLE_WIDTH, height: TABLE_HEIGHT },
    pieces,
    positions: scatterPieces(pieces),
    zOrder: pieces.map((piece) => piece.id),
  }

  assert.equal(savePuzzleProgress(storage, progress), true)
  const serializedProgress = JSON.parse(JSON.stringify({ version: 1, ...progress }))
  assert.deepEqual(loadPuzzleProgress(storage, DIFFICULTIES, 1), serializedProgress)

  values.set(PUZZLE_STORAGE_KEY, '{broken json')
  assert.equal(loadPuzzleProgress(storage, DIFFICULTIES, 1), null)
})

test('six fixed puzzles keep separate saved progress', () => {
  const values = new Map()
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  const definitions = [
    { id: 'puzzle-01', difficultyKey: 'easy' },
    { id: 'puzzle-02', difficultyKey: 'easy' },
    { id: 'puzzle-03', difficultyKey: 'medium' },
    { id: 'puzzle-04', difficultyKey: 'medium' },
    { id: 'puzzle-05', difficultyKey: 'hard' },
    { id: 'puzzle-06', difficultyKey: 'hard' },
  ]
  const puzzles = Object.fromEntries(definitions.slice(0, 2).map((definition) => {
    const difficulty = DIFFICULTIES.find((option) => option.key === definition.difficultyKey)
    const pieces = createPieces(difficulty)
    return [definition.id, {
      version: 1,
      difficultyKey: definition.difficultyKey,
      imageIndex: 0,
      artwork: DEFAULT_ARTWORK,
      floorBounds: { width: TABLE_WIDTH, height: TABLE_HEIGHT },
      pieces,
      positions: scatterPieces(pieces),
      zOrder: pieces.map((piece) => piece.id),
    }]
  }))

  assert.equal(savePuzzleCollection(storage, puzzles), true)
  assert.deepEqual(
    loadPuzzleCollection(storage, definitions, DIFFICULTIES),
    JSON.parse(JSON.stringify(puzzles)),
  )
  values.set(PUZZLE_COLLECTION_KEY, '{broken json')
  assert.deepEqual(loadPuzzleCollection(storage, definitions, DIFFICULTIES), {})
})
