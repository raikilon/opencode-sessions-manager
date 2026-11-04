import { Component, input, output } from "@angular/core"
import { Project, SearchMatch, Session } from "../models/session.models"

@Component({
  selector: "app-session-results",
  standalone: true,
  templateUrl: "./session-results.component.html",
})
export class SessionResultsComponent {
  readonly sessions = input<Session[]>([])
  readonly totalConversations = input(0)
  readonly activeIDs = input<string[]>([])
  readonly projects = input<Project[]>([])
  readonly contentMatches = input<SearchMatch[] | undefined>(undefined)
  readonly loading = input(false)
  readonly titleSearch = input("")
  readonly childCounts = input<Record<string, number>>({})
  readonly blockedIDs = input<string[]>([])
  readonly refreshRequested = output<void>()
  readonly backToSessions = output<void>()
  readonly deleteRequested = output<Session>()

  private readonly dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })

  projectLabel(projectID: string, directory: string): string {
    const project = this.projects().find((item) => item.id === projectID)
    return project?.name || project?.canonical.split("/").filter(Boolean).at(-1) || directory
  }

  formatDate(timestamp: number): string {
    return this.dateFormat.format(new Date(timestamp))
  }

  sessionFor(sessionID: string): Session | undefined {
    return this.sessions().find((session) => session.id === sessionID)
  }

  isBlocked(sessionID: string): boolean {
    return this.blockedIDs().includes(sessionID)
  }
}
