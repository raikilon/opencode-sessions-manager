import { Router } from "express"
import { OpenCodeClientService } from "../../services/opencode-client.service.js"
import { DatabaseMaintenanceService } from "../../services/database-maintenance.service.js"
import { sendError } from "../http-response.js"

export function createSystemRouter(
  clientService: OpenCodeClientService,
  databaseMaintenance: DatabaseMaintenanceService,
): Router {
  const router = Router()

  router.get("/status", async (_request, response) => {
    try {
      response.json({
        ...await clientService.getStatus(),
        compactionProgress: databaseMaintenance.getProgress(),
      })
    } catch (error) {
      response.json({ available: false, error: error instanceof Error ? error.message : "OpenCode is unavailable." })
    }
  })

  router.post("/connect", async (_request, response) => {
    try {
      const client = await clientService.getClient(true)
      if (!client) {
        response.status(503).json({ error: "OpenCode local service is unavailable." })
        return
      }
      const info = await client.server.info()
      response.json({ connected: true, version: info.version })
    } catch (error) {
      sendError(response, error, 503)
    }
  })

  router.get("/projects", async (_request, response) => {
    try {
      const client = await clientService.getClient()
      if (!client) {
        response.status(503).json({ error: "OpenCode is not connected. Connect to the local service and try again." })
        return
      }
      response.json(await client.project.list())
    } catch (error) {
      sendError(response, error)
    }
  })

  router.get("/database/compact/progress", (_request, response) => {
    const operationID = typeof _request.query.operationID === "string" ? _request.query.operationID : undefined
    response.json(databaseMaintenance.getProgress(operationID))
  })

  router.get("/database/backups", async (_request, response) => {
    try {
      response.json(await databaseMaintenance.listBackups())
    } catch (error) {
      sendError(response, error)
    }
  })

  router.delete("/database/backups/:backupID", async (request, response) => {
    try {
      await databaseMaintenance.deleteVerifiedBackup(request.params.backupID)
      response.json({ deleted: true, backupID: request.params.backupID })
    } catch (error) {
      sendError(response, error, 409)
    }
  })

  router.post("/database/compact", async (request, response) => {
    const operationID = request.body?.operationID
    if (request.body?.confirm !== true || typeof operationID !== "string" || operationID.length > 100) {
      response.status(400).json({ error: "Explicit confirmation is required to compact the OpenCode database." })
      return
    }
    try {
      const result = await databaseMaintenance.compactDatabase(operationID)
      if (result.kind === "active-sessions") {
        response.status(409).json({
          error: `Cannot compact while ${result.activeSessions} OpenCode session${result.activeSessions === 1 ? " is" : "s are"} active. Wait for them to finish, close other OpenCode clients, then retry.`,
        })
        return
      }
      response.json(result)
    } catch (error) {
      sendError(response, error)
    }
  })

  return router
}
