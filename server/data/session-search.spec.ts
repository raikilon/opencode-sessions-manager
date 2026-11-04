import type { OpenCodeClient, SessionInfo } from "@opencode/client"
import { describe, expect, it } from "vitest"
import { searchContentSessions } from "./session-search.js"

const goodSession = {
  id: "ses_good",
  projectID: "project-a",
  time: { created: 1, updated: 2 },
  location: { directory: "/workspace/project-a" },
} as SessionInfo

const unreadableSession = {
  id: "ses_unreadable",
  projectID: "project-a",
  time: { created: 1, updated: 1 },
  location: { directory: "/workspace/project-a" },
} as SessionInfo

describe("searchContentSessions", () => {
  it("returns readable matches even if another conversation cannot be read", async () => {
    const api = {
      session: {
        list: async ({ archived }: { archived: boolean }) => ({
          data: archived ? [] : [goodSession, unreadableSession],
          cursor: { next: null },
        }),
      },
      message: {
        list: async ({ sessionID }: { sessionID: string }) => {
          if (sessionID === unreadableSession.id) throw new Error("message read failed")
          return {
            data: [{ type: "user", text: "Find the matching phrase here" }],
            cursor: { next: null },
          }
        },
      },
    } as unknown as OpenCodeClient

    const result = await searchContentSessions(api, "matching phrase", { archived: "false" })

    expect(result.totalSessions).toBe(2)
    expect(result.matches.map((match) => match.sessionID)).toEqual([goodSession.id])
    expect(result.failedSessions).toBe(1)
  })
})
