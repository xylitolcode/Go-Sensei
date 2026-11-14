import { describe, expect, it } from 'vitest'
import {
  applyProfileUpdate,
  applySkillDeltas,
  computeOverallLevel,
  conceptForReason,
  createDefaultProfile,
  digestProfile,
  levelLabel
} from '../app/utils/profile'

describe('student profile', () => {
  it('starts with a beginner-friendly baseline', () => {
    const profile = createDefaultProfile()
    expect(profile.totalGames).toBe(0)
    expect(profile.overallLevel).toBe(0)
    expect(profile.skills.libertyAwareness).toBeGreaterThan(0)
    expect(levelLabel(profile.overallLevel)).toBe('刚入门')
  })

  it('maps rule-engine reasons onto the concept they teach', () => {
    expect(conceptForReason('capture')).toBe('capture')
    expect(conceptForReason('self-atari')).toBe('liberty')
    expect(conceptForReason('connection')).toBe('connection')
    expect(conceptForReason('atari')).toBe('atari')
  })

  it('clamps skill deltas to a sane range', () => {
    const profile = createDefaultProfile()
    const skills = applySkillDeltas(profile.skills, { captureInstinct: 50 })
    // A single move may only move a skill by three points.
    expect(skills.captureInstinct).toBe(9)

    const low = applySkillDeltas(profile.skills, { dangerDetection: -50 })
    expect(low.dangerDetection).toBe(5)

    const floored = applySkillDeltas({ ...profile.skills, dangerDetection: 1 }, { dangerDetection: -3 })
    expect(floored.dangerDetection).toBe(0)
  })

  it('recomputes the overall level from the skills', () => {
    const profile = createDefaultProfile()
    const skills = applySkillDeltas(profile.skills, {
      libertyAwareness: 3,
      captureInstinct: 3,
      connectionSense: 3,
      territoryConcept: 3,
      dangerDetection: 3,
      patienceLevel: 3
    })
    expect(computeOverallLevel(skills)).toBeGreaterThan(profile.overallLevel)
  })

  it('applies a model-proposed update and ignores unknown fields', () => {
    const profile = createDefaultProfile()

    const next = applyProfileUpdate(profile, {
      addTendency: '喜欢征子',
      addWeakness: '经常忽略自己的气',
      addConcept: '气',
      addConceptMastered: '提子',
      mentorNotes: '这盘比上一盘稳。',
      skills: { captureInstinct: 2, madeUpSkill: 5 }
    } as never)

    expect(next.habits.tendsTo).toContain('喜欢征子')
    expect(next.habits.weaknesses).toContain('经常忽略自己的气')
    expect(next.teachingProgress.conceptsIntroduced).toContain('气')
    expect(next.teachingProgress.conceptsMastered).toContain('提子')
    expect(next.mentorNotes).toBe('这盘比上一盘稳。')
    expect(next.skills.captureInstinct).toBe(8)
    expect(next).not.toHaveProperty('madeUpSkill')
  })

  it('does not duplicate habits that are already recorded', () => {
    const profile = createDefaultProfile()
    const once = applyProfileUpdate(profile, { addTendency: '喜欢征子' })
    const twice = applyProfileUpdate(once, { addTendency: '喜欢征子' })
    expect(twice.habits.tendsTo.filter((item) => item === '喜欢征子')).toHaveLength(1)
  })

  it('produces a compact digest for the model prompt', () => {
    const profile = createDefaultProfile()
    const digest = digestProfile(profile)

    expect(digest.totalGames).toBe(0)
    expect(digest.levelLabel).toBe('刚入门')
    expect(Object.keys(digest.skills)).toHaveLength(7)
    expect(Array.isArray(digest.weaknesses)).toBe(true)
  })
})
