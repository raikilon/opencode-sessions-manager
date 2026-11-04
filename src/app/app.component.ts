import { Component, OnInit, inject } from "@angular/core"
import { ConfirmationDialogComponent } from "./components/confirmation-dialog.component"
import { ConfirmationService } from "./services/confirmation.service"
import { CleanupDialogComponent } from "./components/cleanup-dialog.component"
import { OverviewCardsComponent } from "./components/overview-cards.component"
import { SessionResultsComponent } from "./components/session-results.component"
import { SessionToolbarComponent } from "./components/session-toolbar.component"
import { CleanupStore } from "./services/cleanup.store"
import { DatabaseMaintenanceStore } from "./services/database-maintenance.store"
import { SessionDashboardStore } from "./services/session-dashboard.store"

@Component({
  selector: "app-root",
  standalone: true,
  imports: [ConfirmationDialogComponent, CleanupDialogComponent, OverviewCardsComponent, SessionResultsComponent, SessionToolbarComponent],
  templateUrl: "./app.component.html",
})
export class AppComponent implements OnInit {
  readonly confirmation = inject(ConfirmationService)
  readonly dashboard = inject(SessionDashboardStore)
  readonly cleanup = inject(CleanupStore)
  readonly maintenance = inject(DatabaseMaintenanceStore)

  async ngOnInit(): Promise<void> {
    await this.dashboard.initialize()
    this.maintenance.resume(this.dashboard.compactionProgress())
  }
}
