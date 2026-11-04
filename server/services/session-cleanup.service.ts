import type { OpenCodeClient, SessionInfo } from "@opencode/client"
import { getCleanupCandidates, cleanupPlansMatch, type CleanupPlan, type CleanupCandidate } from "../data/session-cleanup.js"
import { descendantsOf, getAllSessions, getDatabaseFootprint } from "../data/session-repository.js"

export type CleanupDeleteResult =
  | { kind: "stale" }
  | { kind: "deleted"; deletedGroups: number; deletedSessions: number; database: Awaited<ReturnType<typeof getDatabaseFootprint>> }
  | { kind: "partial"; deletedGroups: number; deletedSessions: number; failedSessionID: string; error: string }

export type DeleteSessionResult =
  | { kind: "not-found" }
  | { kind: "active" }
  | { kind: "deleted"; deletedSessions: number }

export interface OpenCodeClientProvider {
  getClient(startService?: boolean): Promise<OpenCodeClient | undefined>
}

type PlanBuilder = (api: OpenCodeClient, days: number) => Promise<CleanupPlan>
type FootprintReader = typeof getDatabaseFootprint

export class SessionCleanupService {
  constructor(
    private readonly clientService: OpenCodeClientProvider,
    private readonly buildPlan: PlanBuilder = getCleanupCandidates,
    private readonly readFootprint: FootprintReader = getDatabaseFootprint,
  ) {}

  async createPlan(days: number): Promise<CleanupPlan> {
    const client = await this.requireClient()
    return this.buildPlan(client, days)
  }

  async deleteSelection(days: number, sessionIDs: string[]): Promise<CleanupDeleteResult> {
    const client = await this.requireClient()
    const plan = await this.buildPlan(client, days)
    const candidates = selectConversationRoots(plan, sessionIDs)
    if (!candidates) return { kind: "stale" }
    return this.deleteCandidateGroups(client, candidates)
  }

  async deletePlanIfUnchanged(days: number, reviewedPlan: CleanupPlan): Promise<CleanupDeleteResult> {
    const client = await this.requireClient()
    const currentPlan = await this.buildPlan(client, days)
    if (!cleanupPlansMatch(reviewedPlan, currentPlan)) return { kind: "stale" }
    return this.deleteCandidateGroups(client, reviewedPlan.candidates)
  }

  async deleteSession(sessionID: string): Promise<DeleteSessionResult> {
    const client = await this.requireClient()
    const sessions = await getAllSessions(client, { archived: "all" })
    const session = sessions.find((item) => item.id === sessionID)
    if (!session) return { kind: "not-found" }

    const affectedSessions = [session, ...descendantsOf(session.id, sessions)]
    const activeIDs = new Set(Object.keys(await client.session.active()))
    if (affectedSessions.some((item) => activeIDs.has(item.id))) return { kind: "active" }

    await client.session.remove({ sessionID })
    return { kind: "deleted", deletedSessions: affectedSessions.length }
  }

  private async deleteCandidateGroups(client: OpenCodeClient, candidates: CleanupCandidate[]): Promise<CleanupDeleteResult> {
    let deletedGroups = 0
    let deletedSessions = 0
    for (const candidate of candidates) {
      try {
        await client.session.remove({ sessionID: candidate.session.id })
        deletedGroups += 1
        deletedSessions += candidate.affectedCount
      } catch (error) {
        return {
          kind: "partial",
          deletedGroups,
          deletedSessions,
          failedSessionID: candidate.session.id,
          error: error instanceof Error ? error.message : "Unexpected deletion error.",
        }
      }
    }
    return { kind: "deleted", deletedGroups, deletedSessions, database: await this.readFootprint() }
  }

  private async requireClient(): Promise<OpenCodeClient> {
    const client = await this.clientService.getClient(true)
    if (!client) throw new Error("OpenCode local service is unavailable.")
    return client
  }
}

function selectConversationRoots(plan: CleanupPlan, sessionIDs: string[]): CleanupCandidate[] | undefined {
  if (sessionIDs.length === 0 || new Set(sessionIDs).size !== sessionIDs.length) return undefined

  const conversations = new Map<string, SessionInfo>()
  for (const candidate of plan.candidates) {
    for (const session of candidate.affectedSessions) conversations.set(session.id, session)
  }
  const selected = new Set(sessionIDs)
  if ([...selected].some((id) => !conversations.has(id))) return undefined

  const childrenByParent = new Map<string, string[]>()
  for (const session of conversations.values()) {
    if (!session.parentID) continue
    const children = childrenByParent.get(session.parentID) ?? []
    children.push(session.id)
    childrenByParent.set(session.parentID, children)
  }

  const roots = [...selected]
    .map((id) => conversations.get(id)!)
    .filter((session) => !session.parentID || !selected.has(session.parentID))
  const covered = new Set<string>()
  const candidates: CleanupCandidate[] = []

  for (const root of roots) {
    const affectedSessions = collectConversationTree(root.id, conversations, childrenByParent)
    if (affectedSessions.some((session) => !selected.has(session.id))) return undefined
    for (const session of affectedSessions) covered.add(session.id)
    const affectedIDs = affectedSessions.map((session) => session.id)
    candidates.push({ session: root, affectedCount: affectedIDs.length, affectedIDs, affectedSessions })
  }

  return covered.size === selected.size ? candidates : undefined
}

function collectConversationTree(
  rootID: string,
  conversations: Map<string, SessionInfo>,
  childrenByParent: Map<string, string[]>,
): SessionInfo[] {
  const found: SessionInfo[] = []
  const visited = new Set<string>()
  const pending = [rootID]
  while (pending.length > 0) {
    const id = pending.pop()!
    if (visited.has(id)) continue
    visited.add(id)
    const session = conversations.get(id)
    if (!session) continue
    found.push(session)
    pending.push(...(childrenByParent.get(id) ?? []))
  }
  return found
}
