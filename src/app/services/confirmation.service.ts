import { Injectable, signal } from "@angular/core"

export interface ConfirmationOptions {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
}

@Injectable({ providedIn: "root" })
export class ConfirmationService {
  private readonly pending = signal<ConfirmationOptions | undefined>(undefined)
  readonly request = this.pending.asReadonly()
  private resolve?: (confirmed: boolean) => void

  confirm(options: ConfirmationOptions): Promise<boolean> {
    // Ignore repeated actions while a decision is already pending.
    if (this.resolve) return Promise.resolve(false)
    return new Promise((resolve) => {
      this.resolve = resolve
      this.pending.set(options)
    })
  }

  respond(confirmed: boolean): void {
    const resolve = this.resolve
    this.resolve = undefined
    this.pending.set(undefined)
    resolve?.(confirmed)
  }
}
