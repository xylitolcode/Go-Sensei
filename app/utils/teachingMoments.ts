import {
  getAtariGroups,
  getGroup,
  pointToLabel,
  type Board,
  type StoneColor
} from './goRules'
import type { BoardAnnotation, BoardHighlight } from './mentor'
import type { SessionTracker } from './sessionTracker'
import type { ProfileDigest } from './profile'

export type TeachingMomentType =
  | 'tenuki-when-in-atari'
  | 'ignoring-danger'
  | 'chasing-too-long'
  | 'repeating-atari'
  | 'always-attacking'
  | 'always-defending'

export interface TeachingMoment {
  type: TeachingMomentType
  title: string
  explanation: string
  suggestion: string
  highlights: BoardHighlight[]
  annotations: BoardAnnotation[]
}

export interface TeachingMomentContext {
  board: Board
  tracker: SessionTracker
  color: StoneColor
  moveLabel: string
  profile?: ProfileDigest
}

const ENEMY: Record<StoneColor, StoneColor> = { black: 'white', white: 'black' }

function groupLabels(board: Board, stones: { x: number; y: number }[]): string {
  return stones.map((stone) => pointToLabel(stone)).join('、')
}

/** Liberty count of the group the stone belongs to. */
function libertiesOf(board: Board, stone: { x: number; y: number }): number {
  return getGroup(board, stone).liberties.length
}

/**
 * Turns the cross-move patterns detected by the tracker into a "teaching moment":
 * a named situation, an explanation and something concrete to try next time.
 */
export function detectTeachingMoment(
  context: TeachingMomentContext
): TeachingMoment | null {
  const { board, tracker, color } = context
  const { detections } = tracker
  const enemy = ENEMY[color]

  if (detections.tenukiWhenInAtari) {
    const stones = tracker.dangerGroups.flat()
    const atariStones = tracker.dangerGroups.filter(
      (group) => libertiesOf(board, group[0]) === 1
    )
    const targets = atariStones.length > 0 ? atariStones.flat() : stones
    return {
      type: 'tenuki-when-in-atari',
      title: '你被叫吃了，却下到了别处',
      explanation:
        '你自己有棋只剩一口气了——这叫「叫吃」，对方下一手就能把它提走。可你这一手离它远远的，等于把这颗子送掉了。',
      suggestion:
        '先救自己的棋：要么堵住对方下一手的位置，要么自己长一口气。自己的棋活了，才轮到别人。',
      highlights: [
        ...targets.map((stone) => ({
          point: pointToLabel(stone),
          type: 'danger' as const,
          label: '只剩1气'
        })),
        { point: context.moveLabel, type: 'neutral' as const, label: '脱先了' }
      ],
      annotations: targets.map((stone) => ({
        point: pointToLabel(stone),
        text: '气=1',
        style: 'number' as const
      }))
    }
  }

  if (detections.isIgnoringDanger && tracker.dangerGroups.length > 0) {
    const groups = tracker.dangerGroups
    const labels = groups.map((group) => groupLabels(board, group)).join('、')
    return {
      type: 'ignoring-danger',
      title: '你自己的棋快没气了，你知道吗',
      explanation: `${labels} 这块只剩一两口气，处在危险里。你这一手却下在了别的地方。`,
      suggestion:
        '危险棋先处理。哪怕暂时没活路，先长一口气，也比丢在那儿不管强。下一手先看看自己的棋。',
      highlights: [
        ...groups.flat().map((stone) => ({
          point: pointToLabel(stone),
          type: 'danger' as const,
          label: '危险'
        })),
        { point: context.moveLabel, type: 'neutral' as const, label: '没理会' }
      ],
      annotations: groups.map((group) => ({
        point: pointToLabel(group[0]),
        text: `气=${libertiesOf(board, group[0])}`,
        style: 'number' as const
      }))
    }
  }

  if (detections.isChasingTooLong) {
    const chain = tracker.chaseChainLength
    const start = tracker.chaseChainStart ?? context.moveLabel
    return {
      type: 'chasing-too-long',
      title: `追了 ${chain} 手了，该放手了`,
      explanation: `你从第 ${start} 手开始就一直追我这颗子，连着打了 ${chain} 手。可我每手都逃得掉，你的子反而越拉越薄。`,
      suggestion:
        '判断征子能不能成立有个前提：对方再逃一手，你还堵得住吗？堵不住，就该换地方——把追不到的地方先占住，那也是你的地。',
      highlights: [
        ...tracker.consecutiveActions.positions.map((point) => ({
          point,
          type: 'opportunity' as const,
          label: '追子'
        })),
        { point: context.moveLabel, type: 'neutral' as const, label: '还在追' }
      ],
      annotations: []
    }
  }

  if (detections.isRepeatingAtari) {
    const chain = tracker.chaseChainLength
    const start = tracker.chaseChainStart ?? context.moveLabel
    return {
      type: 'repeating-atari',
      title: '你一直在追同一颗子',
      explanation: `从第 ${start} 手开始，你连着 ${chain} 手都在打吃我这颗子。这有个名字，叫「征子」。`,
      suggestion:
        '征子成不成立有个前提：我每逃一手，你还能继续堵。来，你说说，如果我往这边逃，你还堵得住吗？堵不住就该收手了。',
      highlights: [
        ...tracker.consecutiveActions.positions.map((point) => ({
          point,
          type: 'opportunity' as const,
          label: '打吃'
        })),
        { point: context.moveLabel, type: 'neutral' as const, label: '继续追' }
      ],
      annotations: []
    }
  }

  if (detections.isAlwaysAttacking) {
    const weak = getAtariGroups(board, color)
    return {
      type: 'always-attacking',
      title: '你攻势很猛，但自己快顾不上了',
      explanation:
        '最近 5 手你全是进攻，没有一手在照顾自己的棋。攻守是一体的，只攻不守容易反过来被反吃。',
      suggestion:
        '下一手先扫一眼自己的棋：有没有哪块只剩一两口气需要补？先补一手，再决定要不要继续攻。',
      highlights: [
        ...weak.flatMap((group) =>
          group.stones.map((stone) => ({
            point: pointToLabel(stone),
            type: 'danger' as const,
            label: '你的薄棋'
          }))
        ),
        { point: context.moveLabel, type: 'neutral' as const, label: '只攻' }
      ],
      annotations: []
    }
  }

  if (detections.isAlwaysDefending) {
    const weak = getAtariGroups(board, enemy)
    return {
      type: 'always-defending',
      title: '防守意识很好，但该想想进攻了',
      explanation:
        '最近 5 手你一直在救自己的棋，一手进攻都没有。安全是好事，可围棋比的是最后围到多少地。',
      suggestion:
        '看看棋盘上有没有空着、没人管的大片区域——那些也是你的得分。救完棋，顺手也去占一块。',
      highlights: [
        ...weak.flatMap((group) =>
          group.stones.map((stone) => ({
            point: pointToLabel(stone),
            type: 'opportunity' as const,
            label: '可以打吃'
          }))
        ),
        { point: context.moveLabel, type: 'neutral' as const, label: '只守' }
      ],
      annotations: []
    }
  }

  return null
}
