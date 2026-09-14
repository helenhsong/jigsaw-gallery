import { useEffect, useRef, useState } from 'react'
import { Button, ProjectHeader } from '@helenhsong/ui'
import '@helenhsong/ui/style.css'
import readme from '../README.md?raw'
import {
  DEFAULT_ARTWORK, DIFFICULTIES, TABLE_HEIGHT, TABLE_WIDTH,
  createPieces, groupCount, moveGroup, rotateGroup, scatterPieces, snapNearbyGroups,
} from './jigsaw'
import { loadPuzzleCollection, savePuzzleCollection } from './persistence'

const PUZZLE_IMAGE = import.meta.env.BASE_URL + 'puzzles/01.jpeg'
const MIN_FLOOR_WIDTH = 560
const PIECE_GEOMETRY_VERSION = 11
const SCATTER_VERSION = 2
const INSTRUCTIONS = 'Drag to move · Double-click or press R to rotate'
const PLACEHOLDER_ARTWORK = {
  title: 'Untitled (Orange Glasses)',
  artist: 'Artist unknown',
  year: 'Undated',
  medium: 'Digital image',
}
const PUZZLES = [
  { id: 'puzzle-01', number: '01', level: 'Easy', difficultyKey: 'easy', imageUrl: PUZZLE_IMAGE, surfaceColor: '#ded2c4', artwork: PLACEHOLDER_ARTWORK },
  { id: 'puzzle-02', number: '02', level: 'Easy', difficultyKey: 'easy', imageUrl: PUZZLE_IMAGE, surfaceColor: '#ded2c4', artwork: PLACEHOLDER_ARTWORK },
  { id: 'puzzle-03', number: '03', level: 'Medium', difficultyKey: 'medium', imageUrl: PUZZLE_IMAGE, surfaceColor: '#ded2c4', artwork: PLACEHOLDER_ARTWORK },
  { id: 'puzzle-04', number: '04', level: 'Medium', difficultyKey: 'medium', imageUrl: PUZZLE_IMAGE, surfaceColor: '#ded2c4', artwork: PLACEHOLDER_ARTWORK },
  { id: 'puzzle-05', number: '05', level: 'Hard', difficultyKey: 'hard', imageUrl: PUZZLE_IMAGE, surfaceColor: '#ded2c4', artwork: PLACEHOLDER_ARTWORK },
  { id: 'puzzle-06', number: '06', level: 'Hard', difficultyKey: 'hard', imageUrl: PUZZLE_IMAGE, surfaceColor: '#ded2c4', artwork: PLACEHOLDER_ARTWORK },
]
function freshPuzzle(puzzle, floorBounds = { width: TABLE_WIDTH, height: TABLE_HEIGHT }) {
  const difficulty = DIFFICULTIES.find((option) => option.key === puzzle.difficultyKey)
  const pieces = createPieces(difficulty, DEFAULT_ARTWORK, puzzle.id)
  return {
    version: 1,
    pieceGeometryVersion: PIECE_GEOMETRY_VERSION,
    scatterVersion: SCATTER_VERSION,
    difficultyKey: puzzle.difficultyKey,
    imageIndex: 0,
    artwork: DEFAULT_ARTWORK,
    floorBounds,
    pieces,
    positions: scatterPieces(pieces, floorBounds, `${puzzle.id}-initial-scatter`),
    zOrder: pieces.map((piece) => piece.id),
  }
}

function keepGroupsInsideFloor(positions, pieces, floorBounds) {
  let bounded = positions
  for (const group of new Set(Object.values(positions).map((position) => position.group))) {
    bounded = moveGroup(bounded, pieces, group, 0, 0, floorBounds)
  }
  return bounded
}

function readSavedPuzzles() {
  try {
    const saved = loadPuzzleCollection(window.localStorage, PUZZLES, DIFFICULTIES)
    return Object.fromEntries(Object.entries(saved).map(([puzzleId, progress]) => {
      const difficulty = DIFFICULTIES.find((option) => option.key === progress.difficultyKey)
      const upgradedPieces = progress.pieceGeometryVersion === PIECE_GEOMETRY_VERSION
        ? progress.pieces
        : createPieces(difficulty, progress.artwork, puzzleId)
      const shouldRefreshScatter = progress.scatterVersion !== SCATTER_VERSION
        && groupCount(progress.positions) === progress.pieces.length
      const migratedPositions = shouldRefreshScatter
        ? scatterPieces(upgradedPieces, progress.floorBounds, `${puzzleId}-initial-scatter`)
        : progress.positions
      return [puzzleId, {
        ...progress,
        pieceGeometryVersion: PIECE_GEOMETRY_VERSION,
        scatterVersion: SCATTER_VERSION,
        pieces: upgradedPieces,
        positions: keepGroupsInsideFloor(migratedPositions, upgradedPieces, progress.floorBounds),
      }]
    }))
  } catch {
    return {}
  }
}

