import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  applyProfileUpdate,
  applySkillDeltas,
  computeOverallLevel,
  conceptForReason,
  createDefaultProfile,
  digestProfile,
  IMPROVEMENT_LABELS,
  PROFILE_STORAGE_KEY,
  WEAKNESS_LABELS,
  type ConceptKey,
  type GameSummary,
  type KeyMoment,
  type ProfileDigest,
  type ProfileUpdate,
  type StudentProfile
} from '~/utils/profile'
import type { SessionTracker } from '~/utils/sessionTracker'

export interface MoveRecord {
  reason: string
  quality: 'excellent' | 'good' | 'okay' | 'suboptimal' | 'mistake'
  moveLabel: string
  tracker: SessionTracker
}

const MAX_RECENT_GAMES = 10
const STREAK_THRESHOLD = 3

function readStoredProfile(): StudentProfile | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StudentProfile>
    const fallback = createDefaultProfile()
    return {
      ...fallback,
      ...parsed,
      skills: { ...fallback.skills, ...(parsed.skills ?? {}) },
      habits: { ...fallback.habits, ...(parsed.habits ?? {}) },
      teachingProgress: {
        ...fallback.teachingProgress,
        ...(parsed.teachingProgress ?? {})
      },
      recentGames: Array.isArray(parsed.recentGames) ? parsed.recentGames : []
    }
  } catch {
    return null
  }
}

export const useProfileStore = defineStore('profile', () => {
  const profile = ref<StudentProfile>(createDefaultProfile())
  const hydrated = ref(false)

  // Per-game counters, reset whenever a game finishes.
  const errorStreak = ref<Record<string, number>>({})
  const goodStreak = ref<Record<string, number>>({})
  const conceptGood = ref<Record<string, number>>({})
  const conceptBad = ref<Record<string, number>>({})
  const keyMoments = ref<KeyMoment[]>([])
  const conceptsPracticed = ref<string[]>([])
  const openingMoves = ref<string[]>([])
  const gameMoveCount = ref(0)

  const digest = computed<ProfileDigest>(() => digestProfile(profile.value))

  function persist() {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile.value))
    } catch {
      // Storage may be unavailable (private mode / quota). The profile then only
      // lives for the current session, which is acceptable.
    }
  }

  function hydrate() {
    if (hydrated.value) return
    hydrated.value = true
    const stored = readStoredProfile()
    if (stored) profile.value = stored
  }

  function getProfile(): StudentProfile {
    return profile.value
  }

  function updateProfile(patch: Partial<StudentProfile>) {
    profile.value = { ...profile.value, ...patch }
    persist()
  }

  function resetProfile() {
    profile.value = createDefaultProfile()
    resetGameCounters()
    persist()
  }

  function resetGameCounters() {
    errorStreak.value = {}
    goodStreak.value = {}
    conceptGood.value = {}
    conceptBad.value = {}
    keyMoments.value = []
    conceptsPracticed.value = []
    openingMoves.value = []
    gameMoveCount.value = 0
  }

  function bump(record: Record<string, number>, key: string): number {
    record[key] = (record[key] ?? 0) + 1
    return record[key]
  }

  /** Applies one move of learning: skills, streaks, concepts and key moments. */
  function recordMove(input: MoveRecord) {
    const { reason, quality, moveLabel, tracker } = input
    const concept = conceptForReason(reason)
    gameMoveCount.value += 1
    if (gameMoveCount.value <= 2) openingMoves.value.push(moveLabel)

    const skills = { ...profile.value.skills }
    const reasonDeltas = SKILL_DELTA_BY_REASON[reason]
    if (reasonDeltas) Object.assign(skills, applySkillDeltas(skills, reasonDeltas))
    Object.assign(skills, applySkillDeltas(skills, trackerDeltas(tracker)))

    const teachingProgress = { ...profile.value.teachingProgress }
    if (!teachingProgress.conceptsIntroduced.includes(concept)) {
      teachingProgress.conceptsIntroduced = [...teachingProgress.conceptsIntroduced, concept]
    }
    if (!conceptsPracticed.value.includes(concept)) {
      conceptsPracticed.value = [...conceptsPracticed.value, concept]
    }

    const isMistake = quality === 'mistake'
    const isGood = quality === 'excellent' || quality === 'good'

    if (isMistake) {
      bump(errorStreak.value, reason)
      goodStreak.value[reason] = 0
      bump(conceptBad.value, concept)
      if ((errorStreak.value[reason] ?? 0) >= STREAK_THRESHOLD) {
        const label = WEAKNESS_LABELS[reason]
        if (label && !profile.value.habits.weaknesses.includes(label)) {
          profile.value.habits.weaknesses = [...profile.value.habits.weaknesses, label]
        }
      }
    } else if (isGood) {
      bump(goodStreak.value, reason)
      errorStreak.value[reason] = 0
      bump(conceptGood.value, concept)
      if ((goodStreak.value[reason] ?? 0) >= STREAK_THRESHOLD) {
        const label = IMPROVEMENT_LABELS[reason]
        if (label && !profile.value.habits.recentImprovements.includes(label)) {
          profile.value.habits.recentImprovements = [
            ...profile.value.habits.recentImprovements,
            label
          ]
        }
      }
    }

    if ((conceptGood.value[concept] ?? 0) >= STREAK_THRESHOLD) {
      if (!teachingProgress.conceptsMastered.includes(concept)) {
        teachingProgress.conceptsMastered = [...teachingProgress.conceptsMastered, concept]
      }
    }
    if ((conceptBad.value[concept] ?? 0) >= STREAK_THRESHOLD) {
      if (!teachingProgress.conceptsStruggling.includes(concept)) {
        teachingProgress.conceptsStruggling = [...teachingProgress.conceptsStruggling, concept]
      }
      teachingProgress.currentFocusArea = CONCEPT_TEXT[concept] ?? concept
    }

    // Behavioural habits worth telling the student about.
    const tendencies = [...profile.value.habits.tendsTo]
    if (tracker.detections.isRepeatingAtari && !tendencies.includes('喜欢征子')) {
      tendencies.push('喜欢征子')
    }
    if (tracker.detections.isIgnoringDanger && !tendencies.includes('常忽略自己的气')) {
      tendencies.push('常忽略自己的气')
    }
    if (tracker.detections.tenukiWhenInAtari && !tendencies.includes('习惯脱先')) {
      tendencies.push('习惯脱先')
    }

    profile.value = {
      ...profile.value,
      totalMoves: profile.value.totalMoves + 1,
      skills,
      overallLevel: computeOverallLevel(skills),
      teachingProgress,
      habits: { ...profile.value.habits, tendsTo: tendencies }
    }

    if (reason === 'capture') {
      keyMoments.value = [
        ...keyMoments.value,
        { move: moveLabel, type: 'great', note: '成功提子' }
      ]
    } else if (isMistake) {
      keyMoments.value = [
        ...keyMoments.value,
        { move: moveLabel, type: 'mistake', note: WEAKNESS_LABELS[reason] ?? '这一步有问题' }
      ]
    }

    persist()
  }

  /** Closes the game: stores the summary and refreshes the derived numbers. */
  function finishGame(result: 'win' | 'lose' | 'unfinished', notes?: string) {
    const summary: GameSummary = {
      date: new Date().toISOString(),
      moves: gameMoveCount.value,
      result,
      keyMoments: keyMoments.value.slice(0, 8),
      conceptsPracticed: [...conceptsPracticed.value]
    }

    const favoriteOpenings = [
      ...profile.value.habits.favoriteOpenings,
      ...openingMoves.value
    ].slice(-MAX_RECENT_GAMES * 2)

    profile.value = {
      ...profile.value,
      totalGames: profile.value.totalGames + 1,
      lastPlayedAt: new Date().toISOString(),
      overallLevel: computeOverallLevel(profile.value.skills),
      habits: { ...profile.value.habits, favoriteOpenings },
      recentGames: [summary, ...profile.value.recentGames].slice(0, MAX_RECENT_GAMES),
      mentorNotes: notes?.trim() || profile.value.mentorNotes
    }

    resetGameCounters()
    persist()
  }

  /** Applies a patch proposed by the model (already validated by the server). */
  function applyModelUpdate(update: ProfileUpdate) {
    profile.value = applyProfileUpdate(profile.value, update)
    persist()
  }

  return {
    profile,
    digest,
    hydrated,
    hydrate,
    getProfile,
    updateProfile,
    resetProfile,
    recordMove,
    finishGame,
    applyModelUpdate,
    resetGameCounters
  }
})

