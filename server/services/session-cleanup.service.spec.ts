import type { OpenCodeClient, SessionInfo } from "@opencode/client"
import { describe, expect, it } from "vitest"
import { CleanupPlan } from "../data/session-cleanup.js"
import { SessionCleanupService, OpenCodeClientProvider } from "./session-cleanup.service.js"

const database = {
  available: true,
  databaseBytes: 4096,
  walBytes: 0,
  totalBytes: 4096,
  source: "default location",
}

function makeCandidate(id: string, affectedIDs = [id]) {
  return {
    session: {
      id,
      projectID: "project-a",
      title: id,
      location: { directory: "/workspace/project-a" },
      time: { created: 1, updated: 1 },
    } as SessionInfo,
    affectedCount: affectedIDs.length,
    affectedIDs,
    affectedSessions: affectedIDs.map((affectedID) => ({
      id: affectedID,
      parentID: affectedID === id ? undefined : id,
      projectID: "project-a",
      title: affectedID,
      location: { directory: "/workspace/project-a" },
      time: { created: 1, updated: 1 },
    } as SessionInfo)),
  }
}

function makePlan(...candidates: ReturnType<typeof makeCandidate>[]): CleanupPlan {
  return {
    candidates,
    eligibleCount: candidates.reduce((sum, candidate) => sum + candidate.affectedCount, 0),
    protectedCount: 0,
    totalSessions: candidates.reduce((sum, candidate) => sum + candidate.affectedCount, 0),
  }
}

function createService(
  plans: CleanupPlan[],
  removeSession: (sessionID: string) => Promise<void>,
) {
  const removed: string[] = []
  const client = {
    session: {
      remove: async ({ sessionID }: { sessionID: string }) => {
        await removeSession(sessionID)
        removed.push(sessionID)
      },
    },
  } as unknown as OpenCodeClient
  const provider: OpenCodeClientProvider = { getClient: async () => client }
  const service = new SessionCleanupService(
    provider,
    async () => plans.shift() ?? makePlan(),
    async () => database,
  )
  return { service, removed }
}

describe("SessionCleanupService", () => {
  it("does not delete when the reviewed candidate tree has changed", async () => {
    const reviewed = makePlan(makeCandidate("ses_root", ["ses_root", "ses_child"]))
    const changed = makePlan(makeCandidate("ses_root", ["ses_root", "ses_child", "ses_new_child"]))
    const { service, removed } = createService([changed], async () => undefined)

    const result = await service.deletePlanIfUnchanged(30, reviewed)

    expect(result).toEqual({ kind: "stale" })
    expect(removed).toEqual([])
  })

  it("deletes candidate groups only after the plan still matches", async () => {
    const plan = makePlan(
      makeCandidate("ses_root-a", ["ses_root-a", "ses_child-a"]),
      makeCandidate("ses_root-b"),
    )
    const { service, removed } = createService([plan], async () => undefined)

    const result = await service.deletePlanIfUnchanged(30, plan)

    expect(result).toEqual({ kind: "deleted", deletedGroups: 2, deletedSessions: 3, database })
    expect(removed).toEqual(["ses_root-a", "ses_root-b"])
  })

  it("refuses a parent conversation selection that would silently include unchecked children", async () => {
    const plan = makePlan(makeCandidate("ses_root", ["ses_root", "ses_child"]))
    const { service, removed } = createService([plan], async () => undefined)

    const result = await service.deleteSelection(30, ["ses_root"])

    expect(result).toEqual({ kind: "stale" })
    expect(removed).toEqual([])
  })

  it("deletes a checked parent and its checked child as one cascade", async () => {
    const plan = makePlan(makeCandidate("ses_root", ["ses_root", "ses_child"]))
    const { service, removed } = createService([plan], async () => undefined)

    const result = await service.deleteSelection(30, ["ses_root", "ses_child"])

    expect(result).toMatchObject({ kind: "deleted", deletedGroups: 1, deletedSessions: 2 })
    expect(removed).toEqual(["ses_root"])
  })

  it("deletes selected child conversations independently when the parent is not selected", async () => {
    const plan = makePlan(makeCandidate("ses_root", ["ses_root", "ses_child"]))
    const { service, removed } = createService([plan], async () => undefined)

    const result = await service.deleteSelection(30, ["ses_child"])

    expect(result).toMatchObject({ kind: "deleted", deletedGroups: 1, deletedSessions: 1 })
    expect(removed).toEqual(["ses_child"])
  })

  it("reports partial deletion if a later group fails", async () => {
    const plan = makePlan(
      makeCandidate("ses_root-a", ["ses_root-a", "ses_child-a"]),
      makeCandidate("ses_root-b"),
    )
    const { service, removed } = createService([plan], async (sessionID) => {
      if (sessionID === "ses_root-b") throw new Error("OpenCode rejected deletion")
    })

    const result = await service.deletePlanIfUnchanged(30, plan)

    expect(result).toEqual({
      kind: "partial",
      deletedGroups: 1,
      deletedSessions: 2,
      failedSessionID: "ses_root-b",
      error: "OpenCode rejected deletion",
    })
    expect(removed).toEqual(["ses_root-a"])
  })
})