function isComplete(progress) {
  return Boolean(progress?.positions) && groupCount(progress.positions) === 1
}

function impactStyle(pieceId) {
  const y = ((pieceId * 7) % 9 - 4) * 0.65
  const twist = ((pieceId * 5) % 7 - 3) * 0.35
  return {
    '--impact-y-1': `${y}px`,
    '--impact-y-2': `${-y * 0.7}px`,
    '--impact-y-3': `${y * 0.22}px`,
    '--impact-rotate-1': `${twist}deg`,
    '--impact-rotate-2': `${-twist * 0.65}deg`,
    '--impact-rotate-3': `${twist * 0.2}deg`,
    '--impact-delay': `${pieceId % 6 * 9}ms`,
    '--impact-duration': `${520 + pieceId % 5 * 18}ms`,
  }
}

const STORED_PUZZLES = readSavedPuzzles()
const INITIAL_PUZZLES = Object.fromEntries(PUZZLES.map((puzzle) => [
  puzzle.id,
  STORED_PUZZLES[puzzle.id] ?? freshPuzzle(puzzle),
]))
const BOOTSTRAP_PUZZLE = PUZZLES[0]
const BOOTSTRAP_PROGRESS = INITIAL_PUZZLES[BOOTSTRAP_PUZZLE.id]

function renderStaticPuzzleCanvas(puzzle, progress) {
  const artworkPatternId = `puzzle-artwork-${puzzle.id}`
  const grainFilterId = `paper-grain-${puzzle.id}`
  const fibersPatternId = `paper-fibers-${puzzle.id}`
  const sheenGradientId = `piece-sheen-${puzzle.id}`

  return (
    <svg
      className={`puzzle-floor${isComplete(progress) ? ' is-complete' : ''}`}
      viewBox={`0 0 ${progress.floorBounds.width} ${progress.floorBounds.height}`}
      aria-hidden="true"
    >
      <defs>
        <pattern id={artworkPatternId} width={progress.artwork.width} height={progress.artwork.height} patternUnits="userSpaceOnUse">
          <image href={puzzle.imageUrl} width={progress.artwork.width} height={progress.artwork.height} preserveAspectRatio="none" />
        </pattern>
        <filter id={grainFilterId} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="3" seed="12" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <pattern id={fibersPatternId} width="150" height="150" patternUnits="userSpaceOnUse">
          <rect width="150" height="150" filter={`url(#${grainFilterId})`} opacity="0.22" />
        </pattern>
        <linearGradient id={sheenGradientId} x1="0" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.13" />
          <stop offset="0.48" stopColor="#ffffff" stopOpacity="0.01" />
          <stop offset="1" stopColor="#161616" stopOpacity="0.075" />
        </linearGradient>
      </defs>

      {progress.zOrder.map((pieceId) => {
        const piece = progress.pieces[pieceId]
        const position = progress.positions[pieceId]
        return (
          <g key={piece.id} transform={`translate(${position.x} ${position.y})`}>
            <g className="piece-impact" style={impactStyle(piece.id)}>
              <g className="piece-shadow">
                <g transform={`rotate(${position.rotation}) translate(${-piece.centerX} ${-piece.centerY})`}>
                  <path className="piece-backing" d={piece.path} transform="translate(0 1.7)" />
                  <path
                    className="puzzle-piece is-static"
                    d={piece.path}
                    fill={`url(#${artworkPatternId})`}
                    stroke="rgba(255,255,255,0.52)"
                    strokeWidth="0.8"
                    strokeLinejoin="round"
                  />
                  <path className="piece-texture" d={piece.path} fill={`url(#${fibersPatternId})`} />
                  <path className="piece-sheen" d={piece.path} fill={`url(#${sheenGradientId})`} />
                </g>
              </g>
            </g>
          </g>
        )
      })}
    </svg>
  )
}

