import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { ProjectHeader } from '@helenhsong/ui'
import '@helenhsong/ui/style.css'
import readme from '../README.md?raw'
import {
  DEFAULT_ARTWORK, DIFFICULTIES, TABLE_HEIGHT, TABLE_WIDTH,
  createPieces, fitPieceCenter, groupCount, moveGroup, rotateGroup, scatterPieces, snapNearbyGroups,
} from './jigsaw'
import { loadPuzzleCollection, savePuzzleCollection } from './persistence'

const PUZZLE_IMAGE = import.meta.env.BASE_URL + 'puzzles/01.jpeg'
const MIN_FLOOR_WIDTH = 560
const PIECE_GEOMETRY_VERSION = 11
const SCATTER_VERSION = 2
const PILE_WIDTH = 260
const PILE_HEIGHT = 176
const LANDING_SPREAD = 1.18
const INSTRUCTIONS = 'Drag to move · Double-click or press R to rotate'
const TIMELINE_LINE_COUNT = 40
const TIMELINE_PROXIMITY = 48
const PLACEHOLDER_ARTWORK = {
  title: 'Untitled (Orange Glasses)',
  artist: 'Artist unknown',
  year: 'Undated',
  medium: 'Digital image',
}
const PUZZLES = [
  { id: 'puzzle-01', number: '01', level: 'Easy', difficultyKey: 'easy', imageUrl: PUZZLE_IMAGE, artwork: PLACEHOLDER_ARTWORK },
  { id: 'puzzle-02', number: '02', level: 'Easy', difficultyKey: 'easy', imageUrl: PUZZLE_IMAGE, artwork: PLACEHOLDER_ARTWORK },
  { id: 'puzzle-03', number: '03', level: 'Medium', difficultyKey: 'medium', imageUrl: PUZZLE_IMAGE, artwork: PLACEHOLDER_ARTWORK },
  { id: 'puzzle-04', number: '04', level: 'Medium', difficultyKey: 'medium', imageUrl: PUZZLE_IMAGE, artwork: PLACEHOLDER_ARTWORK },
  { id: 'puzzle-05', number: '05', level: 'Hard', difficultyKey: 'hard', imageUrl: PUZZLE_IMAGE, artwork: PLACEHOLDER_ARTWORK },
  { id: 'puzzle-06', number: '06', level: 'Hard', difficultyKey: 'hard', imageUrl: PUZZLE_IMAGE, artwork: PLACEHOLDER_ARTWORK },
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

const STORED_PUZZLES = readSavedPuzzles()
const INITIAL_PUZZLES = Object.fromEntries(PUZZLES.map((puzzle) => [
  puzzle.id,
  STORED_PUZZLES[puzzle.id] ?? freshPuzzle(puzzle),
]))
const BOOTSTRAP_PUZZLE = PUZZLES[0]
const BOOTSTRAP_PROGRESS = INITIAL_PUZZLES[BOOTSTRAP_PUZZLE.id]

function pilePoint(progress, position) {
  return {
    x: PILE_WIDTH / 2 + (position.x / progress.floorBounds.width - 0.5) * PILE_WIDTH * LANDING_SPREAD,
    y: PILE_HEIGHT / 2 + (position.y / progress.floorBounds.height - 0.5) * PILE_HEIGHT * LANDING_SPREAD,
  }
}

function createPileLayout(progress, offsets = {}) {
  return Object.fromEntries(progress.pieces.map((piece) => {
    const position = progress.positions[piece.id]
    const offset = offsets[position.group] ?? { x: 0, y: 0 }
    const point = pilePoint(progress, position)
    const scale = Math.max(0.1, Math.min(0.5, 21 / Math.sqrt(piece.width * piece.height)))
    const fitted = fitPieceCenter(
      piece,
      position.rotation,
      { x: point.x + offset.x, y: point.y + offset.y },
      { width: PILE_WIDTH, height: PILE_HEIGHT },
      scale,
      2,
    )
    const { x, y } = fitted
    return [piece.id, `translate(${x} ${y}) rotate(${position.rotation}) scale(${scale}) translate(${-piece.centerX} ${-piece.centerY})`]
  }))
}

function applyPileOffsets(progress, offsets) {
  let positions = progress.positions
  for (const [group, offset] of Object.entries(offsets)) {
    positions = moveGroup(
      positions,
      progress.pieces,
      Number(group),
      offset.x * progress.floorBounds.width / (PILE_WIDTH * LANDING_SPREAD),
      offset.y * progress.floorBounds.height / (PILE_HEIGHT * LANDING_SPREAD),
      progress.floorBounds,
    )
  }
  return { ...progress, positions }
}

function createPuzzleFlight(tile, surface) {
  const sourcePieces = [...surface.querySelectorAll('.pile-piece-set')]
  const app = document.querySelector('.puzzle-app')
  if (!sourcePieces.length || !app || typeof app.animate !== 'function') return null

  const appBounds = app.getBoundingClientRect()
  const surfaceBounds = surface.getBoundingClientRect()
  const tileIndex = [...app.querySelectorAll('.puzzle-tile')].indexOf(tile)
  const collectionLayer = app.cloneNode(true)
  const clonedTile = collectionLayer.querySelectorAll('.puzzle-tile')[tileIndex]
  clonedTile?.querySelector('.puzzle-object')?.style.setProperty('visibility', 'hidden')
  collectionLayer.classList.add('puzzle-transition-collection')
  collectionLayer.setAttribute('aria-hidden', 'true')
  Object.assign(collectionLayer.style, {
    position: 'fixed',
    zIndex: '40',
    top: `${appBounds.top}px`,
    left: `${appBounds.left}px`,
    width: `${appBounds.width}px`,
    height: `${appBounds.height}px`,
    margin: '0',
    pointerEvents: 'none',
  })

  const pieceLayer = document.createElement('div')
  pieceLayer.className = 'puzzle-app puzzle-transition-pieces'
  pieceLayer.setAttribute('aria-hidden', 'true')
  const sourceViewBox = surface.getAttribute('viewBox')
  const sourceAspectRatio = surface.getAttribute('preserveAspectRatio')
  const defs = surface.querySelector('defs')
  const sourceFilter = window.getComputedStyle(surface).filter
  const flightId = `puzzle-flight-${Date.now().toString(36)}`
  const flights = sourcePieces.map((sourcePiece, pieceId) => {
    const sourceBounds = sourcePiece.getBoundingClientRect()
    const wrapper = document.createElement('div')
    wrapper.className = 'puzzle-transition-piece'
    wrapper.dataset.pieceId = String(pieceId)
    Object.assign(wrapper.style, {
      position: 'fixed',
      top: `${sourceBounds.top}px`,
      left: `${sourceBounds.left}px`,
      width: `${sourceBounds.width}px`,
      height: `${sourceBounds.height}px`,
      transformOrigin: '0 0',
    })

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    if (sourceViewBox) svg.setAttribute('viewBox', sourceViewBox)
    if (sourceAspectRatio) svg.setAttribute('preserveAspectRatio', sourceAspectRatio)
    Object.assign(svg.style, {
      position: 'absolute',
      top: `${surfaceBounds.top - sourceBounds.top}px`,
      left: `${surfaceBounds.left - sourceBounds.left}px`,
      width: `${surfaceBounds.width}px`,
      height: `${surfaceBounds.height}px`,
      overflow: 'visible',
      filter: sourceFilter,
    })
    const clonedDefs = defs?.cloneNode(true)
    const clonedPiece = sourcePiece.cloneNode(true)
    const clonedPattern = clonedDefs?.querySelector('pattern')
    if (clonedPattern) {
      const patternId = `${flightId}-${pieceId}`
      clonedPattern.id = patternId
      clonedPiece.querySelector('.pile-piece')?.setAttribute('fill', `url(#${patternId})`)
    }
    if (clonedDefs) svg.append(clonedDefs)
    svg.append(clonedPiece)
    wrapper.append(svg)
    pieceLayer.append(wrapper)
    return { pieceId, sourceBounds, wrapper }
  })

  document.body.append(collectionLayer, pieceLayer)
  return { collectionLayer, pieceLayer, flights }
}

function runPuzzleFlight(flight) {
  const duration = 820
  const easing = 'cubic-bezier(0.16, 1, 0.3, 1)'
  const cleanup = () => {
    flight.collectionLayer.remove()
    flight.pieceLayer.remove()
    document.documentElement.classList.remove('puzzle-opening')
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const animations = flight.flights.map(({ pieceId, sourceBounds, wrapper }) => {
        const target = document.querySelector(`[data-transition-piece="${pieceId}"]`)
        const targetBounds = target?.getBoundingClientRect()
        if (!targetBounds?.width || !targetBounds?.height) return null
        const moveX = targetBounds.left - sourceBounds.left
        const moveY = targetBounds.top - sourceBounds.top
        const scaleX = targetBounds.width / sourceBounds.width
        const scaleY = targetBounds.height / sourceBounds.height
        return wrapper.animate(
          [
            { transform: 'translate(0, 0) scale(1)' },
            { transform: `translate(${moveX}px, ${moveY}px) scale(${scaleX}, ${scaleY})` },
          ],
          { duration, easing, fill: 'forwards' },
        )
      }).filter(Boolean)

      const collectionAnimation = flight.collectionLayer.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: 240, easing: 'ease-out', fill: 'forwards' },
      )
      Promise.allSettled([
        collectionAnimation.finished,
        ...animations.map((animation) => animation.finished),
      ]).then(cleanup)
    })
  })
}

