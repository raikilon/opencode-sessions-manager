import type { OpenCodeClient } from "@opencode/client"
import { ArchiveFilter, getAllSessions, getDatabaseFootprint } from "../data/session-repository.js"
import { searchContentSessions } from "../data/session-search.js"
import { OpenCodeClientService } from "./opencode-client.service.js"

export interface SessionSearchInput {
  query: string
  in: "title" | "content"
  project?: string
  includeArchived: boolean
  limit: number
}

export class SessionSearchService {
  constructor(private readonly clientService: OpenCodeClientService) {}

  async listSessions(filters: { archived: ArchiveFilter; project?: string; title?: string }) {
    const api = await this.requireClient()
    const allSessions = await getAllSessions(api, { archived: "all" })
    const title = filters.title?.trim().toLocaleLowerCase() ?? ""
    const sessions = allSessions.filter((session) => {
      const archiveMatches = filters.archived === "all"
        || (filters.archived === "true" ? Boolean(session.time.archived) : !session.time.archived)
      return archiveMatches
        && (!filters.project || session.projectID === filters.project)
        && (!title || (session.title ?? "").toLocaleLowerCase().includes(title))
    })
    const active = await api.session.active()
    return {
      data: sessions,
      activeIDs: Object.keys(active),
      totalSessions: allSessions.length,
      database: await getDatabaseFootprint(),
      relationships: allSessions.map(({ id, parentID }) => ({ id, parentID })),
    }
  }

  async searchSessions(input: SessionSearchInput) {
    const api = await this.requireClient()
    if (input.in === "content") return this.searchConversationContent(api, input)
    return this.searchSessionTitles(api, input)
  }

  async searchContent(query: string, filters: { archived: ArchiveFilter; project?: string }) {
    const api = await this.requireClient()
    return searchContentSessions(api, query, filters)
  }

  private async searchSessionTitles(api: OpenCodeClient, input: SessionSearchInput) {
    const sessions = await getAllSessions(api, {
      archived: archiveFilter(input.includeArchived),
      project: input.project,
    })
    const query = input.query.toLocaleLowerCase()
    const matches = sessions.filter((session) => (session.title ?? "").toLocaleLowerCase().includes(query))
    return {
      query: input.query,
      searchIn: "title" as const,
      totalSessionsScanned: sessions.length,
      totalMatches: matches.length,
      matches: matches.slice(0, input.limit).map((session) => ({
        sessionID: session.id,
        title: session.title || "Untitled session",
        projectID: session.projectID,
        directory: session.location.directory,
        lastActive: new Date(session.time.updated).toISOString(),
        archived: Boolean(session.time.archived),
      })),
    }
  }

  private async searchConversationContent(api: OpenCodeClient, input: SessionSearchInput) {
    const { totalSessions, matches, failedSessions } = await searchContentSessions(api, input.query, {
      archived: archiveFilter(input.includeArchived),
      project: input.project,
    })
    return {
      query: input.query,
      searchIn: "content" as const,
      totalSessionsScanned: totalSessions,
      totalMatches: matches.length,
      failedSessions,
      matches: matches.slice(0, input.limit),
    }
  }

  private async requireClient(): Promise<OpenCodeClient> {
    const client = await this.clientService.getClient(true)
    if (!client) throw new Error("OpenCode local service is unavailable.")
    return client
  }
}

function archiveFilter(includeArchived: boolean): ArchiveFilter {
  return includeArchived ? "all" : "false"
}
