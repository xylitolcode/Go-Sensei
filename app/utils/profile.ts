/**
 * Student profile: the long-lived memory of the tutor.
 *
 * Everything in this module is pure data + pure functions so it can be unit
 * tested; the Pinia store in `stores/profile.ts` owns persistence.
 */

export type SkillKey =
  | 'libertyAwareness'
  | 'captureInstinct'
  | 'connectionSense'
  | 'territoryConcept'
  | 'dangerDetection'
  | 'patienceLevel'
  | 'tenukiFrequency'

export type SkillScores = Record<SkillKey, number>

export type ConceptKey =
  | 'liberty'
  | 'capture'
  | 'atari'
  | 'territory'
  | 'connection'
  | 'shape'
  | 'rules'

export interface StudentProfile {
  totalGames: number
  totalMoves: number
  createdAt: string
  lastPlayedAt: string

  /** 0 = 纯新手, 100 = 业余 1 段。 */
  overallLevel: number

  skills: SkillScores

  habits: {
    favoriteOpenings: string[]
    tendsTo: string[]
    weaknesses: string[]
    recentImprovements: string[]
  }

  teachingProgress: {
    conceptsIntroduced: string[]
    conceptsMastered: string[]
    conceptsStruggling: string[]
    currentFocusArea: string
    skipConcepts: string[]
  }

  recentGames: GameSummary[]

  /** 导师对本阶段的自由文本总结。 */
  mentorNotes: string
}

export interface KeyMoment {
  move: string
  type: 'great' | 'mistake' | 'learning'
  note: string
}

export interface GameSummary {
  date: string
  moves: number
  result: 'win' | 'lose' | 'unfinished'
  keyMoments: KeyMoment[]
  conceptsPracticed: string[]
}

/** A patch the model may propose. Only whitelisted, clamped fields are applied. */
export interface ProfileUpdate {
  skills?: Partial<Record<SkillKey, number>>
  addTendency?: string
  addWeakness?: string
  addImprovement?: string
  addConcept?: string
  addConceptMastered?: string
  mentorNotes?: string
}

export const PROFILE_STORAGE_KEY = 'go-mentor-profile'

export const SKILL_LABELS: Record<SkillKey, string> = {
  libertyAwareness: '气意识',
  captureInstinct: '提子嗅觉',
  connectionSense: '连接意识',
  territoryConcept: '围地概念',
  dangerDetection: '危险感知',
  patienceLevel: '耐心',
  tenukiFrequency: '脱先倾向'
}

export const CONCEPT_LABELS: Record<ConceptKey, string> = {
  liberty: '气',
  capture: '提子',
  atari: '叫吃',
  territory: '围地',
  connection: '连接',
  shape: '棋形',
  rules: '规则'
}

const SKILL_KEYS = Object.keys(SKILL_LABELS) as SkillKey[]

export function createDefaultProfile(now = new Date().toISOString()): StudentProfile {
  return {
    totalGames: 0,
    totalMoves: 0,
    createdAt: now,
    lastPlayedAt: now,
    overallLevel: 0,
    skills: {
      libertyAwareness: 8,
      captureInstinct: 6,
      connectionSense: 6,
      territoryConcept: 4,
      dangerDetection: 8,
      patienceLevel: 10,
      tenukiFrequency: 2
    },
    habits: {
      favoriteOpenings: [],
      tendsTo: [],
      weaknesses: [],
      recentImprovements: []
    },
    teachingProgress: {
      conceptsIntroduced: [],
      conceptsMastered: [],
      conceptsStruggling: [],
      currentFocusArea: '气',
      skipConcepts: []
    },
    recentGames: [],
    mentorNotes: ''
  }
}

/** Maps a rule-engine reason onto the concept it teaches. */
export function conceptForReason(reason: string): ConceptKey {
  switch (reason) {
    case 'capture':
      return 'capture'
    case 'atari':
      return 'atari'
    case 'self-atari':
    case 'rescue':
      return 'liberty'
    case 'connection':
    case 'extension':
      return 'connection'
    case 'edge':
    case 'isolated':
      return 'shape'
    default:
      return 'shape'
  }
}

const SKILL_DELTAS: Record<string, Partial<SkillScores>> = {
  capture: { captureInstinct: 3 },
  atari: { captureInstinct: 2, dangerDetection: 1 },
  'self-atari': { dangerDetection: -2, libertyAwareness: -1 },
  rescue: { dangerDetection: 2, libertyAwareness: 1 },
  connection: { connectionSense: 2 },
  extension: { connectionSense: 1 },
  edge: { territoryConcept: -1 },
  isolated: { connectionSense: -1, patienceLevel: -1 },
  neutral: {}
}

/** Text used when a weakness / habit is recorded. */
export const WEAKNESS_LABELS: Record<string, string> = {
  'self-atari': '经常忽略自己的气',
  isolated: '总忘记连接，棋子落单',
  edge: '爱在一线落子，不容易围出地',
  atari: '看不太出叫吃的机会',
  capture: '常常错过眼前能提的子'
}

