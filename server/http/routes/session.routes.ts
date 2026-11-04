import { Router } from "express"
import { ArchiveFilter } from "../../data/session-repository.js"
import { SessionCleanupService } from "../../services/session-cleanup.service.js"
import { SessionSearchService } from "../../services/session-search.service.js"
import { sendError } from "../http-response.js"

export function createSessionRouter(
  searchService: SessionSearchService,
  cleanupService: SessionCleanupService,
): Router {
  const router = Router()

  router.get("/sessions", async (request, response) => {
    try {
      const result = await searchService.listSessions({
        archived: archivedFilter(request.query.archived),
        project: queryString(request.query.project),
        title: queryString(request.query.search),
      })
      response.json(result)
    } catch (error) {
      sendError(response, error)
    }
  })

  router.get("/search/content", async (request, response) => {
    const query = queryString(request.query.q)?.trim() ?? ""
    if (query.length < 2) {
      response.status(400).json({ error: "Enter at least two characters to search conversation text." })
      return
    }
    try {
      response.json(await searchService.searchContent(query, {
        archived: archivedFilter(request.query.archived),
        project: queryString(request.query.project),
      }))
    } catch (error) {
      sendError(response, error)
    }
  })

  router.delete("/sessions/:sessionID", async (request, response) => {
    try {
      const result = await cleanupService.deleteSession(request.params.sessionID)
      if (result.kind === "not-found") {
        response.status(404).json({ error: "Session not found." })
        return
      }
      if (result.kind === "active") {
        response.status(409).json({ error: "This session or one of its child sessions is active. Stop it in OpenCode before deleting." })
        return
      }
      response.json({ deletedSessions: result.deletedSessions })
    } catch (error) {
      sendError(response, error)
    }
  })

  return router
}

function queryString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function archivedFilter(value: unknown): ArchiveFilter {
  if (value === "true" || value === "false") return value
  return "all"
}
