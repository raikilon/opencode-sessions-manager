import express from "express"
import { resolve } from "node:path"
import { DatabaseMaintenanceService } from "../services/database-maintenance.service.js"
import { OpenCodeClientService } from "../services/opencode-client.service.js"
import { SessionCleanupService } from "../services/session-cleanup.service.js"
import { SessionSearchService } from "../services/session-search.service.js"
import { createCleanupRouter } from "./routes/cleanup.routes.js"
import { createSessionRouter } from "./routes/session.routes.js"
import { createSystemRouter } from "./routes/system.routes.js"

export function createHttpApp(): express.Express {
  const app = express()
  const isProduction = process.env.NODE_ENV === "production"
  const port = Number(process.env.PORT ?? (isProduction ? 4173 : 4174))
  const uiPort = Number(process.env.UI_PORT ?? 4173)

  app.disable("x-powered-by")
  app.use(express.json({ limit: "32kb" }))
  app.use("/api", allowDashboardOrigin(port, uiPort))

  const clientService = new OpenCodeClientService()
  const searchService = new SessionSearchService(clientService)
  const cleanupService = new SessionCleanupService(clientService)
  const databaseMaintenanceService = new DatabaseMaintenanceService(clientService)

  app.use("/api", createSystemRouter(clientService, databaseMaintenanceService))
  app.use("/api", createSessionRouter(searchService, cleanupService))
  app.use("/api", createCleanupRouter(cleanupService))
  app.use("/api", (_request, response) => response.status(404).json({ error: "API route not found." }))

  if (isProduction) serveAngularBuild(app)
  return app
}

function allowDashboardOrigin(apiPort: number, uiPort: number): express.RequestHandler {
  const allowedOrigins = new Set([
    `http://127.0.0.1:${apiPort}`,
    `http://localhost:${apiPort}`,
    `http://127.0.0.1:${uiPort}`,
    `http://localhost:${uiPort}`,
  ])
  return (request, response, next) => {
    const origin = request.get("origin")
    if (origin && !allowedOrigins.has(origin)) {
      response.status(403).json({ error: "Cross-origin requests are not allowed." })
      return
    }
    next()
  }
}

function serveAngularBuild(app: express.Express): void {
  const browserBuild = resolve(process.cwd(), "dist", "session-keeper", "browser")
  app.use(express.static(browserBuild))
  app.use((_request, response) => response.sendFile(resolve(browserBuild, "index.html")))
}
