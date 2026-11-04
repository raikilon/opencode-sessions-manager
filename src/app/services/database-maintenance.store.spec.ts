import { provideHttpClient } from "@angular/common/http"
import { provideHttpClientTesting } from "@angular/common/http/testing"
import { TestBed } from "@angular/core/testing"
import { signal } from "@angular/core"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DatabaseMaintenanceStore } from "./database-maintenance.store"
import { SessionDashboardStore } from "./session-dashboard.store"
import { SessionApiService } from "./session-api.service"

describe("DatabaseMaintenanceStore recovery", () => {
  afterEach(() => { TestBed.resetTestingModule(); vi.useRealTimers() })
  it("keeps maintenance active after a failed poll and retries to a terminal state", async () => {
    vi.useFakeTimers()
    const readProgress = vi.fn()
      .mockRejectedValueOnce(new Error("Connection interrupted"))
      .mockResolvedValueOnce({ state: "failed", stage: "compacting", message: "Database busy" })
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(), provideHttpClientTesting(),
      { provide: SessionApiService, useValue: { getDatabaseCompactionProgress: readProgress } },
      { provide: SessionDashboardStore, useValue: { connected: signal(false), refreshConnectionStatus: vi.fn(async () => {}) } },
    ] })
    const store = TestBed.inject(DatabaseMaintenanceStore)
    store.resume({ state: "running", stage: "compacting", message: "Working", operationID: "test" })
    await vi.advanceTimersByTimeAsync(0)
    expect(store.compacting()).toBe(true)
    expect(store.progressWarning()).toContain("retrying")
    await vi.advanceTimersByTimeAsync(1500)
    expect(readProgress).toHaveBeenCalledTimes(2)
    expect(store.compacting()).toBe(false)
    expect(store.error()).toBe("Database busy")
    expect(store.progressWarning()).toBe("")
  })
})
