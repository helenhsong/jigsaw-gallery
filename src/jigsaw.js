export const TABLE_WIDTH = 1200
export const TABLE_HEIGHT = 760
export const DEFAULT_ARTWORK = { width: 540 * 423 / 570, height: 540 }

export const DIFFICULTIES = [
  { key: 'easy', label: 'Easy', pieces: 12, rows: 4, columns: 3 },
  { key: 'medium', label: 'Medium', pieces: 30, rows: 6, columns: 5 },
  { key: 'hard', label: 'Hard', pieces: 63, rows: 9, columns: 7 },
  { key: 'expert', label: 'Expert', pieces: 81, rows: 9, columns: 9 },
  { key: 'master', label: 'Master', pieces: 100, rows: 10, columns: 10 },
]

export function shuffle(items, random = Math.random) {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    ;[result[index], result[target]] = [result[target], result[index]]
  }
  return result
}

export function rotatePoint(x, y, degrees) {
  const angle = degrees * Math.PI / 180
  return { x: x * Math.cos(angle) - y * Math.sin(angle), y: x * Math.sin(angle) + y * Math.cos(angle) }
}

export function angleDifference(from, to) {
  return ((to - from + 540) % 360 + 360) % 360 - 180
}

export function createSeededRandom(seed) {
  const text = String(seed)
  let state = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    state ^= text.charCodeAt(index)
    state = Math.imul(state, 16777619)
  }
  return () => {
    state += 0x6D2B79F5
    let value = state
    value = Math.imul(value ^ value >>> 15, value | 1)
    value ^= value + Math.imul(value ^ value >>> 7, value | 61)
    return ((value ^ value >>> 14) >>> 0) / 4294967296
  }
}

const randomEdge = (random, sign) => ({
  sign,
  center: 0.48 + random() * 0.04,
  size: 0.97 + random() * 0.06,
})

// Both neighboring pieces use the same curve, traversed in opposite directions.
function edgeSegments(x, y, dx, dy, edge, tabSize) {
  const length = Math.hypot(dx, dy)
  const point = (along, out) => [x + dx / length * along - dy / length * out, y + dy / length * along + dx / length * out]
  if (!edge) return [{ start: [x, y], end: [x + dx, y + dy] }]
  const center = length * edge.center
  const radius = tabSize * edge.size
  const h = radius * edge.sign
  const knots = [
    { end: point(center - radius * 0.62, 0) },
    { c1: point(center - radius * 0.38, 0), c2: point(center - radius * 0.72, h * 0.17), end: point(center - radius * 0.72, h * 0.55) },
    { c1: point(center - radius * 0.72, h * 1.0), c2: point(center - radius * 0.42, h * 1.34), end: point(center, h * 1.34) },
    { c1: point(center + radius * 0.42, h * 1.34), c2: point(center + radius * 0.72, h * 1.0), end: point(center + radius * 0.72, h * 0.55) },
    { c1: point(center + radius * 0.72, h * 0.17), c2: point(center + radius * 0.38, 0), end: point(center + radius * 0.62, 0) },
    { end: [x + dx, y + dy] },
  ]
  return knots.map((segment, index) => ({ ...segment, start: index === 0 ? [x, y] : knots[index - 1].end }))
}

function renderEdge(segments, reverse = false) {
  return (reverse ? [...segments].reverse() : segments).map((segment) => {
    const end = reverse ? segment.start : segment.end
    if (!segment.c1) return `L ${end.join(' ')}`
    const first = reverse ? segment.c2 : segment.c1
    const second = reverse ? segment.c1 : segment.c2
    return `C ${first.join(' ')} ${second.join(' ')} ${end.join(' ')}`
  }).join(' ')
}

