<script setup lang="ts">
import Stone from './Stone.vue'
import { labelToPoint, type Point } from '~/utils/goRules'
import type {
  BoardAnnotation,
  BoardHighlight,
  DemoMove,
  HighlightType
} from '~/utils/mentor'
import type { BoardInsight, Urgency } from '~/utils/boardInsight'
import type { KatagoMove } from '~/utils/katago'

interface BoardStone {
  x: number
  y: number
  color: 'black' | 'white'
}

const props = withDefaults(
  defineProps<{
    stones?: BoardStone[]
    lastMove?: { x: number; y: number } | null
    nextColor?: 'black' | 'white'
    disabled?: boolean
    highlights?: BoardHighlight[]
    annotations?: BoardAnnotation[]
    demoMove?: DemoMove | null
    /** Whole-position read from the local engine, rendered as a live overlay. */
    insight?: BoardInsight | null
    overlays?: { liberties: boolean; territory: boolean; candidates: boolean; engine: boolean }
    /** Coordinates the model asked us to circle (whitelist-checked server-side). */
    focusPoints?: string[]
    /** 169 KataGo ownership values (index y*13+x), positive == black. */
    ownership?: number[] | null
    /** Ranked moves from a real KataGo MCTS search. */
    engineMoves?: KatagoMove[]
  }>(),
  {
    stones: () => [],
    lastMove: null,
    nextColor: 'black',
    disabled: false,
    highlights: () => [],
    annotations: () => [],
    demoMove: null,
    insight: null,
    overlays: () => ({ liberties: true, territory: false, candidates: true, engine: false }),
    focusPoints: () => [],
    ownership: null,
    engineMoves: () => []
  }
)

const emit = defineEmits<{
  (e: 'intersect', point: { x: number; y: number; label: string }): void
}>()

const SIZE = 13
const CELL = 40
const PAD = 46
const EXTENT = CELL * (SIZE - 1)
const VIEW = EXTENT + PAD * 2
const RADIUS = 18

const LETTERS = 'ABCDEFGHIJKLM'.split('')
const NUMBERS = Array.from({ length: SIZE }, (_, i) => SIZE - i)
const INDICES = Array.from({ length: SIZE }, (_, i) => i)

const STAR_POINTS = [
  [3, 3],
  [9, 3],
  [6, 6],
  [3, 9],
  [9, 9]
] as const

const hovered = ref<{ x: number; y: number } | null>(null)

const toPx = (index: number) => PAD + index * CELL
const rowLabel = (y: number) => SIZE - y
const pointLabel = (x: number, y: number) => `${LETTERS[x]}${rowLabel(y)}`

const stoneMap = computed(() => {
  const map = new Map<string, 'black' | 'white'>()
  for (const stone of props.stones) map.set(`${stone.x},${stone.y}`, stone.color)
  return map
})

const hoverLabel = computed(() =>
  hovered.value ? pointLabel(hovered.value.x, hovered.value.y) : null
)

const hoverIsEmpty = computed(() => {
  if (!hovered.value) return false
  return !stoneMap.value.has(`${hovered.value.x},${hovered.value.y}`)
})

const resolvedHighlights = computed(() => {
  const list: { pos: Point; type: HighlightType; label?: string; key: string }[] = []
  props.highlights.forEach((highlight, index) => {
    const pos = labelToPoint(highlight.point)
    if (pos) {
      list.push({
        pos,
        type: highlight.type,
        label: highlight.label,
        key: `${highlight.point}-${index}`
      })
    }
  })
  return list
})

const resolvedAnnotations = computed(() => {
  const list: {
    pos: Point
    to?: Point
    text: string
    style: BoardAnnotation['style']
    key: string
  }[] = []
  props.annotations.forEach((annotation, index) => {
    const pos = labelToPoint(annotation.point)
    if (!pos) return
    list.push({
      pos,
      to: annotation.to ? labelToPoint(annotation.to) ?? undefined : undefined,
      text: annotation.text,
      style: annotation.style,
      key: `${annotation.point}-${annotation.style}-${index}`
    })
  })
  return list
})