export const IMPROVEMENT_LABELS: Record<string, string> = {
  capture: '开始敢提子了',
  atari: '开始能看出叫吃',
  rescue: '知道先救自己的棋',
  connection: '会主动连接了',
  extension: '懂得往外长'
}

export function clampSkill(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function computeOverallLevel(skills: SkillScores): number {
  const total = SKILL_KEYS.reduce((sum, key) => sum + skills[key], 0)
  return clampSkill(total / SKILL_KEYS.length)
}

export function levelLabel(level: number): string {
  if (level < 20) return '刚入门'
  if (level < 35) return '初学者'
  if (level < 50) return '会几招了'
  if (level < 65) return '有点感觉'
  if (level < 80) return '入门高手'
  if (level < 90) return '接近业余1段'
  return '业余1段水平'
}

/** Applies a clamped skill delta set to a copy of the profile. */
export function applySkillDeltas(
  skills: SkillScores,
  deltas: Partial<SkillScores>
): SkillScores {
  const next = { ...skills }
  for (const key of SKILL_KEYS) {
    const delta = deltas[key]
    if (typeof delta !== 'number') continue
    next[key] = clampSkill(next[key] + Math.max(-3, Math.min(3, delta)))
  }
  return next
}

function pushUnique(list: string[], value: string, limit = 12): string[] {
  if (!value) return list
  if (list.includes(value)) return list
  return [...list, value].slice(-limit)
}

/**
 * Applies a model-proposed profile update. Unknown skills and wild numbers are
 * dropped, so a hallucinating model can only nudge the profile a little.
 */
export function applyProfileUpdate(profile: StudentProfile, update: ProfileUpdate): StudentProfile {
  const next: StudentProfile = {
    ...profile,
    skills: { ...profile.skills },
    habits: {
      ...profile.habits,
      favoriteOpenings: [...profile.habits.favoriteOpenings],
      tendsTo: [...profile.habits.tendsTo],
      weaknesses: [...profile.habits.weaknesses],
      recentImprovements: [...profile.habits.recentImprovements]
    },
    teachingProgress: {
      ...profile.teachingProgress,
      conceptsIntroduced: [...profile.teachingProgress.conceptsIntroduced],
      conceptsMastered: [...profile.teachingProgress.conceptsMastered],
      conceptsStruggling: [...profile.teachingProgress.conceptsStruggling],
      skipConcepts: [...profile.teachingProgress.skipConcepts]
    },
    recentGames: [...profile.recentGames]
  }

  if (update.skills) {
    next.skills = applySkillDeltas(next.skills, update.skills)
    next.overallLevel = computeOverallLevel(next.skills)
  }
  if (update.addTendency) {
    next.habits.tendsTo = pushUnique(next.habits.tendsTo, update.addTendency)
  }
  if (update.addWeakness) {
    next.habits.weaknesses = pushUnique(next.habits.weaknesses, update.addWeakness)
  }
  if (update.addImprovement) {
    next.habits.recentImprovements = pushUnique(next.habits.recentImprovements, update.addImprovement)
  }
  if (update.addConcept) {
    next.teachingProgress.conceptsIntroduced = pushUnique(
      next.teachingProgress.conceptsIntroduced,
      update.addConcept
    )
  }
  if (update.addConceptMastered) {
    next.teachingProgress.conceptsMastered = pushUnique(
      next.teachingProgress.conceptsMastered,
      update.addConceptMastered
    )
  }
  if (update.mentorNotes) {
    next.mentorNotes = update.mentorNotes
  }

  return next
}

/** A compact view of the profile for the model prompt. */
export interface ProfileDigest {
  totalGames: number
  totalMoves: number
  overallLevel: number
  levelLabel: string
  skills: SkillScores
  tendencies: string[]
  weaknesses: string[]
  recentImprovements: string[]
  conceptsIntroduced: string[]
  conceptsMastered: string[]
  conceptsStruggling: string[]
  currentFocusArea: string
  mentorNotes: string
}

export function digestProfile(profile: StudentProfile): ProfileDigest {
  return {
    totalGames: profile.totalGames,
    totalMoves: profile.totalMoves,
    overallLevel: profile.overallLevel,
    levelLabel: levelLabel(profile.overallLevel),
    skills: { ...profile.skills },
    tendencies: [...profile.habits.tendsTo],
    weaknesses: [...profile.habits.weaknesses],
    recentImprovements: [...profile.habits.recentImprovements],
    conceptsIntroduced: [...profile.teachingProgress.conceptsIntroduced],
    conceptsMastered: [...profile.teachingProgress.conceptsMastered],
    conceptsStruggling: [...profile.teachingProgress.conceptsStruggling],
    currentFocusArea: profile.teachingProgress.currentFocusArea,
    mentorNotes: profile.mentorNotes
  }
}
