import {
  getGroup,
  getNeighbors,
  samePoint,
  type Board,
  type Point,
  type StoneColor
} from './goRules'

/** How a single move is classified for pattern tracking. */
export type MoveType = 'capture' | 'atari' | 'defend' | 'attack' | 'neutral'

export interface TrackerEvent {
  moveNumber: number
  point: Point
  label: string
  color: StoneColor
  type: MoveType
  captured: number
  atariGroups: number
  liberties: number
}

export interface TrackerDetections {
  /** 连续 ≥3 手都是打吃 —— 学生可能在无意识地征子。 */
  isRepeatingAtari: boolean
  /** 本轮征子链上打吃过的位置。 */
  atariPositions: string[]
  /** 连续征子超过 4 手仍未提掉。 */
  isChasingTooLong: boolean
  /** 自己有危险（≤2 气）却不理会。 */
  isIgnoringDanger: boolean
  ignoredDangerCount: number
  /** 只防守不进攻。 */
  isAlwaysDefending: boolean
  /** 只进攻不防守。 */
  isAlwaysAttacking: boolean
  /** 连续几手都下在同一个 2×2 区域内。 */
  sameAreaPersistence: number
  /** 自己被叫吃（只剩 1 气）却脱先。 */
  tenukiWhenInAtari: boolean
}

export interface TrackerAwareness {
  /** 面前明明有子可提，学生却没提。 */
  sawTheCapture: boolean
  /** 学生注意到了自己的危险并做出了回应。 */
  sawTheDanger: boolean
  /** 这一手是当前局面的好棋。 */
  choseOptimal: boolean
}

/** Plain snapshot handed to the UI and to the mentor prompt. */
export interface SessionTracker {
  consecutiveActions: {
    lastMoveType: string
    count: number
    positions: string[]
  }
  detections: TrackerDetections
  awareness: TrackerAwareness
  /** 本轮征子链从第几手开始。 */
  chaseChainStart: number | null
  chaseChainLength: number
  /** 当前处于危险中的己方棋块（棋子坐标）。 */
  dangerGroups: Point[][]
  dangerLabels: string[]
  /** 最近几手都下在同一个 2×2 区域时，该区域的中心参考点。 */
  sameAreaCenter: Point | null
  totalMoves: number
}

export interface TrackerInput {
  moveNumber: number
  point: Point
  color: StoneColor
  boardBefore: Board
  boardAfter: Board
  captured: Point[]
  /** Enemy groups the move put into atari. */
  atariTargets: Point[]
  liberties: number
  /** 规则引擎认为存在一个明显可提的点，而学生没有提。 */
  missedCapture: boolean
  /** 规则引擎给出的这一手质量评价。 */
  quality: 'excellent' | 'good' | 'okay' | 'suboptimal' | 'mistake'
}

const DANGER_LIBERTIES = 2
const ATARI_CHAIN_THRESHOLD = 3
const CHASE_TOO_LONG = 4
const SAME_AREA_WINDOW = 3
const BALANCE_WINDOW = 5

function labelOf(point: Point): string {
  const letter = String.fromCharCode(65 + point.x)
  return `${letter}${13 - point.y}`
}