function PuzzleTile({ puzzle, progress, isInteractive, canvas, impact, toolbar, onOpen }) {
  const complete = isComplete(progress)
  const pieces = progress.pieces
  const connectionsMade = pieces.length - groupCount(progress.positions)
  const progressPercent = complete
    ? 100
    : Math.round(connectionsMade / Math.max(1, pieces.length - 1) * 100)

  function openPuzzle() {
    onOpen(puzzle)
  }

  return (
    <div
      className={`puzzle-tile${complete ? ' is-complete' : ''}${isInteractive ? ' is-interactive' : ''}${impact ? ` is-impacting impact-${impact.direction > 0 ? 'forward' : 'back'} impact-${impact.token % 2 ? 'a' : 'b'}` : ''}`}
      role={isInteractive ? undefined : 'button'}
      tabIndex={isInteractive ? undefined : '0'}
      aria-label={isInteractive
        ? undefined
        : complete
          ? `Open ${puzzle.artwork.title}, puzzle ${puzzle.number}, ${puzzle.level}, assembled`
          : `Open puzzle ${puzzle.number}, ${puzzle.level}, ${progressPercent}% assembled`}
      onKeyDown={isInteractive ? undefined : (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          openPuzzle()
        }
      }}
    >
      <div className="puzzle-presentation">
        <div className="puzzle-toolbar-slot">
          {toolbar}
        </div>
        <span
          className="puzzle-object"
          aria-hidden={isInteractive ? undefined : 'true'}
          onClick={isInteractive ? undefined : openPuzzle}
        >
          <span className={`puzzle-preview${complete ? ' is-complete' : ''}${isInteractive ? ' is-interactive' : ''}`}>
            <span className="puzzle-preview-surface" style={{ '--puzzle-surface': puzzle.surfaceColor }}>
              {isInteractive ? canvas : renderStaticPuzzleCanvas(puzzle, progress)}
            </span>
          </span>
        </span>
        <div className={`art-info-card${complete ? ' is-artwork' : ' is-progress'}`}>
          <p className="art-info-artist">{puzzle.artwork.artist}</p>
          <p className="art-info-title"><cite>{puzzle.artwork.title}</cite>, {puzzle.artwork.year}</p>
        </div>
      </div>
    </div>
  )
}

function RestartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4v6h6" />
      <path d="M4.7 15a8 8 0 1 0 .3-6.4L4 10" />
    </svg>
  )
}

function RotateLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7v5h5" />
      <path d="M5.1 16.5a8 8 0 1 0 .7-10.3L3 9" />
    </svg>
  )
}

function RotateRightIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 7v5h-5" />
      <path d="M18.9 16.5a8 8 0 1 1-.7-10.3L21 9" />
    </svg>
  )
}

function PuzzleTool({ shortcut, label, disabled = false, onClick, children }) {
  return (
    <span className="puzzle-tool-control">
      <Button
        className="puzzle-tool-button"
        variant="outline"
        size="icon"
        type="button"
        aria-label={`${label}. Keyboard shortcut ${shortcut}.`}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </Button>
      <span className="puzzle-tool-tooltip" role="tooltip">
        <kbd>{shortcut}</kbd>
        <span>{label}</span>
      </span>
    </span>
  )
}

function PuzzleToolbar({ hasSelection, onRestart, onRotate }) {
  return (
    <div className="puzzle-toolbar" role="toolbar" aria-label="Puzzle controls">
      <PuzzleTool shortcut="C" label="Restart puzzle" onClick={onRestart}>
        <RestartIcon />
      </PuzzleTool>
      <PuzzleTool
        shortcut="L"
        label="Rotate selected piece left"
        disabled={!hasSelection}
        onClick={() => onRotate(-1)}
      >
        <RotateLeftIcon />
      </PuzzleTool>
      <PuzzleTool
        shortcut="R"
        label="Rotate selected piece right"
        disabled={!hasSelection}
        onClick={() => onRotate(1)}
      >
        <RotateRightIcon />
      </PuzzleTool>
    </div>
  )
}

