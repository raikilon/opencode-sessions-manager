import { HttpErrorResponse, httpResource } from "@angular/common/http"
import { Injectable, computed, inject, signal } from "@angular/core"
import { ArchiveFilter, ContentSearchResponse, DatabaseCompactionProgress, DatabaseFootprint, Project, SearchMode, Session, SessionRelationship, SessionsResponse } from "../models/session.models"
import { ConfirmationService } from "./confirmation.service"
import { SessionApiService } from "./session-api.service"

const EMPTY_DATABASE: DatabaseFootprint = {
  available: false,
  databaseBytes: null,
  walBytes: 0,
  totalBytes: null,
  source: "OpenCode database path unavailable",
}

const EMPTY_SESSIONS: SessionsResponse = {
  data: [],
  activeIDs: [],
  totalSessions: 0,
  database: EMPTY_DATABASE,
  relationships: [],
}

const EMPTY_CONTENT: ContentSearchResponse = { totalSessions: 0, failedSessions: 0, matches: [] }

interface ContentSearchRequest {
  query: string
  archived: ArchiveFilter
  project: string
  run: number
}

@Injectable({ providedIn: "root" })
export class SessionDashboardStore {
  private readonly confirmation = inject(ConfirmationService)
  private readonly api = inject(SessionApiService)

  readonly connected = signal(false)
  readonly connecting = signal(false)
  readonly version = signal<string | undefined>(undefined)
  readonly serviceAvailable = signal(false)
  readonly compactionProgress = signal<DatabaseCompactionProgress | undefined>(undefined)
  readonly uiError = signal("")
  readonly notice = signal("")

  readonly projectFilter = signal("all")
  readonly archiveFilter = signal<ArchiveFilter>("all")
  readonly ageFilter = signal("all")
  readonly searchMode = signal<SearchMode>("title")
  readonly searchText = signal("")
  readonly titleSearch = signal("")
  readonly contentSearchRequest = signal<ContentSearchRequest | undefined>(undefined)

  private readonly sessionsResource = httpResource<SessionsResponse>(() => {
    if (!this.connected()) return undefined
    const params: Record<string, string> = { archived: this.archiveFilter() }
    if (this.projectFilter() !== "all") params["project"] = this.projectFilter()
    if (this.titleSearch().trim()) params["search"] = this.titleSearch().trim()
    return { url: "/api/sessions", params }
  }, { defaultValue: EMPTY_SESSIONS })

  private readonly projectsResource = httpResource<Project[]>(
    () => this.connected() ? "/api/projects" : undefined,
    { defaultValue: [] },
  )

  private readonly contentResource = httpResource<ContentSearchResponse>(() => {
    const request = this.contentSearchRequest()
    if (!this.connected() || !request) return undefined
    const params: Record<string, string> = { q: request.query, archived: request.archived }
    if (request.project !== "all") params["project"] = request.project
    return { url: "/api/search/content", params }
  }, { defaultValue: EMPTY_CONTENT })

  readonly sessions = computed(() => this.sessionsResource.value().data)
  readonly activeIDs = computed(() => this.sessionsResource.value().activeIDs)
  readonly relationships = computed(() => this.sessionsResource.value().relationships)
  readonly totalSessions = computed(() => this.sessionsResource.value().totalSessions)
  readonly database = computed(() => this.sessionsResource.value().database)
  readonly projects = computed(() => this.projectsResource.value())
  readonly sessionsLoading = computed(() => this.connected() && this.sessionsResource.isLoading())
  readonly visibleSessions = computed(() => {
    const sessions = this.sessions()
    const ageFilter = this.ageFilter()
    if (ageFilter === "all") return sessions
    const cutoff = Date.now() - Number(ageFilter) * 24 * 60 * 60 * 1000
    return sessions.filter((session) => session.time.updated >= cutoff)
  })
  readonly contentMatches = computed(() => {
    if (!this.contentSearchRequest() || this.contentResource.status() !== "resolved") return undefined
    return this.contentResource.value().matches
  })
  readonly contentSearchWarning = computed(() => {
    if (this.contentResource.status() !== "resolved") return ""
    const result = this.contentResource.value()
    return result.failedSessions > 0
      ? `Search results may be incomplete: messages could not be read from ${result.failedSessions} of ${result.totalSessions} conversations.`
      : ""
  })
  readonly contentSearching = computed(() => Boolean(this.contentSearchRequest()) && this.contentResource.isLoading())
  readonly childCounts = computed(() => this.buildChildCounts(this.relationships()))
  readonly blockedIDs = computed(() => this.buildBlockedIDs(this.relationships(), this.activeIDs()))
  readonly error = computed(() => {
    if (this.uiError()) return this.uiError()
    if (this.sessionsResource.status() === "error") return this.errorMessage(this.sessionsResource.error(), "Unable to load sessions.")
    if (this.projectsResource.status() === "error") return this.errorMessage(this.projectsResource.error(), "Unable to load projects.")
    if (this.contentResource.status() === "error") return this.errorMessage(this.contentResource.error(), "Conversation search failed.")
    return ""
  })

  private contentSearchRun = 0

  async initialize(): Promise<void> {
    await this.refreshConnectionStatus()
  }

  async connect(): Promise<void> {
    this.connecting.set(true)
    this.uiError.set("")
    try {
      const status = await this.api.connect()
      this.connected.set(status.connected)
      this.version.set(status.version)
    } catch (error) {
      this.uiError.set(this.errorMessage(error, "Unable to connect to OpenCode."))
    } finally {
      this.connecting.set(false)
    }
  }

