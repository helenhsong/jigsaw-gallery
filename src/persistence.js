export const PUZZLE_STORAGE_KEY = 'jigsaw-puzzle-progress-v1'
export const PUZZLE_COLLECTION_KEY = 'jigsaw-puzzle-collection-v2'

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

export function validPuzzleProgress(progress, difficulties, imageCount) {
  if (!progress || progress.version !== 1) return false
  const difficulty = difficulties.find((option) => option.key === progress.difficultyKey)
  if (!difficulty || !Number.isInteger(progress.imageIndex) || progress.imageIndex < 0 || progress.imageIndex >= imageCount) return false
  if (!finiteNumber(progress.artwork?.width) || progress.artwork.width <= 0 || !finiteNumber(progress.artwork?.height) || progress.artwork.height <= 0) return false
  if (!finiteNumber(progress.floorBounds?.width) || progress.floorBounds.width <= 0 || !finiteNumber(progress.floorBounds?.height) || progress.floorBounds.height <= 0) return false
  if (!Array.isArray(progress.pieces) || progress.pieces.length !== difficulty.pieces) return false
  if (!progress.positions || typeof progress.positions !== 'object') return false
  if (!Array.isArray(progress.zOrder) || progress.zOrder.length !== difficulty.pieces) return false

  const ids = new Set(progress.pieces.map((piece) => piece.id))
  if (ids.size !== difficulty.pieces || new Set(progress.zOrder).size !== difficulty.pieces || progress.zOrder.some((id) => !ids.has(id))) return false

  return progress.pieces.every((piece) => (
    Number.isInteger(piece.id)
    && typeof piece.path === 'string'
    && finiteNumber(piece.width)
    && finiteNumber(piece.height)
    && finiteNumber(piece.centerX)
    && finiteNumber(piece.centerY)
    && finiteNumber(progress.positions[piece.id]?.x)
    && finiteNumber(progress.positions[piece.id]?.y)
    && finiteNumber(progress.positions[piece.id]?.rotation)
    && Number.isInteger(progress.positions[piece.id]?.group)
  ))
}

export function loadPuzzleProgress(storage, difficulties, imageCount) {
  try {
    const progress = JSON.parse(storage.getItem(PUZZLE_STORAGE_KEY))
    return validPuzzleProgress(progress, difficulties, imageCount) ? progress : null
  } catch {
    return null
  }
}

export function savePuzzleProgress(storage, progress) {
  try {
    storage.setItem(PUZZLE_STORAGE_KEY, JSON.stringify({ version: 1, ...progress }))
    return true
  } catch {
    return false
  }
}

export function loadPuzzleCollection(storage, definitions, difficulties) {
  try {
    const collection = JSON.parse(storage.getItem(PUZZLE_COLLECTION_KEY))
    if (collection?.version === 2 && collection.puzzles && typeof collection.puzzles === 'object') {
      const puzzles = {}
      for (const definition of definitions) {
        const progress = collection.puzzles[definition.id]
        if (
          progress?.difficultyKey === definition.difficultyKey
          && validPuzzleProgress(progress, difficulties, 1)
        ) {
          puzzles[definition.id] = progress
        }
      }
      return puzzles
    }

    const legacy = loadPuzzleProgress(storage, difficulties, 1)
    const destination = legacy
      ? definitions.find((definition) => definition.difficultyKey === legacy.difficultyKey)
      : null
    return destination ? { [destination.id]: legacy } : {}
  } catch {
    return {}
  }
}

export function savePuzzleCollection(storage, puzzles) {
  try {
    storage.setItem(PUZZLE_COLLECTION_KEY, JSON.stringify({ version: 2, puzzles }))
    return true
  } catch {
    return false
  }
}