/** Skill deltas per rule-engine reason. Mirrors `utils/profile.ts` rules. */
const SKILL_DELTA_BY_REASON: Record<string, Partial<Record<string, number>>> = {
  capture: { captureInstinct: 3 },
  atari: { captureInstinct: 2, dangerDetection: 1 },
  'self-atari': { dangerDetection: -2, libertyAwareness: -1 },
  rescue: { dangerDetection: 2, libertyAwareness: 1 },
  connection: { connectionSense: 2 },
  extension: { connectionSense: 1 },
  edge: { territoryConcept: -1 },
  isolated: { connectionSense: -1, patienceLevel: -1 }
}

const CONCEPT_TEXT: Record<string, string> = {
  liberty: '气',
  capture: '提子',
  atari: '叫吃',
  territory: '围地',
  connection: '连接',
  shape: '棋形',
  rules: '规则'
}

/** Skill deltas derived from cross-move behaviour, not from a single move. */
function trackerDeltas(tracker: SessionTracker): Partial<Record<string, number>> {
  const deltas: Partial<Record<string, number>> = {}
  const { detections } = tracker

  if (detections.tenukiWhenInAtari) {
    deltas.dangerDetection = (deltas.dangerDetection ?? 0) - 2
    deltas.tenukiFrequency = (deltas.tenukiFrequency ?? 0) + 1
  }
  if (detections.isIgnoringDanger) {
    deltas.dangerDetection = (deltas.dangerDetection ?? 0) - 1
  }
  if (detections.isChasingTooLong) {
    deltas.patienceLevel = (deltas.patienceLevel ?? 0) - 2
  }
  if (detections.isAlwaysAttacking) {
    deltas.patienceLevel = (deltas.patienceLevel ?? 0) - 2
    deltas.dangerDetection = (deltas.dangerDetection ?? 0) - 1
  }
  if (detections.isAlwaysDefending) {
    deltas.patienceLevel = (deltas.patienceLevel ?? 0) - 1
    deltas.territoryConcept = (deltas.territoryConcept ?? 0) - 1
  }
  return deltas
}
