import { Component, input, output } from "@angular/core"
import { FormsModule } from "@angular/forms"
import { ArchiveFilter, Project, SearchMode } from "../models/session.models"

@Component({
  selector: "app-session-toolbar",
  standalone: true,
  imports: [FormsModule],
  templateUrl: "./session-toolbar.component.html",
})
export class SessionToolbarComponent {
  readonly projects = input<Project[]>([])
  readonly projectFilter = input("all")
  readonly archiveFilter = input<ArchiveFilter>("false")
  readonly ageFilter = input("all")
  readonly searchMode = input<SearchMode>("title")
  readonly searchText = input("")
  readonly searching = input(false)
  readonly showAgeFilter = input(true)

  readonly projectFilterChange = output<string>()
  readonly archiveFilterChange = output<ArchiveFilter>()
  readonly ageFilterChange = output<string>()
  readonly searchModeChange = output<SearchMode>()
  readonly searchTextChange = output<string>()
  readonly searchRequested = output<void>()
  readonly clearRequested = output<void>()

  changeMode(mode: SearchMode): void {
    this.searchModeChange.emit(mode)
  }
}