function PuzzleTile({ puzzle, progress, cursorWindRef, onOpen, onScatter }) {
  const [hoverOffsets, setHoverOffsets] = useState({})
  const complete = isComplete(progress)
  const pieces = progress.pieces
  const pileLayout = createPileLayout(progress, hoverOffsets)
  const patternId = `pile-art-${puzzle.id}`

  function pushPieces(event) {
    if (event.pointerType !== 'mouse') return
    const wind = cursorWindRef.current
    if (wind.speed < 1.1) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const cursor = {
      x: (event.clientX - bounds.left) / bounds.width * PILE_WIDTH,
      y: (event.clientY - bounds.top) / bounds.height * PILE_HEIGHT,
    }
    const centers = {}
    for (const piece of pieces) {
      const position = progress.positions[piece.id]
      const point = pilePoint(progress, position)
      const center = centers[position.group] ?? { x: 0, y: 0, count: 0 }
      center.x += point.x
      center.y += point.y
      center.count += 1
      centers[position.group] = center
    }

    setHoverOffsets((current) => {
      let changed = false
      const next = { ...current }
      for (const [group, total] of Object.entries(centers)) {
        const base = { x: total.x / total.count, y: total.y / total.count }
        const offset = current[group] ?? { x: 0, y: 0 }
        const dx = base.x + offset.x - cursor.x
        const dy = base.y + offset.y - cursor.y
        const distance = Math.hypot(dx, dy)
        if (distance >= 46) continue
        const proximity = 1 - distance / 46
        const force = Math.min(2.4, 0.55 + (wind.speed - 1.1) * 0.72) * proximity
        let x = offset.x + wind.x / wind.speed * force
        let y = offset.y + wind.y / wind.speed * force
        const displacement = Math.hypot(x, y)
        const maxDisplacement = pieces.length <= 12 ? 8 : 6
        if (displacement > maxDisplacement) {
          x = x / displacement * maxDisplacement
          y = y / displacement * maxDisplacement
        }
        next[group] = { x, y }
        changed = true
      }
      return changed ? next : current
    })
  }

  function commitScatter() {
    if (!Object.keys(hoverOffsets).length) return
    onScatter(puzzle, hoverOffsets)
    setHoverOffsets({})
  }

  function openWithScatter(event) {
    const tile = event?.currentTarget?.closest?.('.puzzle-tile') ?? event?.currentTarget
    const selectedSurface = tile?.querySelector?.('svg, .exhibit-frame')
    const open = () => onOpen(puzzle, hoverOffsets)
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reduceMotion || !selectedSurface?.matches('svg')) {
      open()
      setHoverOffsets({})
      return
    }

    const flight = createPuzzleFlight(tile, selectedSurface)
    if (!flight) {
      open()
      setHoverOffsets({})
      return
    }

    document.documentElement.classList.add('puzzle-opening')
    flushSync(open)
    runPuzzleFlight(flight)
    setHoverOffsets({})
  }

  return (
    <div
      className={`puzzle-tile${complete ? ' is-complete' : ''}`}
      role="button"
      tabIndex="0"
      aria-label={`Open ${puzzle.artwork.title}, puzzle ${puzzle.number}, ${puzzle.level}${complete ? ', assembled' : ''}`}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          openWithScatter(event)
        }
      }}
    >
      <span className="puzzle-object" aria-hidden="true">
        {complete ? (
          <span className="exhibit-frame" onClick={openWithScatter}>
            <img src={puzzle.imageUrl} alt="" />
          </span>
        ) : (
          <svg viewBox={`0 0 ${PILE_WIDTH} ${PILE_HEIGHT}`} onPointerMove={pushPieces} onPointerLeave={commitScatter}>
            <defs>
              <pattern id={patternId} width={progress.artwork.width} height={progress.artwork.height} patternUnits="userSpaceOnUse">
                <image href={puzzle.imageUrl} width={progress.artwork.width} height={progress.artwork.height} preserveAspectRatio="none" />
              </pattern>
            </defs>
            {pieces.map((piece) => (
              <g className="pile-piece-set" key={piece.id} transform={pileLayout[piece.id]} onClick={openWithScatter}>
                <path className="pile-backing" d={piece.path} transform="translate(0 1.3)" />
                <path className="pile-piece" d={piece.path} fill={`url(#${patternId})`} />
              </g>
            ))}
          </svg>
        )}
      </span>
      <div className="art-info-card">
        <p className="art-info-artist">{puzzle.artwork.artist}</p>
        <p className="art-info-title"><cite>{puzzle.artwork.title}</cite>, {puzzle.artwork.year}</p>
        <p className="art-info-medium">{puzzle.artwork.medium}</p>
      </div>
    </div>
  )
}

