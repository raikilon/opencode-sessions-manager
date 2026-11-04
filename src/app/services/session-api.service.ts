import { HttpClient, HttpParams } from "@angular/common/http"
import { Injectable, inject } from "@angular/core"
import { firstValueFrom } from "rxjs"
import { DatabaseBackupInfo, DatabaseCompactionProgress, DatabaseCompactionResult } from "../models/session.models"

@Injectable({ providedIn: "root" })
export class SessionApiService {
  private readonly http = inject(HttpClient)

  getStatus(): Promise<{ available: boolean; connected: boolean; version?: string; compactionProgress?: DatabaseCompactionProgress }> {
    return firstValueFrom(this.http.get<{ available: boolean; connected: boolean; version?: string; compactionProgress?: DatabaseCompactionProgress }>("/api/status"))
  }

  connect(): Promise<{ connected: boolean; version?: string }> {
    return firstValueFrom(this.http.post<{ connected: boolean; version?: string }>("/api/connect", {}))
  }

  deleteSession(sessionID: string): Promise<{ deletedSessions: number }> {
    return firstValueFrom(this.http.delete<{ deletedSessions: number }>(`/api/sessions/${encodeURIComponent(sessionID)}`))
  }

  deleteCleanup(days: number, sessionIDs: string[]): Promise<{ deletedRoots: number; deletedSessions: number }> {
    return firstValueFrom(this.http.post<{ deletedRoots: number; deletedSessions: number }>("/api/cleanup/delete", { days, sessionIDs }))
  }

  compactDatabase(operationID: string): Promise<DatabaseCompactionResult> {
    return firstValueFrom(this.http.post<DatabaseCompactionResult>("/api/database/compact", { confirm: true, operationID }))
  }

  getDatabaseCompactionProgress(operationID: string): Promise<DatabaseCompactionProgress> {
    const params = new HttpParams().set("operationID", operationID)
    return firstValueFrom(this.http.get<DatabaseCompactionProgress>("/api/database/compact/progress", { params }))
  }

  getDatabaseBackups(): Promise<DatabaseBackupInfo[]> {
    return firstValueFrom(this.http.get<DatabaseBackupInfo[]>("/api/database/backups"))
  }

  deleteDatabaseBackup(backupID: string): Promise<{ deleted: boolean; backupID: string }> {
    return firstValueFrom(this.http.delete<{ deleted: boolean; backupID: string }>(`/api/database/backups/${encodeURIComponent(backupID)}`))
  }
}