function distance(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

/** Own groups that are short of liberties, worst first. */
function findOwnWeakGroups(board: Board, color: StoneColor): Point[][] {
  const seen = new Set<string>()
  const groups: { stones: Point[]; liberties: number }[] = []

  for (let y = 0; y < board.length; y++) {
    for (let x = 0; x < board[y].length; x++) {
      if (board[y][x] !== color) continue
      const key = `${x},${y}`
      if (seen.has(key)) continue
      const group = getGroup(board, { x, y })
      for (const stone of group.stones) seen.add(`${stone.x},${stone.y}`)
      groups.push({ stones: group.stones, liberties: group.liberties.length })
    }
  }

  return groups
    .filter((group) => group.liberties <= DANGER_LIBERTIES)
    .sort((a, b) => a.liberties - b.liberties)
    .map((group) => group.stones)
}

/** True when the move touches the group (or one of its liberties) — i.e. it answers the danger. */
function respondsToGroup(move: Point, group: Point[], boardBefore: Board): boolean {
  for (const stone of group) {
    if (distance(move, stone) <= 1) return true
    const liberties = getGroup(boardBefore, stone).liberties
    if (liberties.some((liberty) => samePoint(liberty, move))) return true
  }
  return false
}

function touchesEnemy(move: Point, boardBefore: Board, color: StoneColor): boolean {
  const enemy = color === 'black' ? 'white' : 'black'
  return getNeighbors(move).some((neighbor) => boardBefore[neighbor.y][neighbor.x] === enemy)
}

/**
 * Tracks the student's behaviour across the moves of one game so the mentor can
 * talk about patterns ("你连着追了三手") instead of judging every move in isolation.
 */
export class Tracker {
  readonly events: TrackerEvent[] = []

  detections: TrackerDetections = {
    isRepeatingAtari: false,
    atariPositions: [],
    isChasingTooLong: false,
    isIgnoringDanger: false,
    ignoredDangerCount: 0,
    isAlwaysDefending: false,
    isAlwaysAttacking: false,
    sameAreaPersistence: 0,
    tenukiWhenInAtari: false
  }

  awareness: TrackerAwareness = {
    sawTheCapture: false,
    sawTheDanger: false,
    choseOptimal: false
  }

  chaseChainStart: number | null = null
  chaseChainLength = 0
  dangerGroups: Point[][] = []
  sameAreaCenter: Point | null = null

  /** Feed one finished move into the tracker. */
  record(input: TrackerInput): TrackerEvent {
    const weakGroups = findOwnWeakGroups(input.boardBefore, input.color)
    const atariGroups = weakGroups.filter(
      (group) => getGroup(input.boardBefore, group[0]).liberties.length === 1
    )

    const answeredDanger = weakGroups.some((group) =>
      respondsToGroup(input.point, group, input.boardBefore)
    )

    let type: MoveType = 'neutral'
    if (input.captured.length > 0) type = 'capture'
    else if (input.atariTargets.length > 0) type = 'atari'
    else if (answeredDanger) type = 'defend'
    else if (touchesEnemy(input.point, input.boardBefore, input.color)) type = 'attack'

    const event: TrackerEvent = {
      moveNumber: input.moveNumber,
      point: input.point,
      label: labelOf(input.point),
      color: input.color,
      type,
      captured: input.captured.length,
      atariGroups: input.atariTargets.length,
      liberties: input.liberties
    }
    this.events.push(event)

    this.updateChaseChain(event)
    this.updateDanger(input, weakGroups, atariGroups, answeredDanger)
    this.updateBalance()
    this.updateSameArea()

    this.awareness = {
      sawTheCapture: input.missedCapture,
      sawTheDanger: answeredDanger,
      choseOptimal: input.quality === 'excellent' || input.quality === 'good'
    }

    return event
  }

  private updateChaseChain(event: TrackerEvent) {
    if (event.type === 'atari') {
      if (this.chaseChainLength === 0) this.chaseChainStart = event.moveNumber
      this.chaseChainLength += 1
      this.detections.atariPositions.push(event.label)
    } else {
      this.chaseChainLength = 0
      this.chaseChainStart = null
      this.detections.atariPositions = []
    }

    this.detections.isRepeatingAtari = this.chaseChainLength >= ATARI_CHAIN_THRESHOLD
    this.detections.isChasingTooLong = this.chaseChainLength > CHASE_TOO_LONG
  }

  private updateDanger(
    input: TrackerInput,
    weakGroups: Point[][],
    atariGroups: Point[][],
    answeredDanger: boolean
  ) {
    this.dangerGroups = weakGroups

    if (weakGroups.length > 0 && !answeredDanger) {
      this.detections.isIgnoringDanger = true
      this.detections.ignoredDangerCount += 1
    }

    this.detections.tenukiWhenInAtari =
      atariGroups.length > 0 &&
      !atariGroups.some((group) => respondsToGroup(input.point, group, input.boardBefore))
  }

  private updateBalance() {
    const recent = this.events.slice(-BALANCE_WINDOW)
    if (recent.length < BALANCE_WINDOW) {
      this.detections.isAlwaysDefending = false
      this.detections.isAlwaysAttacking = false
      return
    }

    const attacks = recent.filter(
      (event) => event.type === 'attack' || event.type === 'atari' || event.type === 'capture'
    ).length
    const defends = recent.filter((event) => event.type === 'defend').length

    this.detections.isAlwaysDefending = defends >= BALANCE_WINDOW - 1 && attacks === 0
    this.detections.isAlwaysAttacking = attacks >= BALANCE_WINDOW - 1 && defends === 0
  }

  private updateSameArea() {
    const recent = this.events.slice(-SAME_AREA_WINDOW)
    if (recent.length < SAME_AREA_WINDOW) {
      this.detections.sameAreaPersistence = recent.length
      this.sameAreaCenter = null
      return
    }

    const xs = recent.map((event) => event.point.x)
    const ys = recent.map((event) => event.point.y)
    const spanX = Math.max(...xs) - Math.min(...xs)
    const spanY = Math.max(...ys) - Math.min(...ys)

    if (spanX <= 1 && spanY <= 1) {
      this.detections.sameAreaPersistence = SAME_AREA_WINDOW
      this.sameAreaCenter = {
        x: Math.round(xs.reduce((sum, value) => sum + value, 0) / xs.length),
        y: Math.round(ys.reduce((sum, value) => sum + value, 0) / ys.length)
      }
    } else {
      this.detections.sameAreaPersistence = 0
      this.sameAreaCenter = null
    }
  }

  /** Plain-object snapshot for reactive UI and for the LLM payload. */
  snapshot(): SessionTracker {
    const last = this.events[this.events.length - 1]
    return {
      consecutiveActions: {
        lastMoveType: last?.type ?? 'none',
        count: this.chaseChainLength,
        positions: [...this.detections.atariPositions]
      },
      detections: { ...this.detections },
      awareness: { ...this.awareness },
      chaseChainStart: this.chaseChainStart,
      chaseChainLength: this.chaseChainLength,
      dangerGroups: this.dangerGroups.map((group) => [...group]),
      dangerLabels: this.dangerGroups.map((group) => group.map(labelOf)),
      sameAreaCenter: this.sameAreaCenter ? { ...this.sameAreaCenter } : null,
      totalMoves: this.events.length
    }
  }

  reset() {
    this.events.length = 0
    this.chaseChainStart = null
    this.chaseChainLength = 0
    this.dangerGroups = []
    this.sameAreaCenter = null
    this.detections = {
      isRepeatingAtari: false,
      atariPositions: [],
      isChasingTooLong: false,
      isIgnoringDanger: false,
      ignoredDangerCount: 0,
      isAlwaysDefending: false,
      isAlwaysAttacking: false,
      sameAreaPersistence: 0,
      tenukiWhenInAtari: false
    }
    this.awareness = { sawTheCapture: false, sawTheDanger: false, choseOptimal: false }
  }
}

/** An empty tracker snapshot — used before the first move of a game. */
export function emptyTrackerSnapshot(): SessionTracker {
  return new Tracker().snapshot()
}
