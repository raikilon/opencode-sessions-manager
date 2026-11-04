import { Router } from "express"
import { getDatabaseFootprint } from "../../data/session-repository.js"
import { SessionCleanupService } from "../../services/session-cleanup.service.js"
import { sendError } from "../http-response.js"

export function createCleanupRouter(cleanupService: SessionCleanupService): Router {
  const router = Router()

  router.get("/cleanup/preview", async (request, response) => {
    const days = parseDays(request.query.days)
    if (days === undefined) {
      response.status(400).json({ error: "Retention must be a whole number between 1 and 3650 days." })
      return
    }
    try {
      const plan = await cleanupService.createPlan(days)
      response.json({ ...plan, database: await getDatabaseFootprint() })
    } catch (error) {
      sendError(response, error)
    }
  })

  router.post("/cleanup/delete", async (request, response) => {
    const days = parseDays(request.body?.days)
    const sessionIDs = parseSessionIDs(request.body?.sessionIDs)
    if (days === undefined || sessionIDs.length === 0) {
      response.status(400).json({ error: "Choose at least one cleanup candidate and a valid retention period." })
      return
    }
    try {
      const result = await cleanupService.deleteSelection(days, sessionIDs)
      if (result.kind === "stale") {
        response.status(409).json({ error: "The cleanup list changed. Refresh the preview before deleting." })
        return
      }
      if (result.kind === "partial") {
        response.status(500).json({
          error: result.error,
          deletedRoots: result.deletedGroups,
          deletedSessions: result.deletedSessions,
          failedSessionID: result.failedSessionID,
        })
        return
      }
      response.json({ deletedRoots: result.deletedGroups, deletedSessions: result.deletedSessions })
    } catch (error) {
      sendError(response, error)
    }
  })

  return router
}

function parseDays(value: unknown): number | undefined {
  const days = Number(value)
  return Number.isInteger(days) && days >= 1 && days <= 3650 ? days : undefined
}

function parseSessionIDs(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []
}