export function createPieces(difficulty, artwork = DEFAULT_ARTWORK, seed = difficulty.key) {
  const random = createSeededRandom(seed)
  const width = artwork.width / difficulty.columns
  const height = artwork.height / difficulty.rows
  const tabSize = Math.min(width, height) * 0.17
  const tabPhase = random() < 0.5 ? -1 : 1
  const balancedEdge = (row, column) => randomEdge(random, (row + column) % 2 === 0 ? tabPhase : -tabPhase)
  // Alternating the tab direction keeps each piece's mix of tabs and cut-ins
  // visually balanced, without making the individual curves identical.
  const horizontal = Array.from(
    { length: difficulty.rows - 1 },
    (_, row) => Array.from({ length: difficulty.columns }, (_, column) => balancedEdge(row, column)),
  )
  const vertical = Array.from(
    { length: difficulty.rows },
    (_, row) => Array.from({ length: difficulty.columns - 1 }, (_, column) => balancedEdge(row, column)),
  )

  return Array.from({ length: difficulty.pieces }, (_, id) => {
    const row = Math.floor(id / difficulty.columns)
    const column = id % difficulty.columns
    const x = column * width
    const y = row * height
    const top = edgeSegments(x, y, width, 0, row === 0 ? null : horizontal[row - 1][column], tabSize)
    const right = edgeSegments(x + width, y, 0, height, column === difficulty.columns - 1 ? null : vertical[row][column], tabSize)
    const bottom = edgeSegments(x, y + height, width, 0, row === difficulty.rows - 1 ? null : horizontal[row][column], tabSize)
    const left = edgeSegments(x, y, 0, height, column === 0 ? null : vertical[row][column - 1], tabSize)
    const outline = [...top, ...right, ...bottom, ...left].flatMap((segment) => [segment.start, segment.c1, segment.c2, segment.end].filter(Boolean))
    const localBounds = {
      left: Math.min(...outline.map(([px]) => px)) - x - width / 2,
      right: Math.max(...outline.map(([px]) => px)) - x - width / 2,
      top: Math.min(...outline.map(([, py]) => py)) - y - height / 2,
      bottom: Math.max(...outline.map(([, py]) => py)) - y - height / 2,
    }
    return {
      id, row, column, width, height, tabSize, localBounds,
      centerX: x + width / 2,
      centerY: y + height / 2,
      path: `M ${x} ${y} ${renderEdge(top)} ${renderEdge(right)} ${renderEdge(bottom, true)} ${renderEdge(left, true)} Z`,
      // Every piece begins as part of a loose handful above the table, then
      // gets its own trajectory and spin as it lands in its scattered spot.
      fallDelay: Math.round(random() * 110),
      fallDuration: 540 + Math.round(random() * 150),
      fallRotation: Math.round(random() * 220 - 110),
      throwX: Math.round(random() * 200 - 100),
      throwY: Math.round(random() * 76 - 38),
      slideDistance: 54 + Math.round(random() * 58),
      slideSkew: Math.round(random() * 34 - 17),
      slideSpin: Math.round(random() * 70 - 35),
    }
  })
}

export function pieceBounds(piece, position) {
  const b = piece.localBounds
  const corners = [[b.left, b.top], [b.right, b.top], [b.right, b.bottom], [b.left, b.bottom]]
    .map(([x, y]) => rotatePoint(x, y, position.rotation))
  return {
    left: position.x + Math.min(...corners.map((p) => p.x)) - 3,
    right: position.x + Math.max(...corners.map((p) => p.x)) + 3,
    top: position.y + Math.min(...corners.map((p) => p.y)) - 3,
    bottom: position.y + Math.max(...corners.map((p) => p.y)) + 3,
  }
}

export function scatterPieces(pieces, floor = { width: TABLE_WIDTH, height: TABLE_HEIGHT }, seed) {
  const random = seed === undefined ? Math.random : createSeededRandom(seed)
  const positions = {}
  const placed = []
  const clusterChance = 0.25
  for (const piece of shuffle(pieces, random)) {
    const rotation = random() * 360 - 180
    const bounds = pieceBounds(piece, { x: 0, y: 0, rotation })
    const xMargin = Math.max(bounds.right, -bounds.left) + 16
    const yMargin = Math.max(bounds.bottom, -bounds.top) + 16
    const clearance = Math.min(piece.width, piece.height) * (1 + random() * 0.65)
    let candidate
    // Loose clusters and open gaps, with enough exposed area to pick up every piece.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (placed.length && random() < clusterChance) {
        const anchor = placed[Math.floor(random() * placed.length)]
        const direction = random() * Math.PI * 2
        const distance = Math.min(piece.width, piece.height) * (1.1 + random() * 1.05)
        candidate = { x: anchor.x + Math.cos(direction) * distance, y: anchor.y + Math.sin(direction) * distance }
      } else {
        candidate = { x: xMargin + random() * (floor.width - xMargin * 2), y: yMargin + random() * (floor.height - yMargin * 2) }
      }
      if (candidate.x < xMargin || candidate.x > floor.width - xMargin || candidate.y < yMargin || candidate.y > floor.height - yMargin) continue
      const relaxedClearance = attempt < 82 ? clearance : clearance * 0.72
      if (placed.every((other) => Math.hypot(candidate.x - other.x, candidate.y - other.y) > relaxedClearance)) break
    }
    const position = {
      x: Math.max(xMargin, Math.min(floor.width - xMargin, candidate.x)),
      y: Math.max(yMargin, Math.min(floor.height - yMargin, candidate.y)),
      rotation,
      group: piece.id,
    }
    positions[piece.id] = position
    placed.push(position)
  }
  return positions
}