/** KataGo ownership: draw only intersections with a confident predicted owner. */
const ownershipCells = computed(() => {
  const values = props.ownership
  if (!values || values.length < SIZE * SIZE) return []
  const cells: { x: number; y: number; value: number; key: string }[] = []
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const value = values[y * SIZE + x] ?? 0
      if (Math.abs(value) < 0.3) continue
      cells.push({ x, y, value, key: `own-${x}-${y}` })
    }
  }
  return cells
})

const engineMoveMarkers = computed(() =>
  (props.engineMoves ?? [])
    .slice(0, 3)
    .map((move, index) => {
      const pos = labelToPoint(move.label)
      return pos
        ? { pos, winrate: move.winrate, index, key: `eng-${move.label}-${index}` }
        : null
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
)

const resolvedDemo = computed(() => {
  if (!props.demoMove) return null
  const pos = labelToPoint(props.demoMove.point)
  if (!pos) return null
  return { pos, ...props.demoMove }
})

const demoArrow = computed(() => {
  if (!resolvedDemo.value || !props.lastMove) return null
  return arrowFromTo(props.lastMove, resolvedDemo.value.pos)
})

const LIBERTY_COLOR: Record<Urgency, string> = {
  critical: '#dc2626',
  warning: '#ea580c',
  safe: '#0f766e'
}
const RANK_COLOR = ['#2563eb', '#7c3aed', '#64748b']

const resolvedCandidates = computed(() => {
  const list: { label: string; score: number; pos: Point; rank: number }[] = []
  ;(props.insight?.candidates ?? []).forEach((candidate, rank) => {
    const pos = labelToPoint(candidate.label)
    if (pos) list.push({ label: candidate.label, score: candidate.score, pos, rank })
  })
  return list
})

const resolvedFocus = computed(() => {
  const list: { pos: Point; key: string }[] = []
  props.focusPoints.forEach((label, index) => {
    const pos = labelToPoint(label)
    if (pos) list.push({ pos, key: `${label}-${index}` })
  })
  return list
})

function arrowFromTo(from: Point, to: Point) {
  const x1 = toPx(from.x)
  const y1 = toPx(from.y)
  const x2 = toPx(to.x)
  const y2 = toPx(to.y)
  const dx = x2 - x1
  const dy = y2 - y1
  const length = Math.hypot(dx, dy) || 1
  const ux = dx / length
  const uy = dy / length
  const offset = RADIUS + 6
  return {
    x1: x1 + ux * offset,
    y1: y1 + uy * offset,
    x2: x2 - ux * offset,
    y2: y2 - uy * offset
  }
}

function labelY(pos: Point) {
  const base = toPx(pos.y) - RADIUS - 16
  return base < PAD - 12 ? toPx(pos.y) + RADIUS + 30 : base
}

function badgeWidth(text: string) {
  return Math.max(34, text.length * 10 + 12)
}

function handleClick(x: number, y: number) {
  if (props.disabled) return
  emit('intersect', { x, y, label: pointLabel(x, y) })
}
</script>

<template>
  <div class="relative w-full">
    <svg
      :viewBox="`0 0 ${VIEW} ${VIEW}`"
      class="board-svg block w-full select-none"
      role="group"
      aria-label="Go board, 13 by 13"
    >
      <defs>
        <linearGradient id="wood" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#f2d29a" />
          <stop offset="45%" stop-color="#e8bf7d" />
          <stop offset="100%" stop-color="#d9a954" />
        </linearGradient>
        <radialGradient id="stone-black" cx="35%" cy="30%" r="80%">
          <stop offset="0%" stop-color="#6b7280" />
          <stop offset="45%" stop-color="#1f2937" />
          <stop offset="100%" stop-color="#020617" />
        </radialGradient>
        <radialGradient id="stone-white" cx="35%" cy="30%" r="85%">
          <stop offset="0%" stop-color="#ffffff" />
          <stop offset="60%" stop-color="#f7f3ea" />
          <stop offset="100%" stop-color="#d8d1c2" />
        </radialGradient>
        <marker
          id="demo-arrow-head"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#2563eb" />
        </marker>
      </defs>

      <!-- Board surface -->
      <rect
        x="8"
        y="8"
        :width="VIEW - 16"
        :height="VIEW - 16"
        rx="16"
        fill="url(#wood)"
        stroke="rgba(120, 78, 22, 0.45)"
        stroke-width="1.5"
      />

      <!-- Subtle wood grain -->
      <g stroke="rgba(146, 98, 30, 0.14)" fill="none" stroke-width="1.4">
        <path d="M 22 120 C 150 104, 300 140, 550 116" />
        <path d="M 22 250 C 180 232, 340 274, 550 246" />
        <path d="M 22 392 C 160 372, 330 414, 550 384" />
        <path d="M 22 478 C 190 462, 360 496, 550 470" />
      </g>

      <!-- Grid lines -->
      <g stroke="#4a3418" stroke-width="1.25" stroke-linecap="square">
        <line
          v-for="i in INDICES"
          :key="`v-${i}`"
          :x1="toPx(i)"
          :y1="PAD"
          :x2="toPx(i)"
          :y2="PAD + EXTENT"
        />
        <line
          v-for="i in INDICES"
          :key="`h-${i}`"
          :x1="PAD"
          :y1="toPx(i)"
          :x2="PAD + EXTENT"
          :y2="toPx(i)"
        />
      </g>

      <!-- Star points -->
      <g fill="#3f2d12">
        <circle
          v-for="([x, y], i) in STAR_POINTS"
          :key="`star-${i}`"
          :cx="toPx(x)"
          :cy="toPx(y)"
          r="4"
        />
      </g>

      <!-- Coordinate labels -->
      <g fill="#5a4019" font-size="16" font-weight="600" font-family="Inter, sans-serif">
        <text
          v-for="(letter, x) in LETTERS"
          :key="`top-${letter}`"
          :x="toPx(x)"
          :y="PAD - 22"
          text-anchor="middle"
        >
          {{ letter }}
        </text>
        <text
          v-for="(letter, x) in LETTERS"
          :key="`bottom-${letter}`"
          :x="toPx(x)"
          :y="PAD + EXTENT + 32"
          text-anchor="middle"
        >
          {{ letter }}
        </text>
        <text
          v-for="(n, y) in NUMBERS"
          :key="`left-${n}`"
          :x="PAD - 26"
          :y="toPx(y)"
          text-anchor="middle"
          dominant-baseline="middle"
        >
          {{ n }}
        </text>
        <text
          v-for="(n, y) in NUMBERS"
          :key="`right-${n}`"
          :x="PAD + EXTENT + 26"
          :y="toPx(y)"
          text-anchor="middle"
          dominant-baseline="middle"
        >
          {{ n }}
        </text>
      </g>

      <!-- Live influence map: empty points claimed by either side -->
      <g v-if="props.overlays.territory && insight" class="pointer-events-none">
        <circle
          v-for="cell in insight.territory"
          :key="`terr-${cell.x}-${cell.y}`"
          :cx="toPx(cell.x)"
          :cy="toPx(cell.y)"
          r="15"
          :fill="cell.color === 'black' ? 'rgba(31, 41, 55, 0.17)' : 'rgba(255, 255, 255, 0.52)'"
          :stroke="cell.color === 'black' ? 'rgba(31, 41, 55, 0.22)' : 'rgba(120, 110, 92, 0.32)'"
          stroke-width="1"
        />
      </g>

      <!-- KataGo ownership: real MCTS territory prediction, square cells so it
           is visually distinct from the local heuristic influence circles -->
      <g v-if="props.overlays.engine && ownershipCells.length" class="pointer-events-none">
        <rect
          v-for="cell in ownershipCells"
          :key="cell.key"
          :x="toPx(cell.x) - CELL / 2 + 2"
          :y="toPx(cell.y) - CELL / 2 + 2"
          :width="CELL - 4"
          :height="CELL - 4"
          rx="6"
          :fill="cell.value > 0 ? '#1e3a5f' : '#d97706'"
          :opacity="Math.min(0.5, Math.abs(cell.value) * 0.5)"
        />
      </g>

      <!-- Hover ghost stone -->
      <g v-if="hovered && hoverIsEmpty && !disabled" class="ghost">
        <circle
          :cx="toPx(hovered.x)"
          :cy="toPx(hovered.y)"
          :r="RADIUS"
          :fill="nextColor === 'black' ? 'rgba(17, 24, 39, 0.25)' : 'rgba(255, 255, 255, 0.55)'"
          :stroke="nextColor === 'black' ? 'rgba(17, 24, 39, 0.5)' : 'rgba(120, 110, 92, 0.7)'"
          stroke-width="1.5"
        />
      </g>

      <!-- Stones -->
      <Stone
        v-for="stone in stones"
        :key="`stone-${stone.x}-${stone.y}`"
        :cx="toPx(stone.x)"
        :cy="toPx(stone.y)"
        :color="stone.color"
        :r="RADIUS"
      />

      <!-- Live liberties: a badge on every group, pulsing rings on 1-liberty groups -->
      <g v-if="props.overlays.liberties && insight" class="pointer-events-none">
        <g v-for="group in insight.groups" :key="`grp-${group.label}`">
          <template v-if="group.urgency === 'critical'">
            <circle
              v-for="stone in group.stones"
              :key="`crit-${stone.x}-${stone.y}`"
              :cx="toPx(stone.x)"
              :cy="toPx(stone.y)"
              :r="RADIUS + 4"
              fill="none"
              stroke="#dc2626"
              stroke-width="2"
              class="lib-critical"
            />
          </template>
          <circle
            :cx="toPx(group.anchor.x) + 13"
            :cy="toPx(group.anchor.y) - 13"
            r="8.5"
            :fill="LIBERTY_COLOR[group.urgency]"
            stroke="#fffaf0"
            stroke-width="1.4"
          />
          <text
            :x="toPx(group.anchor.x) + 13"
            :y="toPx(group.anchor.y) - 13"
            text-anchor="middle"
            dominant-baseline="central"
            fill="#fff"
            font-size="10"
            font-weight="700"
          >
            {{ group.liberties }}
          </text>
        </g>
      </g>

      <!-- AI candidate moves, ranked by the local engine -->
      <g v-if="props.overlays.candidates" class="pointer-events-none">
        <g v-for="candidate in resolvedCandidates" :key="`cand-${candidate.label}`">
          <circle
            :cx="toPx(candidate.pos.x)"
            :cy="toPx(candidate.pos.y)"
            :r="RADIUS - 1"
            fill="none"
            :stroke="RANK_COLOR[candidate.rank] ?? RANK_COLOR[2]"
            stroke-width="2.4"
            stroke-dasharray="4 3"
          />
          <circle
            :cx="toPx(candidate.pos.x)"
            :cy="toPx(candidate.pos.y)"
            r="9"
            :fill="RANK_COLOR[candidate.rank] ?? RANK_COLOR[2]"
          />
          <text
            :x="toPx(candidate.pos.x)"
            :y="toPx(candidate.pos.y)"
            text-anchor="middle"
            dominant-baseline="central"
            fill="#fff"
            font-size="10"
            font-weight="700"
          >
            {{ candidate.rank + 1 }}
          </text>
          <text
            :x="toPx(candidate.pos.x)"
            :y="toPx(candidate.pos.y) + RADIUS + 13"
            text-anchor="middle"
            :fill="RANK_COLOR[candidate.rank] ?? RANK_COLOR[2]"
            font-size="10"
            font-weight="700"
            class="candidate-score"
          >
            {{ candidate.score }} 分
          </text>
        </g>
      </g>

      <!-- KataGo search results: ranked by real visits, labelled with winrate -->
      <g v-if="props.overlays.engine && engineMoveMarkers.length" class="pointer-events-none">
        <g v-for="move in engineMoveMarkers" :key="move.key">
          <circle
            :cx="toPx(move.pos.x)"
            :cy="toPx(move.pos.y)"
            :r="RADIUS + 3"
            fill="none"
            stroke="#0f766e"
            stroke-width="3"
          />
          <circle :cx="toPx(move.pos.x)" :cy="toPx(move.pos.y)" r="10" fill="#0f766e" />
          <text
            :x="toPx(move.pos.x)"
            :y="toPx(move.pos.y)"
            text-anchor="middle"
            dominant-baseline="central"
            fill="#fff"
            font-size="10"
            font-weight="700"
          >
            {{ move.index + 1 }}
          </text>
          <text
            :x="toPx(move.pos.x)"
            :y="toPx(move.pos.y) + RADIUS + 13"
            text-anchor="middle"
            fill="#0f766e"
            font-size="10"
            font-weight="700"
          >
            K {{ Math.round(move.winrate * 100) }}%
          </text>
        </g>
      </g>

      <!-- Model-selected points: the LLM can now drive the board, not just the chat -->
      <g v-if="resolvedFocus.length" class="pointer-events-none">
        <g v-for="focus in resolvedFocus" :key="`focus-${focus.key}`">
          <circle
            :cx="toPx(focus.pos.x)"
            :cy="toPx(focus.pos.y)"
            :r="RADIUS + 9"
            fill="none"
            stroke="#7c3aed"
            stroke-width="2.6"
            stroke-dasharray="3 4"
            class="focus-ring"
          />
          <text
            :x="toPx(focus.pos.x)"
            :y="labelY(focus.pos)"
            text-anchor="middle"
            class="focus-label"
          >
            AI 关注
          </text>
        </g>
      </g>

      <!-- Last move marker -->
      <circle
        v-if="lastMove"
        :cx="toPx(lastMove.x)"
        :cy="toPx(lastMove.y)"
        :r="RADIUS + 3.5"
        fill="none"
        stroke="#f97316"
        stroke-width="2.5"
      />

      <!-- Mentor highlights -->
      <g class="pointer-events-none">
        <g v-for="highlight in resolvedHighlights" :key="`hl-${highlight.key}`">
          <circle
            :cx="toPx(highlight.pos.x)"
            :cy="toPx(highlight.pos.y)"
            :r="RADIUS + 6"
            fill="none"
            :class="['hl', `hl--${highlight.type}`]"
            :data-highlight="highlight.type"
          />
          <text
            v-if="highlight.label"
            :x="toPx(highlight.pos.x)"
            :y="labelY(highlight.pos)"
            text-anchor="middle"
            class="hl-label"
            :data-highlight-label="highlight.label"
          >
            {{ highlight.label }}
          </text>
        </g>
      </g>

      <!-- Mentor annotations -->
      <g class="pointer-events-none">
        <g v-for="annotation in resolvedAnnotations" :key="`an-${annotation.key}`">
          <circle
            v-if="annotation.style === 'circle'"
            :cx="toPx(annotation.pos.x)"
            :cy="toPx(annotation.pos.y)"
            :r="RADIUS + 10"
            fill="none"
            stroke="#0f766e"
            stroke-width="2"
            stroke-dasharray="4 4"
          />
          <g v-else-if="annotation.style === 'cross'" stroke="#dc2626" stroke-width="3" stroke-linecap="round">
            <line
              :x1="toPx(annotation.pos.x) - 11"
              :y1="toPx(annotation.pos.y) - 11"
              :x2="toPx(annotation.pos.x) + 11"
              :y2="toPx(annotation.pos.y) + 11"
            />
            <line
              :x1="toPx(annotation.pos.x) + 11"
              :y1="toPx(annotation.pos.y) - 11"
              :x2="toPx(annotation.pos.x) - 11"
              :y2="toPx(annotation.pos.y) + 11"
            />
          </g>
          <g v-else-if="annotation.style === 'arrow' && annotation.to" class="annotation-arrow">
            <line
              v-bind="arrowFromTo(annotation.pos, annotation.to)"
              stroke="#2563eb"
              stroke-width="1.8"
              stroke-dasharray="5 5"
              marker-end="url(#demo-arrow-head)"
            />
            <text
              :x="(toPx(annotation.pos.x) + toPx(annotation.to.x)) / 2"
              :y="(toPx(annotation.pos.y) + toPx(annotation.to.y)) / 2 - 8"
              text-anchor="middle"
              class="hl-label"
            >
              {{ annotation.text }}
            </text>
          </g>
          <g v-else-if="annotation.style === 'number'" class="annotation-badge">
            <rect
              :x="toPx(annotation.pos.x) - badgeWidth(annotation.text) / 2"
              :y="toPx(annotation.pos.y) + RADIUS + 4"
              :width="badgeWidth(annotation.text)"
              height="18"
              rx="9"
              fill="rgba(31, 41, 55, 0.9)"
            />
            <text
              :x="toPx(annotation.pos.x)"
              :y="toPx(annotation.pos.y) + RADIUS + 17"
              text-anchor="middle"
              fill="#fdf8ee"
              font-size="11"
              font-weight="600"
            >
              {{ annotation.text }}
            </text>
          </g>
          <text
            v-else
            :x="toPx(annotation.pos.x)"
            :y="labelY(annotation.pos)"
            text-anchor="middle"
            class="hl-label"
          >
            {{ annotation.text }}
          </text>
        </g>
      </g>

      <!-- Demo "shadow" move -->
      <g v-if="resolvedDemo" class="pointer-events-none demo-layer">
        <line
          v-if="demoArrow"
          v-bind="demoArrow"
          stroke="#2563eb"
          stroke-width="2"
          stroke-dasharray="6 6"
          marker-end="url(#demo-arrow-head)"
          class="demo-arrow"
        />
        <g :opacity="resolvedDemo.opacity" class="demo-stone">
          <Stone
            :cx="toPx(resolvedDemo.pos.x)"
            :cy="toPx(resolvedDemo.pos.y)"
            :color="resolvedDemo.color"
            :r="RADIUS"
          />
        </g>
        <circle
          :cx="toPx(resolvedDemo.pos.x)"
          :cy="toPx(resolvedDemo.pos.y)"
          :r="RADIUS + 5"
          fill="none"
          stroke="#2563eb"
          stroke-width="2"
          stroke-dasharray="6 5"
          class="demo-ring"
        />
        <text
          :x="toPx(resolvedDemo.pos.x)"
          :y="labelY(resolvedDemo.pos)"
          text-anchor="middle"
          class="demo-label"
        >
          {{ resolvedDemo.label }}
        </text>
      </g>

      <!-- Click targets -->
      <g>
        <template v-for="(row, y) in NUMBERS" :key="`row-${row}`">
          <circle
            v-for="(letter, x) in LETTERS"
            :key="`hit-${x}-${y}`"
            :cx="toPx(x)"
            :cy="toPx(y)"
            :r="CELL / 2"
            fill="transparent"
            class="hit"
            :class="{ 'hit--busy': disabled }"
            :style="{ cursor: disabled ? 'default' : 'pointer' }"
            :data-point="pointLabel(x, y)"
            @click="handleClick(x, y)"
            @mouseenter="hovered = { x, y }"
            @mouseleave="hovered = null"
          >
            <title>{{ pointLabel(x, y) }}</title>
          </circle>
        </template>
      </g>
    </svg>

    <p
      class="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-stone-900/80 px-3 py-1 text-xs font-medium text-amber-50 shadow-sm transition-opacity duration-150"
      :class="hoverLabel ? 'opacity-100' : 'opacity-0'"
    >
      {{ hoverLabel ?? '' }}
    </p>
  </div>
</template>

<style scoped>
.board-svg {
  touch-action: manipulation;
  filter: drop-shadow(0 18px 28px rgba(88, 60, 20, 0.18));
}

.hit {
  transition: fill 120ms ease;
}

.hit:hover {
  fill: rgba(255, 255, 255, 0.16);
}

.hit--busy:hover {
  fill: transparent;
}

.hl {
  stroke-width: 3;
  transform-box: fill-box;
  transform-origin: center;
}

.hl--good {
  stroke: #16a34a;
}

.hl--bad {
  stroke: #dc2626;
}

.hl--danger {
  stroke: #f97316;
  animation: danger-pulse 2.2s ease-in-out infinite;
}

.hl--opportunity {
  stroke: #eab308;
}

.hl--comparison {
  stroke: #2563eb;
  stroke-dasharray: 7 5;
  animation: dash-flow 7s linear infinite;
}

.hl--neutral {
  stroke: #78716c;
  stroke-width: 2;
}

.hl--insight {
  stroke: #7c3aed;
  stroke-width: 3;
  stroke-dasharray: 5 4;
  animation: dash-flow 5s linear infinite;
}

.lib-critical {
  transform-box: fill-box;
  transform-origin: center;
  animation: danger-pulse 1.6s ease-in-out infinite;
}

.focus-ring {
  transform-box: fill-box;
  transform-origin: center;
  animation: focus-breathe 2.4s ease-in-out infinite;
}

.focus-label {
  font-size: 11px;
  font-weight: 700;
  fill: #6d28d9;
  paint-order: stroke;
  stroke: rgba(255, 248, 235, 0.95);
  stroke-width: 4px;
  stroke-linejoin: round;
}

.candidate-score {
  paint-order: stroke;
  stroke: rgba(255, 248, 235, 0.92);
  stroke-width: 3px;
  stroke-linejoin: round;
}

@keyframes focus-breathe {
  0%,
  100% {
    opacity: 0.6;
    transform: scale(1);
  }
  50% {
    opacity: 1;
    transform: scale(1.06);
  }
}

.hl-label {
  font-size: 12px;
  font-weight: 600;
  fill: #292521;
  paint-order: stroke;
  stroke: rgba(255, 248, 235, 0.92);
  stroke-width: 4px;
  stroke-linejoin: round;
}

.annotation-arrow line {
  animation: dash-flow 3.5s linear infinite;
}

.demo-layer {
  transform-box: fill-box;
  transform-origin: center;
  animation: demo-life 3.4s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

.demo-label {
  font-size: 13px;
  font-weight: 700;
  fill: #1e40af;
  paint-order: stroke;
  stroke: rgba(255, 248, 235, 0.95);
  stroke-width: 4.5px;
  stroke-linejoin: round;
}

.demo-ring {
  animation: demo-ring 2.8s ease-in-out infinite;
}

@keyframes danger-pulse {
  0%,
  100% {
    opacity: 0.55;
    transform: scale(1);
  }
  50% {
    opacity: 1;
    transform: scale(1.05);
  }
}

@keyframes dash-flow {
  to {
    stroke-dashoffset: -96;
  }
}

@keyframes demo-life {
  0% {
    opacity: 0;
    transform: translateY(4px) scale(0.96);
  }
  10% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
  82% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}

@keyframes demo-ring {
  0%,
  100% {
    opacity: 0.75;
  }
  50% {
    opacity: 0.35;
  }
}
</style>
