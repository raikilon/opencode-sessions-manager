import type { OpenCodeClient, SessionInfo } from "@opencode/client"
import { descendantsOf, getAllSessions } from "./session-repository.js"

// Shared last-activity cleanup eligibility and tree-planning rules.
export interface CleanupCandidate {
  session: SessionInfo
  affectedCount: number
  affectedIDs: string[]
  affectedSessions: SessionInfo[]
}

export interface CleanupPlan {
  candidates: CleanupCandidate[]
  eligibleCount: number
  protectedCount: number
  totalSessions: number
}

export async function getCleanupCandidates(api: OpenCodeClient, days: number): Promise<CleanupPlan> {
  const sessions = await getAllSessions(api, { archived: "all" })
  const activeIDs = new Set(Object.keys(await api.session.active()))
  const sessionsByID = new Map(sessions.map((session) => [session.id, session]))
  const childrenByParent = groupChildren(sessions)
  const eligibleCache = new Map<string, boolean>()
  const isEligible = makeEligibilityChecker(activeIDs, childrenByParent, Date.now() - days * 86_400_000, eligibleCache)

  const candidates = sessions
    .filter((session) => isDeletionRoot(session, sessionsByID, isEligible))
    .map((session) => makeCandidate(session, sessions))
  const eligibleCount = sessions.filter((session) => isEligible(session)).length

  return {
    candidates,
    eligibleCount,
    protectedCount: sessions.length - eligibleCount,
    totalSessions: sessions.length,
  }
}

export function cleanupPlansMatch(left: CleanupPlan, right: CleanupPlan): boolean {
  return JSON.stringify(planSnapshot(left)) === JSON.stringify(planSnapshot(right))
}

function groupChildren(sessions: SessionInfo[]): Map<string, SessionInfo[]> {
  const children = new Map<string, SessionInfo[]>()
  for (const session of sessions) {
    if (!session.parentID) continue
    const siblings = children.get(session.parentID) ?? []
    siblings.push(session)
    children.set(session.parentID, siblings)
  }
  return children
}

function makeEligibilityChecker(
  activeIDs: Set<string>,
  childrenByParent: Map<string, SessionInfo[]>,
  cutoff: number,
  cache: Map<string, boolean>,
) {
  return function isEligible(session: SessionInfo, visiting = new Set<string>()): boolean {
    const cached = cache.get(session.id)
    if (cached !== undefined) return cached
    if (visiting.has(session.id)) return false
    visiting.add(session.id)
    const eligible = session.time.updated < cutoff
      && !activeIDs.has(session.id)
      && (childrenByParent.get(session.id) ?? []).every((child) => isEligible(child, visiting))
    visiting.delete(session.id)
    cache.set(session.id, eligible)
    return eligible
  }
}

function isDeletionRoot(
  session: SessionInfo,
  sessionsByID: Map<string, SessionInfo>,
  isEligible: (session: SessionInfo) => boolean,
): boolean {
  if (!isEligible(session)) return false
  const parent = session.parentID ? sessionsByID.get(session.parentID) : undefined
  return !parent || !isEligible(parent)
}

function makeCandidate(session: SessionInfo, sessions: SessionInfo[]): CleanupCandidate {
  const affectedSessions = [session, ...descendantsOf(session.id, sessions)]
  const affectedIDs = affectedSessions.map((affected) => affected.id)
  return { session, affectedCount: affectedIDs.length, affectedIDs, affectedSessions }
}

function planSnapshot(plan: CleanupPlan) {
  return plan.candidates
    .map(({ session, affectedIDs }) => [session.id, [...affectedIDs].sort()] as const)
    .sort(([left], [right]) => left.localeCompare(right))
}