export const groupCount = (positions) => new Set(Object.values(positions).map((position) => position.group)).size

export function moveGroup(positions, pieces, group, dx, dy, floor = { width: TABLE_WIDTH, height: TABLE_HEIGHT }) {
  const members = pieces.filter((piece) => positions[piece.id].group === group)
  if (!members.length) return positions
  const bounds = members.map((piece) => pieceBounds(piece, positions[piece.id]))
  const movementX = Math.max(-Math.min(...bounds.map((b) => b.left)), Math.min(floor.width - Math.max(...bounds.map((b) => b.right)), dx))
  const movementY = Math.max(-Math.min(...bounds.map((b) => b.top)), Math.min(floor.height - Math.max(...bounds.map((b) => b.bottom)), dy))
  return Object.fromEntries(Object.entries(positions).map(([id, position]) => [id, position.group === group ? { ...position, x: position.x + movementX, y: position.y + movementY } : position]))
}

export function rotateGroup(positions, pieces, group, degrees, pivot, floor = { width: TABLE_WIDTH, height: TABLE_HEIGHT }) {
  const members = Object.values(positions).filter((position) => position.group === group)
  if (!members.length) return positions
  const center = pivot ?? { x: members.reduce((sum, p) => sum + p.x, 0) / members.length, y: members.reduce((sum, p) => sum + p.y, 0) / members.length }
  const rotated = Object.fromEntries(Object.entries(positions).map(([id, position]) => {
    if (position.group !== group) return [id, position]
    const offset = rotatePoint(position.x - center.x, position.y - center.y, degrees)
    return [id, { ...position, x: center.x + offset.x, y: center.y + offset.y, rotation: angleDifference(0, position.rotation + degrees) }]
  }))
  return moveGroup(rotated, pieces, group, 0, 0, floor)
}

function neighbors(piece, difficulty) {
  return [
    piece.row > 0 ? piece.id - difficulty.columns : null,
    piece.column < difficulty.columns - 1 ? piece.id + 1 : null,
    piece.row < difficulty.rows - 1 ? piece.id + difficulty.columns : null,
    piece.column > 0 ? piece.id - 1 : null,
  ].filter((id) => id !== null)
}

export function snapNearbyGroups(source, pieces, difficulty, startingGroup, floor = { width: TABLE_WIDTH, height: TABLE_HEIGHT }) {
  let positions = source
  let activeGroup = startingGroup
  let joins = 0

  while (true) {
    let match = null
    for (const piece of pieces) {
      const position = positions[piece.id]
      if (position.group !== activeGroup) continue
      for (const neighborId of neighbors(piece, difficulty)) {
        const neighbor = pieces[neighborId]
        const target = positions[neighborId]
        if (target.group === activeGroup) continue
        const angle = angleDifference(position.rotation, target.rotation)
        if (Math.abs(angle) > 19) continue
        const offset = rotatePoint(piece.centerX - neighbor.centerX, piece.centerY - neighbor.centerY, target.rotation)
        const x = target.x + offset.x
        const y = target.y + offset.y
        const distance = Math.hypot(x - position.x, y - position.y)
        if (distance > Math.max(14, Math.min(piece.width, piece.height) * 0.3)) continue
        if (!match || distance < match.distance) match = { distance, angle, x, y, pivot: position, targetGroup: target.group }
      }
    }
    if (!match) break
    const proposed = Object.fromEntries(Object.entries(positions).map(([id, position]) => {
      if (position.group !== activeGroup) return [id, position]
      const offset = rotatePoint(position.x - match.pivot.x, position.y - match.pivot.y, match.angle)
      return [id, { ...position, x: match.x + offset.x, y: match.y + offset.y, rotation: match.pivot.rotation + match.angle, group: match.targetGroup }]
    }))
    positions = moveGroup(proposed, pieces, match.targetGroup, 0, 0, floor)
    activeGroup = match.targetGroup
    joins += 1
  }
  return { positions, joins, activeGroup }
}
