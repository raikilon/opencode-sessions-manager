import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject } from "@angular/core"
import { ConfirmationService } from "../services/confirmation.service"

@Component({
  selector: "app-confirmation-dialog",
  standalone: true,
  templateUrl: "./confirmation-dialog.component.html",
})
export class ConfirmationDialogComponent implements AfterViewInit, OnDestroy {
  readonly confirmation = inject(ConfirmationService)
  @ViewChild("dialog", { static: true }) private dialog!: ElementRef<HTMLDialogElement>
  private previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined

  ngAfterViewInit(): void {
    this.dialog.nativeElement.showModal()
  }

  respond(confirmed: boolean): void {
    this.dialog.nativeElement.close()
    this.confirmation.respond(confirmed)
  }

  cancel(event: Event): void {
    event.preventDefault()
    this.respond(false)
  }

  ngOnDestroy(): void {
    this.dialog.nativeElement.close()
    this.confirmation.respond(false)
    if (this.previousFocus?.isConnected) this.previousFocus.focus()
  }
}