  async refreshConnectionStatus(): Promise<void> {
    try {
      const status = await this.api.getStatus()
      this.serviceAvailable.set(status.available)
      this.connected.set(status.connected)
      this.version.set(status.version)
      this.compactionProgress.set(status.compactionProgress)
    } catch {
      this.serviceAvailable.set(false)
      this.connected.set(false)
      this.version.set(undefined)
      this.compactionProgress.set(undefined)
    }
  }

  changeProject(projectID: string): void {
    this.projectFilter.set(projectID)
    this.contentSearchRequest.set(undefined)
  }

  changeArchive(filter: ArchiveFilter): void {
    this.archiveFilter.set(filter)
    this.contentSearchRequest.set(undefined)
  }

  changeSearchMode(mode: SearchMode): void {
    this.searchMode.set(mode)
    this.contentSearchRequest.set(undefined)
    if (mode === "content") this.titleSearch.set("")
  }

  search(): void {
    this.notice.set("")
    this.uiError.set("")
    if (this.searchMode() === "title") {
      this.contentSearchRequest.set(undefined)
      this.titleSearch.set(this.searchText().trim())
      return
    }
    const query = this.searchText().trim()
    if (query.length < 2) {
      this.uiError.set("Enter at least two characters to search conversation text.")
      return
    }
    this.contentSearchRequest.set({
      query,
      archived: this.archiveFilter(),
      project: this.projectFilter(),
      run: ++this.contentSearchRun,
    })
  }

  clearSearch(): void {
    this.searchText.set("")
    this.titleSearch.set("")
    this.contentSearchRequest.set(undefined)
    this.notice.set("")
  }

  clearContentSearch(): void {
    this.contentSearchRequest.set(undefined)
  }

  refreshSessions(): void {
    this.sessionsResource.reload()
  }

  async deleteSession(session: Session): Promise<void> {
    if (this.blockedIDs().includes(session.id)) {
      this.uiError.set("This conversation or one of its child conversations is active. Stop it in OpenCode before deleting.")
      return
    }
    const childCount = this.childCounts()[session.id] ?? 0
    const childNote = childCount > 0 ? ` This also deletes ${childCount} child conversation${childCount === 1 ? "" : "s"}.` : ""
    if (!await this.confirmation.confirm({
      title: "Delete conversation?",
      message: `Permanently delete “${session.title || "Untitled conversation"}”?${childNote} This cannot be undone.`,
      confirmLabel: "Delete conversation",
      danger: true,
    })) return
    this.uiError.set("")
    try {
      const result = await this.api.deleteSession(session.id)
      this.notice.set(`Deleted ${result.deletedSessions} conversation${result.deletedSessions === 1 ? "" : "s"}.`)
      this.clearContentSearch()
      this.refreshSessions()
    } catch (error) {
      this.uiError.set(this.errorMessage(error, "Unable to delete conversation."))
    }
  }

  dismissError(): void {
    this.uiError.set("")
    if (this.sessionsResource.status() === "error") this.sessionsResource.reload()
    if (this.projectsResource.status() === "error") this.projectsResource.reload()
    if (this.contentResource.status() === "error") this.contentSearchRequest.update((request) => request ? { ...request, run: ++this.contentSearchRun } : undefined)
  }

  projectLabel(projectID: string, directory: string): string {
    const project = this.projects().find((item) => item.id === projectID)
    return project?.name || project?.canonical.split("/").filter(Boolean).at(-1) || directory
  }

  setNotice(message: string): void {
    this.notice.set(message)
  }

  setError(message: string): void {
    this.uiError.set(message)
  }

  private buildChildCounts(relationships: SessionRelationship[]): Record<string, number> {
    const children = new Map<string, string[]>()
    for (const { id, parentID } of relationships) {
      if (!parentID) continue
      children.set(parentID, [...(children.get(parentID) ?? []), id])
    }
    const counts = new Map<string, number>()
    const countDescendants = (id: string, path = new Set<string>()): number => {
      if (counts.has(id)) return counts.get(id)!
      if (path.has(id)) return 0
      path.add(id)
      const total = (children.get(id) ?? []).reduce((sum, childID) => sum + 1 + countDescendants(childID, path), 0)
      path.delete(id)
      counts.set(id, total)
      return total
    }
    for (const { id } of relationships) countDescendants(id)
    return Object.fromEntries(counts)
  }

  private buildBlockedIDs(relationships: SessionRelationship[], activeIDs: string[]): string[] {
    const children = new Map<string, string[]>()
    for (const { id, parentID } of relationships) {
      if (!parentID) continue
      children.set(parentID, [...(children.get(parentID) ?? []), id])
    }
    const active = new Set(activeIDs)
    return relationships.filter(({ id }) => {
      const pending = [id]
      const visited = new Set<string>()
      while (pending.length) {
        const current = pending.pop()!
        if (active.has(current)) return true
        if (visited.has(current)) continue
        visited.add(current)
        pending.push(...(children.get(current) ?? []))
      }
      return false
    }).map(({ id }) => id)
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      const details = error.error
      if (details && typeof details === "object" && typeof details.error === "string") return details.error
      if (typeof details === "string" && details.length > 0) return details
    }
    return error instanceof Error ? error.message : fallback
  }
}