function LineMinimap({ activeIndex, puzzles, progress, progressByPuzzle, onScrub }) {
  const [pointer, setPointer] = useState(null)
  const activePuzzle = puzzles[activeIndex]
  const assembled = isComplete(progressByPuzzle[activePuzzle.id])

  function trackPointer(event) {
    const bounds = event.currentTarget.getBoundingClientRect()
    setPointer({ x: event.clientX - bounds.left, width: bounds.width })
  }

  return (
    <nav className="collection-minimap" aria-label="Choose a puzzle">
      <div className="minimap-rail" onPointerMove={trackPointer} onPointerLeave={() => setPointer(null)}>
        <div className="minimap-lines" aria-hidden="true">
          {Array.from({ length: TIMELINE_LINE_COUNT }, (_, index) => {
            const railWidth = pointer?.width ?? 220
            const lineX = index / (TIMELINE_LINE_COUNT - 1) * railWidth
            const interactionX = pointer?.x ?? progress * railWidth
            const distance = Math.abs(interactionX - lineX)
            const proximity = Math.max(0, 1 - distance / TIMELINE_PROXIMITY)
            const scale = 1 + 20 * proximity * proximity
            const major = puzzles.some((_, puzzleIndex) => (
              Math.round(puzzleIndex / (puzzles.length - 1) * (TIMELINE_LINE_COUNT - 1)) === index
            ))
            return (
              <span
                className={`minimap-line${major ? ' is-major' : ''}`}
                key={index}
                style={{ '--line-scale': scale }}
              />
            )
          })}
        </div>
        <input
          className="minimap-range"
          type="range"
          min="0"
          max="1"
          step={1 / (puzzles.length - 1)}
          value={progress}
          aria-label="Current puzzle"
          aria-valuetext={`Puzzle ${activePuzzle.number}, ${activePuzzle.level}${assembled ? ', assembled' : ''}`}
          onChange={(event) => onScrub(Number(event.target.value))}
        />
      </div>
    </nav>
  )
}

