import { provideHttpClient } from "@angular/common/http"
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing"
import { TestBed } from "@angular/core/testing"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { SessionApiService } from "./session-api.service"

describe("SessionApiService", () => {
  let service: SessionApiService
  let http: HttpTestingController

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    })
    service = TestBed.inject(SessionApiService)
    http = TestBed.inject(HttpTestingController)
  })

  afterEach(() => http.verify())

  it("connects to the local OpenCode service", async () => {
    const result = service.connect()
    const request = http.expectOne("/api/connect")
    expect(request.request.method).toBe("POST")
    request.flush({ connected: true, version: "test-version" })
    await expect(result).resolves.toEqual({ connected: true, version: "test-version" })
  })

  it("deletes one session through the OpenCode API", async () => {
    const result = service.deleteSession("ses_test-123")
    const request = http.expectOne("/api/sessions/ses_test-123")
    expect(request.request.method).toBe("DELETE")
    request.flush({ deletedSessions: 1 })
    await expect(result).resolves.toEqual({ deletedSessions: 1 })
  })

  it("requires explicit confirmation when starting database compaction", async () => {
    const result = service.compactDatabase("operation-123")
    const request = http.expectOne("/api/database/compact")
    expect(request.request.method).toBe("POST")
    expect(request.request.body).toEqual({ confirm: true, operationID: "operation-123" })
    request.flush({
      kind: "compacted",
      beforeBytes: 8192,
      afterBytes: 4096,
      bytesReclaimed: 4096,
      beforeConversations: 520,
      afterConversations: 520,
      backupID: "opencode.db.backup",
      backupPath: "/private/opencode.db.backup",
    })
    await expect(result).resolves.toMatchObject({ kind: "compacted", bytesReclaimed: 4096 })
  })

})