function App() {
  const tableRef = useRef(null)
  const collectionRef = useRef(null)
  const galleryWheelRef = useRef({ frame: null, target: 0 })
  const galleryNavigationRef = useRef(null)
  const navigationImpactIdRef = useRef(0)
  const dragRef = useRef(null)
  const tapRef = useRef(null)
  const pointerTypeRef = useRef(null)
  const savedPuzzlesRef = useRef(INITIAL_PUZZLES)
  const floorBoundsRef = useRef(BOOTSTRAP_PROGRESS.floorBounds)
  const positionsRef = useRef(BOOTSTRAP_PROGRESS.positions)
  const activePuzzleIdRef = useRef(BOOTSTRAP_PUZZLE.id)
  const [activePuzzleId, setActivePuzzleId] = useState(BOOTSTRAP_PUZZLE.id)
  const [savedPuzzles, setSavedPuzzles] = useState(INITIAL_PUZZLES)
  const [artwork, setArtwork] = useState(BOOTSTRAP_PROGRESS.artwork)
  const [floorBounds, setFloorBounds] = useState(BOOTSTRAP_PROGRESS.floorBounds)
  const [pieces, setPieces] = useState(BOOTSTRAP_PROGRESS.pieces)
  const [positions, setPositions] = useState(BOOTSTRAP_PROGRESS.positions)
  const [zOrder, setZOrder] = useState(BOOTSTRAP_PROGRESS.zOrder)
  const [selectedPieceId, setSelectedPieceId] = useState(null)
  const [draggingGroup, setDraggingGroup] = useState(null)
  const [navigationImpact, setNavigationImpact] = useState(null)
  const [feedback, setFeedback] = useState(
    isComplete(BOOTSTRAP_PROGRESS) ? 'All together. Nicely done.' : INSTRUCTIONS,
  )
  const [imageError, setImageError] = useState(false)

  useEffect(() => {
    const gallery = collectionRef.current
    if (!gallery) return undefined

    const wheelState = galleryWheelRef.current
    wheelState.target = gallery.scrollLeft

    const animateWheel = () => {
      const distance = wheelState.target - gallery.scrollLeft
      if (Math.abs(distance) < 0.35) {
        gallery.scrollLeft = wheelState.target
        wheelState.frame = null
        return
      }
      gallery.scrollLeft += distance * 0.28
      wheelState.frame = window.requestAnimationFrame(animateWheel)
    }

    const scrollGallery = (event) => {
      if (document.documentElement.hasAttribute('data-ph-open') || event.ctrlKey) return
      const maximumScroll = Math.max(0, gallery.scrollWidth - gallery.clientWidth)
      if (maximumScroll === 0) return

      const dominantDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX
        : event.deltaY
      if (dominantDelta === 0) return

      event.preventDefault()
      galleryNavigationRef.current = null
      const multiplier = event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? window.innerHeight
          : 1
      if (wheelState.frame === null) wheelState.target = gallery.scrollLeft
      wheelState.target = Math.max(
        0,
        Math.min(maximumScroll, wheelState.target + dominantDelta * multiplier),
      )
      if (wheelState.frame === null) {
        wheelState.frame = window.requestAnimationFrame(animateWheel)
      }
    }

    const cancelProgrammaticNavigation = () => {
      galleryNavigationRef.current = null
    }

    let resizeFrame = null
    const centerActivePuzzle = () => {
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame)
      const activeIndex = PUZZLES.findIndex((puzzle) => puzzle.id === activePuzzleIdRef.current)
      resizeFrame = window.requestAnimationFrame(() => {
        const tile = gallery.children[activeIndex]
        const maximumScroll = Math.max(0, gallery.scrollWidth - gallery.clientWidth)
        const left = tile
          ? tile.offsetLeft - (gallery.clientWidth - tile.offsetWidth) / 2
          : gallery.scrollLeft
        const boundedLeft = Math.max(0, Math.min(maximumScroll, left))
        gallery.scrollLeft = boundedLeft
        wheelState.target = boundedLeft
        resizeFrame = null
      })
    }

    window.addEventListener('wheel', scrollGallery, { passive: false })
    window.addEventListener('resize', centerActivePuzzle)
    gallery.addEventListener('pointerdown', cancelProgrammaticNavigation)

    return () => {
      window.removeEventListener('wheel', scrollGallery)
      window.removeEventListener('resize', centerActivePuzzle)
      gallery.removeEventListener('pointerdown', cancelProgrammaticNavigation)
      if (wheelState.frame !== null) window.cancelAnimationFrame(wheelState.frame)
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame)
      wheelState.frame = null
    }
  }, [])

  const activePuzzle = PUZZLES.find((puzzle) => puzzle.id === activePuzzleId)
  const difficulty = DIFFICULTIES.find((option) => option.key === activePuzzle.difficultyKey)
  const remainingGroups = groupCount(positions)
  const complete = remainingGroups === 1
  const selectedGroup = selectedPieceId === null ? null : positions[selectedPieceId]?.group

  function showPuzzleOnCanvas(index) {
    const puzzle = PUZZLES[index]
    if (!puzzle) return
    if (puzzle.id !== activePuzzleIdRef.current) openPuzzle(puzzle)
  }

  function syncPuzzleToScroll(event) {
    const gallery = event.currentTarget
    const programmedNavigation = galleryNavigationRef.current
    if (programmedNavigation) {
      if (Math.abs(gallery.scrollLeft - programmedNavigation.left) <= 1) {
        galleryNavigationRef.current = null
      }
      return
    }
    const maximumScroll = gallery.scrollWidth - gallery.clientWidth
    if (gallery.scrollLeft <= 1) {
      showPuzzleOnCanvas(0)
      return
    }
    if (gallery.scrollLeft >= maximumScroll - 1) {
      showPuzzleOnCanvas(PUZZLES.length - 1)
      return
    }
    const galleryCenter = gallery.scrollLeft + gallery.clientWidth / 2
    let closestIndex = 0
    let closestDistance = Number.POSITIVE_INFINITY
    for (const [index, tile] of [...gallery.children].entries()) {
      const tileCenter = tile.offsetLeft + tile.offsetWidth / 2
      const distance = Math.abs(tileCenter - galleryCenter)
      if (distance < closestDistance) {
        closestDistance = distance
        closestIndex = index
      }
    }
    showPuzzleOnCanvas(closestIndex)
  }

  function showPuzzleInGallery(index) {
    const gallery = collectionRef.current
    const tile = gallery?.children[index]
    if (!gallery || !tile) return
    const maximumScroll = gallery.scrollWidth - gallery.clientWidth
    const left = tile.offsetLeft - (gallery.clientWidth - tile.offsetWidth) / 2
    const boundedLeft = Math.max(0, Math.min(maximumScroll, left))
    galleryWheelRef.current.target = boundedLeft
    galleryNavigationRef.current = { index, left: boundedLeft }
    gallery.scrollTo({
      left: boundedLeft,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
    showPuzzleOnCanvas(index)
  }

  function navigateGallery(direction) {
    const currentIndex = PUZZLES.findIndex((puzzle) => puzzle.id === activePuzzleIdRef.current)
    const nextIndex = Math.max(0, Math.min(PUZZLES.length - 1, currentIndex + direction))
    if (nextIndex === currentIndex) return
    navigationImpactIdRef.current += 1
    setNavigationImpact({
      token: navigationImpactIdRef.current,
      direction,
      puzzleIds: [PUZZLES[currentIndex].id, PUZZLES[nextIndex].id],
    })
    showPuzzleInGallery(nextIndex)
  }

  function commitPositions(nextPositions) {
    positionsRef.current = nextPositions
    setPositions(nextPositions)
  }

  function currentProgress() {
    return {
      version: 1,
      pieceGeometryVersion: PIECE_GEOMETRY_VERSION,
      scatterVersion: SCATTER_VERSION,
      difficultyKey: activePuzzle?.difficultyKey ?? difficulty.key,
      imageIndex: 0,
      artwork,
      floorBounds: floorBoundsRef.current,
      pieces,
      positions: positionsRef.current,
      zOrder,
    }
  }

  function storePuzzle(puzzleId, progress = currentProgress()) {
    if (!puzzleId) return
    const nextPuzzles = { ...savedPuzzlesRef.current, [puzzleId]: progress }
    savedPuzzlesRef.current = nextPuzzles
    setSavedPuzzles(nextPuzzles)
    try {
      savePuzzleCollection(window.localStorage, nextPuzzles)
    } catch {
      // The collection remains playable when a browser blocks local storage.
    }
  }

  function openPuzzle(puzzle) {
    const currentPuzzleId = activePuzzleIdRef.current
    if (currentPuzzleId !== puzzle.id) storePuzzle(currentPuzzleId)
    const progress = savedPuzzlesRef.current[puzzle.id] ?? freshPuzzle(puzzle, floorBoundsRef.current)
    floorBoundsRef.current = progress.floorBounds
    positionsRef.current = progress.positions
    setArtwork(progress.artwork)
    setFloorBounds(progress.floorBounds)
    setPieces(progress.pieces)
    setPositions(progress.positions)
    setZOrder(progress.zOrder)
    setSelectedPieceId(null)
    setDraggingGroup(null)
    setImageError(false)
    setFeedback(isComplete(progress) ? 'All together. Nicely done.' : INSTRUCTIONS)
    activePuzzleIdRef.current = puzzle.id
    setActivePuzzleId(puzzle.id)
  }

  function restartPuzzle() {
    if (!activePuzzle) return
    const progress = freshPuzzle(activePuzzle, floorBoundsRef.current)
    floorBoundsRef.current = progress.floorBounds
    positionsRef.current = progress.positions
    setArtwork(progress.artwork)
    setFloorBounds(progress.floorBounds)
    setPieces(progress.pieces)
    setPositions(progress.positions)
    setZOrder(progress.zOrder)
    setSelectedPieceId(null)
    setDraggingGroup(null)
    setFeedback(INSTRUCTIONS)
    storePuzzle(activePuzzle.id, progress)
  }

  useEffect(() => {
    const puzzle = PUZZLES.find((option) => option.id === activePuzzleId)
    if (!puzzle) return undefined
    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (!cancelled) setImageError(false)
    }
    image.onerror = () => {
      if (!cancelled) {
        setImageError(true)
        setFeedback('The puzzle image could not be loaded. Try restarting.')
      }
    }
    image.src = puzzle.imageUrl
    return () => { cancelled = true }
  }, [activePuzzleId])

  useEffect(() => {
    if (!activePuzzleId) return undefined
    const floor = tableRef.current
    if (!floor || typeof ResizeObserver === 'undefined') return undefined

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width < 1 || height < 1) return
      const previousBounds = floorBoundsRef.current
      const nextBounds = {
        width: Math.max(MIN_FLOOR_WIDTH, TABLE_HEIGHT * width / height),
        height: TABLE_HEIGHT,
      }
      if (Math.abs(nextBounds.width - previousBounds.width) < 1) return

      const centerShift = (nextBounds.width - previousBounds.width) / 2
      let nextPositions = Object.fromEntries(
        Object.entries(positionsRef.current).map(([id, position]) => [
          id,
          { ...position, x: position.x + centerShift },
        ]),
      )
      for (const group of new Set(Object.values(nextPositions).map((position) => position.group))) {
        nextPositions = moveGroup(nextPositions, pieces, group, 0, 0, nextBounds)
      }
      floorBoundsRef.current = nextBounds
      setFloorBounds(nextBounds)
      commitPositions(nextPositions)
    })

    observer.observe(floor)
    return () => observer.disconnect()
  }, [activePuzzleId, pieces])

  useEffect(() => {
    if (!activePuzzleId) return undefined
    const timer = window.setTimeout(() => storePuzzle(activePuzzleId), 180)
    return () => window.clearTimeout(timer)
  }, [activePuzzleId, artwork, floorBounds, pieces, positions, zOrder])

  function tablePoint(event) {
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(
      tableRef.current.getScreenCTM().inverse(),
    )
  }

  function bringGroupToFront(group) {
    setZOrder((current) => [
      ...current.filter((id) => positionsRef.current[id].group !== group),
      ...current.filter((id) => positionsRef.current[id].group === group),
    ])
  }

  function finishGroupMove(group) {
    const snapped = snapNearbyGroups(
      positionsRef.current,
      pieces,
      difficulty,
      group,
      floorBoundsRef.current,
    )
    commitPositions(snapped.positions)
    bringGroupToFront(snapped.activeGroup)
    const count = groupCount(snapped.positions)
    setFeedback(count === 1 ? 'All together. Nicely done.' : snapped.joins ? 'A perfect fit.' : INSTRUCTIONS)
    storePuzzle(activePuzzleId, { ...currentProgress(), positions: snapped.positions })
  }

  function turnPiece(pieceId, direction = 1) {
    if (dragRef.current || pieceId === null) return
    const group = positionsRef.current[pieceId].group
    setSelectedPieceId(pieceId)
    commitPositions(
      rotateGroup(
        positionsRef.current,
        pieces,
        group,
        30 * direction,
        undefined,
        floorBoundsRef.current,
      ),
    )
    finishGroupMove(group)
  }

  function startPieceDrag(event, pieceId) {
    if (dragRef.current || event.button !== 0) return
    event.preventDefault()
    pointerTypeRef.current = event.pointerType
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    const group = positionsRef.current[pieceId].group
    dragRef.current = {
      pointerId: event.pointerId,
      pieceId,
      group,
      start: tablePoint(event),
      originals: positionsRef.current,
      moved: false,
    }
    setSelectedPieceId(pieceId)
    setDraggingGroup(group)
    bringGroupToFront(group)
  }

  function movePieceDrag(event) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const point = tablePoint(event)
    const dx = point.x - drag.start.x
    const dy = point.y - drag.start.y
    if (Math.hypot(dx, dy) > 4) drag.moved = true
    commitPositions(
      moveGroup(drag.originals, pieces, drag.group, dx, dy, floorBoundsRef.current),
    )
  }

  function endPieceDrag(event) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setDraggingGroup(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (drag.moved) finishGroupMove(drag.group)
    if (event.pointerType === 'touch' && !drag.moved) {
      const now = event.timeStamp
      if (tapRef.current?.pieceId === drag.pieceId && now - tapRef.current.time < 320) {
        turnPiece(drag.pieceId)
        tapRef.current = null
      } else {
        tapRef.current = { pieceId: drag.pieceId, time: now }
      }
    }
  }

  function cancelPieceDrag(event) {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    setDraggingGroup(null)
  }

  function handlePieceKey(event, pieceId) {
    if (event.key.toLowerCase() === 'r' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      turnPiece(pieceId, event.shiftKey ? -1 : 1)
      return
    }
    const direction = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key]
    if (!direction) return
    event.preventDefault()
    const group = positionsRef.current[pieceId].group
    const distance = event.shiftKey ? 12 : 4
    setSelectedPieceId(pieceId)
    commitPositions(
      moveGroup(
        positionsRef.current,
        pieces,
        group,
        direction[0] * distance,
        direction[1] * distance,
        floorBoundsRef.current,
      ),
    )
    finishGroupMove(group)
  }

  useEffect(() => {
    const handleGalleryShortcut = (event) => {
      if (
        event.defaultPrevented
        || event.metaKey
        || event.ctrlKey
        || event.altKey
        || document.documentElement.hasAttribute('data-ph-open')
      ) return

      const target = event.target
      if (
        target instanceof HTMLElement
        && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      ) return

      const key = event.key.toLowerCase()
      if (key === 'c') {
        event.preventDefault()
        restartPuzzle()
      } else if (key === 'l' && selectedPieceId !== null) {
        event.preventDefault()
        turnPiece(selectedPieceId, -1)
      } else if (key === 'r' && selectedPieceId !== null) {
        event.preventDefault()
        turnPiece(selectedPieceId, 1)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        navigateGallery(-1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        navigateGallery(1)
      }
    }

    window.addEventListener('keydown', handleGalleryShortcut)
    return () => window.removeEventListener('keydown', handleGalleryShortcut)
  })

  function renderPuzzleCanvas() {
    const artworkPatternId = `puzzle-artwork-${activePuzzle.id}`
    const grainFilterId = `paper-grain-${activePuzzle.id}`
    const fibersPatternId = `paper-fibers-${activePuzzle.id}`
    const sheenGradientId = `piece-sheen-${activePuzzle.id}`

    return (
      <svg
        ref={tableRef}
        className={`puzzle-floor inline-puzzle-floor${complete ? ' is-complete' : ''}`}
        viewBox={`0 0 ${floorBounds.width} ${floorBounds.height}`}
        aria-label={`${activePuzzle.level} puzzle canvas with ${pieces.length} pieces`}
        aria-describedby="puzzle-help"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) setSelectedPieceId(null)
        }}
      >
        <defs>
          <pattern id={artworkPatternId} width={artwork.width} height={artwork.height} patternUnits="userSpaceOnUse">
            <image href={activePuzzle.imageUrl} width={artwork.width} height={artwork.height} preserveAspectRatio="none" />
          </pattern>
          <filter id={grainFilterId} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="3" seed="12" stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <pattern id={fibersPatternId} width="150" height="150" patternUnits="userSpaceOnUse">
            <rect width="150" height="150" filter={`url(#${grainFilterId})`} opacity="0.22" />
          </pattern>
          <linearGradient id={sheenGradientId} x1="0" y1="0" x2="0.8" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.13" />
            <stop offset="0.48" stopColor="#ffffff" stopOpacity="0.01" />
            <stop offset="1" stopColor="#161616" stopOpacity="0.075" />
          </linearGradient>
        </defs>

        {zOrder.map((pieceId) => {
          const piece = pieces[pieceId]
          const position = positions[pieceId]
          return (
            <g key={piece.id} transform={`translate(${position.x} ${position.y})`}>
              <g className="piece-impact" style={impactStyle(piece.id)}>
                <g className={`piece-shadow${position.group === draggingGroup ? ' is-lifted' : ''}`}>
                  <g transform={`rotate(${position.rotation}) translate(${-piece.centerX} ${-piece.centerY})`}>
                    <path className="piece-backing" d={piece.path} transform="translate(0 1.7)" />
                    <path
                      className={`puzzle-piece${position.group === draggingGroup ? ' is-dragging' : ''}${position.group === selectedGroup ? ' is-selected' : ''}`}
                      d={piece.path}
                      fill={`url(#${artworkPatternId})`}
                      stroke="rgba(255,255,255,0.52)"
                      strokeWidth="0.8"
                      strokeLinejoin="round"
                      role="button"
                      tabIndex="0"
                      aria-label={`Puzzle piece ${piece.id + 1}. Drag or use arrows to move. Double-click or press R to rotate.`}
                      aria-pressed={position.group === selectedGroup}
                      onPointerDown={(event) => startPieceDrag(event, piece.id)}
                      onPointerMove={movePieceDrag}
                      onPointerUp={endPieceDrag}
                      onPointerCancel={cancelPieceDrag}
                      onLostPointerCapture={cancelPieceDrag}
                      onDoubleClick={() => {
                        if (pointerTypeRef.current !== 'touch') turnPiece(piece.id)
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        turnPiece(piece.id, -1)
                      }}
                      onKeyDown={(event) => handlePieceKey(event, piece.id)}
                    />
                    <path className="piece-texture" d={piece.path} fill={`url(#${fibersPatternId})`} />
                    <path className="piece-sheen" d={piece.path} fill={`url(#${sheenGradientId})`} />
                  </g>
                </g>
              </g>
            </g>
          )
        })}
      </svg>
    )
  }

  const activeProgress = {
    version: 1,
    pieceGeometryVersion: PIECE_GEOMETRY_VERSION,
    scatterVersion: SCATTER_VERSION,
    difficultyKey: activePuzzle?.difficultyKey ?? difficulty.key,
    imageIndex: 0,
    artwork,
    floorBounds,
    pieces,
    positions,
    zOrder,
  }

  return (
    <div className="site-shell">
      <ProjectHeader readme={readme} />
      <main className="puzzle-app">
        <section className="collection-screen" aria-label="Puzzle gallery">
          <div className="collection-grid" ref={collectionRef} onScroll={syncPuzzleToScroll}>
            {PUZZLES.map((puzzle) => {
              const isInteractive = puzzle.id === activePuzzleId
              return (
                <PuzzleTile
                  key={puzzle.id}
                  puzzle={puzzle}
                  progress={isInteractive ? activeProgress : savedPuzzles[puzzle.id]}
                  isInteractive={isInteractive}
                  canvas={isInteractive ? renderPuzzleCanvas() : null}
                  impact={navigationImpact?.puzzleIds.includes(puzzle.id) ? navigationImpact : null}
                  toolbar={isInteractive ? (
                    <PuzzleToolbar
                      hasSelection={selectedPieceId !== null}
                      onRestart={restartPuzzle}
                      onRotate={(direction) => turnPiece(selectedPieceId, direction)}
                    />
                  ) : null}
                  onOpen={openPuzzle}
                />
              )
            })}
          </div>
        </section>
        <span id="puzzle-help" className="visually-hidden" aria-live="polite">
          {imageError ? 'The image could not be loaded.' : feedback}
        </span>
      </main>
    </div>
  )
}

export default App