function App() {
  const tableRef = useRef(null)
  const collectionRef = useRef(null)
  const galleryWheelRef = useRef({ frame: null, target: 0 })
  const dragRef = useRef(null)
  const tapRef = useRef(null)
  const pointerTypeRef = useRef(null)
  const dialogRef = useRef(null)
  const cursorWindRef = useRef({ x: 0, y: 0, speed: 0 })
  const savedPuzzlesRef = useRef(INITIAL_PUZZLES)
  const puzzleDifficultyRef = useRef(
    DIFFICULTIES.find((difficulty) => difficulty.key === BOOTSTRAP_PROGRESS.difficultyKey),
  )
  const floorBoundsRef = useRef(BOOTSTRAP_PROGRESS.floorBounds)
  const positionsRef = useRef(BOOTSTRAP_PROGRESS.positions)
  const [activePuzzleId, setActivePuzzleId] = useState(null)
  const [visiblePuzzleIndex, setVisiblePuzzleIndex] = useState(0)
  const [galleryProgress, setGalleryProgress] = useState(0)
  const [savedPuzzles, setSavedPuzzles] = useState(INITIAL_PUZZLES)
  const [artwork, setArtwork] = useState(BOOTSTRAP_PROGRESS.artwork)
  const [floorBounds, setFloorBounds] = useState(BOOTSTRAP_PROGRESS.floorBounds)
  const [pieces, setPieces] = useState(BOOTSTRAP_PROGRESS.pieces)
  const [positions, setPositions] = useState(BOOTSTRAP_PROGRESS.positions)
  const [zOrder, setZOrder] = useState(BOOTSTRAP_PROGRESS.zOrder)
  const [selectedPieceId, setSelectedPieceId] = useState(null)
  const [draggingGroup, setDraggingGroup] = useState(null)
  const [isDropping, setIsDropping] = useState(false)
  const [dropCycle, setDropCycle] = useState(0)
  const [feedback, setFeedback] = useState(
    isComplete(BOOTSTRAP_PROGRESS) ? 'All together. Nicely done.' : INSTRUCTIONS,
  )
  const [imageError, setImageError] = useState(false)

  useEffect(() => {
    let previous = null
    const trackCursorWind = (event) => {
      const current = { x: event.clientX, y: event.clientY, time: event.timeStamp }
      if (!previous) {
        previous = current
        return
      }
      const elapsed = current.time - previous.time
      const x = current.x - previous.x
      const y = current.y - previous.y
      cursorWindRef.current = elapsed > 0 && elapsed < 80
        ? { x, y, speed: Math.hypot(x, y) / elapsed }
        : { x: 0, y: 0, speed: 0 }
      previous = current
    }
    window.addEventListener('pointermove', trackCursorWind, { capture: true, passive: true })
    return () => window.removeEventListener('pointermove', trackCursorWind, true)
  }, [])

  useEffect(() => {
    if (activePuzzleId) return undefined
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

    const keepTargetInBounds = () => {
      const maximumScroll = Math.max(0, gallery.scrollWidth - gallery.clientWidth)
      wheelState.target = Math.max(0, Math.min(maximumScroll, gallery.scrollLeft))
    }

    window.addEventListener('wheel', scrollGallery, { passive: false })
    window.addEventListener('resize', keepTargetInBounds)

    return () => {
      window.removeEventListener('wheel', scrollGallery)
      window.removeEventListener('resize', keepTargetInBounds)
      if (wheelState.frame !== null) window.cancelAnimationFrame(wheelState.frame)
      wheelState.frame = null
    }
  }, [activePuzzleId])

  const activePuzzle = PUZZLES.find((puzzle) => puzzle.id === activePuzzleId)
  const difficulty = puzzleDifficultyRef.current
  const remainingGroups = groupCount(positions)
  const complete = remainingGroups === 1
  const selectedGroup = selectedPieceId === null ? null : positions[selectedPieceId]?.group

  function syncTimelineToScroll(event) {
    const gallery = event.currentTarget
    const maximumScroll = gallery.scrollWidth - gallery.clientWidth
    const progress = maximumScroll > 0
      ? Math.max(0, Math.min(1, gallery.scrollLeft / maximumScroll))
      : 0
    setGalleryProgress(progress)
    if (gallery.scrollLeft <= 1) {
      setVisiblePuzzleIndex(0)
      return
    }
    if (gallery.scrollLeft >= maximumScroll - 1) {
      setVisiblePuzzleIndex(PUZZLES.length - 1)
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
    setVisiblePuzzleIndex((current) => current === closestIndex ? current : closestIndex)
  }

  function showPuzzleInGallery(index, preferredBehavior) {
    const gallery = collectionRef.current
    const tile = gallery?.children[index]
    if (!gallery || !tile) return
    const left = tile.offsetLeft - (gallery.clientWidth - tile.offsetWidth) / 2
    const maximumScroll = gallery.scrollWidth - gallery.clientWidth
    const boundedLeft = Math.max(0, Math.min(maximumScroll, left))
    gallery.scrollTo({
      left: boundedLeft,
      behavior: preferredBehavior
        ?? (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'),
    })
    setGalleryProgress(maximumScroll > 0 ? boundedLeft / maximumScroll : 0)
    setVisiblePuzzleIndex(index)
  }

  function scrubPuzzleGallery(progress) {
    const gallery = collectionRef.current
    if (!gallery) return
    const maximumScroll = gallery.scrollWidth - gallery.clientWidth
    gallery.scrollTo({ left: progress * maximumScroll, behavior: 'auto' })
    setGalleryProgress(progress)
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

  function moveLandingPieces(puzzle, offsets) {
    const progress = savedPuzzlesRef.current[puzzle.id]
    if (!progress || !Object.keys(offsets).length) return
    storePuzzle(puzzle.id, applyPileOffsets(progress, offsets))
  }

  function openPuzzle(puzzle, offsets = {}) {
    let progress = savedPuzzlesRef.current[puzzle.id] ?? freshPuzzle(puzzle, floorBoundsRef.current)
    if (Object.keys(offsets).length) {
      progress = applyPileOffsets(progress, offsets)
      storePuzzle(puzzle.id, progress)
    }
    puzzleDifficultyRef.current = DIFFICULTIES.find(
      (difficultyOption) => difficultyOption.key === puzzle.difficultyKey,
    )
    floorBoundsRef.current = progress.floorBounds
    positionsRef.current = progress.positions
    setArtwork(progress.artwork)
    setFloorBounds(progress.floorBounds)
    setPieces(progress.pieces)
    setPositions(progress.positions)
    setZOrder(progress.zOrder)
    setSelectedPieceId(null)
    setDraggingGroup(null)
    setIsDropping(false)
    setImageError(false)
    setFeedback(isComplete(progress) ? 'All together. Nicely done.' : INSTRUCTIONS)
    setVisiblePuzzleIndex(PUZZLES.findIndex((option) => option.id === puzzle.id))
    setActivePuzzleId(puzzle.id)
  }

  function leavePuzzle() {
    const galleryIndex = PUZZLES.findIndex((puzzle) => puzzle.id === activePuzzleId)
    storePuzzle(activePuzzleId)
    setActivePuzzleId(null)
    setSelectedPieceId(null)
    window.requestAnimationFrame(() => showPuzzleInGallery(Math.max(0, galleryIndex), 'auto'))
  }

  function resetPuzzle(nextArtwork = artwork, animate = false) {
    const nextPieces = createPieces(difficulty, nextArtwork, activePuzzleId)
    dragRef.current = null
    tapRef.current = null
    setPieces(nextPieces)
    commitPositions(scatterPieces(nextPieces, floorBoundsRef.current))
    setZOrder([...nextPieces].sort((a, b) => a.fallDelay - b.fallDelay).map((piece) => piece.id))
    setSelectedPieceId(null)
    setDraggingGroup(null)
    setIsDropping(animate)
    setDropCycle((cycle) => cycle + 1)
    setFeedback(animate ? 'The pieces are falling…' : INSTRUCTIONS)
  }

  useEffect(() => {
    if (!activePuzzle) return undefined
    let cancelled = false
    const restored = Boolean(savedPuzzlesRef.current[activePuzzle.id])
    const image = new Image()
    image.onload = () => {
      if (cancelled) return
      setImageError(false)
      if (restored) return
      const scale = 540 / Math.max(image.naturalWidth, image.naturalHeight)
      const size = { width: image.naturalWidth * scale, height: image.naturalHeight * scale }
      setArtwork(size)
      resetPuzzle(size)
    }
    image.onerror = () => {
      if (!cancelled) {
        setImageError(true)
        setFeedback('The puzzle image could not be loaded. Try restarting.')
      }
    }
    image.src = activePuzzle.imageUrl
    return () => { cancelled = true }
  }, [activePuzzleId])

  useEffect(() => {
    if (!isDropping) return undefined
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const duration = reducedMotion
      ? 0
      : Math.max(...pieces.map((piece) => piece.fallDelay + piece.fallDuration)) + 60
    const timer = window.setTimeout(() => {
      setIsDropping(false)
      setFeedback(INSTRUCTIONS)
    }, duration)
    return () => window.clearTimeout(timer)
  }, [dropCycle, isDropping, pieces])

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
    if (isDropping || dragRef.current || pieceId === null) return
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
    if (isDropping || dragRef.current || event.button !== 0) return
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
      const now = performance.now()
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
    if (isDropping) return
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

  return (
    <div className="site-shell">
      <ProjectHeader readme={readme} />
      <main className="puzzle-app">
        {!activePuzzle ? (
          <section className="collection-screen" aria-label="Puzzle gallery">
            <LineMinimap
              activeIndex={visiblePuzzleIndex}
              puzzles={PUZZLES}
              progress={galleryProgress}
              progressByPuzzle={savedPuzzles}
              onScrub={scrubPuzzleGallery}
            />
            <div className="collection-grid" ref={collectionRef} onScroll={syncTimelineToScroll}>
              {PUZZLES.map((puzzle) => (
                <PuzzleTile
                  key={puzzle.id}
                  puzzle={puzzle}
                  progress={savedPuzzles[puzzle.id]}
                  cursorWindRef={cursorWindRef}
                  onOpen={openPuzzle}
                  onScatter={moveLandingPieces}
                />
              ))}
            </div>
          </section>
        ) : (
          <section className="game" aria-labelledby="game-title">
            <h1 id="game-title" className="visually-hidden">
              Puzzle {activePuzzle.number}, {activePuzzle.level}
            </h1>
            <div className="game-layout">
              <div className="puzzle-options" role="group" aria-label="Puzzle controls">
                <button type="button" onClick={leavePuzzle}>All puzzles</button>
                <span className="active-puzzle-label">{activePuzzle.number} · {activePuzzle.level}</span>
                <button type="button" onClick={() => imageError ? window.location.reload() : resetPuzzle(artwork, true)}>Restart</button>
                <button
                  type="button"
                  className="rotate-control"
                  disabled={selectedPieceId === null || isDropping}
                  onClick={() => turnPiece(selectedPieceId)}
                  title="Turn the selected piece or connected group clockwise"
                >
                  Rotate ↻
                </button>
              </div>

              <div className="floor-shell">
                <svg
                  ref={tableRef}
                  className={`puzzle-floor${isDropping ? ' is-dropping' : ''}${complete ? ' is-complete' : ''}`}
                  style={{ viewTransitionName: 'active-puzzle' }}
                  viewBox={`0 0 ${floorBounds.width} ${floorBounds.height}`}
                  aria-label={`${activePuzzle.level} puzzle floor with ${pieces.length} pieces`}
                  aria-describedby="puzzle-help"
                  onPointerDown={(event) => {
                    if (event.target === event.currentTarget) setSelectedPieceId(null)
                  }}
                >
                  <defs>
                    <pattern id="puzzle-artwork" width={artwork.width} height={artwork.height} patternUnits="userSpaceOnUse">
                      <image href={activePuzzle.imageUrl} width={artwork.width} height={artwork.height} preserveAspectRatio="none" />
                    </pattern>
                    <filter id="paper-grain" x="0" y="0" width="100%" height="100%">
                      <feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="3" seed="12" stitchTiles="stitch" />
                      <feColorMatrix type="saturate" values="0" />
                    </filter>
                    <pattern id="paper-fibers" width="150" height="150" patternUnits="userSpaceOnUse">
                      <rect width="150" height="150" filter="url(#paper-grain)" opacity="0.22" />
                    </pattern>
                    <linearGradient id="piece-sheen" x1="0" y1="0" x2="0.8" y2="1">
                      <stop offset="0" stopColor="#ffffff" stopOpacity="0.13" />
                      <stop offset="0.48" stopColor="#ffffff" stopOpacity="0.01" />
                      <stop offset="1" stopColor="#161616" stopOpacity="0.075" />
                    </linearGradient>
                  </defs>

                  {zOrder.map((pieceId) => {
                    const piece = pieces[pieceId]
                    const position = positions[pieceId]
                    const tossX = floorBounds.width / 2 - position.x + piece.throwX
                    const tossY = -140 - position.y + piece.throwY
                    const travelLength = Math.hypot(tossX, tossY) || 1
                    const impactX = tossX / travelLength * piece.slideDistance - tossY / travelLength * piece.slideSkew
                    const impactY = tossY / travelLength * piece.slideDistance + tossX / travelLength * piece.slideSkew
                    return (
                      <g
                        key={`${dropCycle}-${piece.id}`}
                        data-transition-piece={piece.id}
                        transform={`translate(${position.x} ${position.y})`}
                      >
                        <g className="piece-drop" style={{
                          '--fall-delay': `${piece.fallDelay}ms`,
                          '--fall-duration': `${piece.fallDuration}ms`,
                          '--toss-spin': `${piece.fallRotation}deg`,
                          '--toss-x': `${tossX}px`,
                          '--toss-y': `${tossY}px`,
                          '--impact-x': `${impactX}px`,
                          '--impact-y': `${impactY}px`,
                          '--impact-spin': `${piece.slideSpin}deg`,
                          '--glide-x': `${impactX * 0.52}px`,
                          '--glide-y': `${impactY * 0.52}px`,
                          '--glide-spin': `${piece.slideSpin * 0.52}deg`,
                          '--settle-x': `${impactX * 0.16}px`,
                          '--settle-y': `${impactY * 0.16}px`,
                          '--settle-spin': `${piece.slideSpin * 0.16}deg`,
                        }}>
                          <g className={`piece-shadow${position.group === draggingGroup ? ' is-lifted' : ''}`}>
                            <g transform={`rotate(${position.rotation}) translate(${-piece.centerX} ${-piece.centerY})`}>
                              <path className="piece-backing" d={piece.path} transform="translate(0 1.7)" />
                              <path
                                className={`puzzle-piece${position.group === draggingGroup ? ' is-dragging' : ''}${position.group === selectedGroup ? ' is-selected' : ''}`}
                                d={piece.path}
                                fill="url(#puzzle-artwork)"
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
                              <path className="piece-texture" d={piece.path} fill="url(#paper-fibers)" />
                              <path className="piece-sheen" d={piece.path} fill="url(#piece-sheen)" />
                            </g>
                          </g>
                        </g>
                      </g>
                    )
                  })}
                </svg>
                <div className="floor-status" aria-live="polite">
                  <span id="puzzle-help">
                    {imageError ? 'The image could not be loaded. Try restarting.' : feedback}
                  </span>
                  <span>{complete ? 'Complete' : `${pieces.length - remainingGroups} / ${pieces.length - 1} connections`}</span>
                </div>
              </div>

              <aside className="reference-card" aria-label="Reference image">
                <img src={activePuzzle.imageUrl} alt="The completed puzzle" />
                <div className="reference-action">
                  <button type="button" onClick={() => dialogRef.current.showModal()}>View image</button>
                </div>
              </aside>
            </div>
          </section>
        )}

        <dialog
          ref={dialogRef}
          className="reference-lightbox"
          aria-label="Puzzle reference image"
          onClick={(event) => {
            if (event.target === event.currentTarget) dialogRef.current.close()
          }}
        >
          <button type="button" autoFocus onClick={() => dialogRef.current.close()}>Close</button>
          <img src={activePuzzle?.imageUrl ?? PUZZLE_IMAGE} alt="The completed puzzle at full size" />
        </dialog>
      </main>
    </div>
  )
}

export default App
