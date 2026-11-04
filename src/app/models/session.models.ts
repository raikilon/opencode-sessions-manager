export interface Session {
  id: string
  parentID?: string
  projectID: string
  title?: string
  location: { directory: string }
  time: { created: number; updated: number; archived?: number }
}

export interface Project {
  id: string
  name?: string
  canonical: string
}

export interface SessionRelationship {
  id: string
  parentID?: string
}

export interface SearchMatch {
  sessionID: string
  title: string
  projectID: string
  directory: string
  updated: number
  snippets: string[]
}

export interface ContentSearchResponse {
  totalSessions: number
  failedSessions: number
  matches: SearchMatch[]
}

export type ArchiveFilter = "false" | "true" | "all"
export type SearchMode = "title" | "content"

export interface SessionsResponse {
  data: Session[]
  activeIDs: string[]
  totalSessions: number
  database: DatabaseFootprint
  relationships: SessionRelationship[]
}

export interface DatabaseFootprint {
  available: boolean
  databaseBytes: number | null
  walBytes: number
  totalBytes: number | null
  source: string
}

export interface DatabaseCompactionResult {
  kind: "compacted"
  beforeBytes: number
  afterBytes: number
  bytesReclaimed: number
  beforeConversations: number
  afterConversations: number
  backupID: string
  backupPath: string
}

export type DatabaseCompactionState = "idle" | "running" | "completed" | "failed" | "blocked"

export interface DatabaseCompactionProgress {
  state: DatabaseCompactionState
  stage: string
  message: string
  operationID?: string
  updatedAt?: number
  backupID?: string
  error?: string
  result?: DatabaseCompactionResult
}

export interface DatabaseBackupInfo {
  id: string
  sizeBytes: number
  createdAt: number
  verified: boolean
  beforeBytes?: number
  afterBytes?: number
  verifiedConversationCount?: number
}

export interface CleanupCandidate {
  session: Session
  affectedCount: number
  affectedIDs: string[]
  affectedSessions: Session[]
}

export interface CleanupPreview {
  candidates: CleanupCandidate[]
  eligibleCount: number
  protectedCount: number
  totalSessions: number
  database: DatabaseFootprint
}
