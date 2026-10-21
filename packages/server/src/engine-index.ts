// What the engine's hosts and the modules' server halves use (D16): nothing here reaches node:
// (test/engine.test.ts). The Node host's own exports are index.ts's.
export { CHECKPOINT_PREFIX, CheckpointError, Checkpoints, type Checkpoint, type CheckpointDeps, type CheckpointErrorCode, type RestoreResult } from "./checkpoints.ts";
export {
  commitMerge,
  ConflictError,
  openConflicts,
  prepareMerge,
  type ConflictErrorCode,
  type ConflictFile,
  type Conflicts,
  type FileResolution,
  type PreparedMerge,
} from "./conflicts.ts";
export { diagramRoutes, LAYOUTS, readPositions, saveLayout, withPositions, type Positions } from "./diagrams.ts";
export { body, operation, type Env } from "./bible-routes.ts";
export { moduleRoutes, registerServerModule, type ModuleService, type ServerModule } from "./modules.ts";
export { BibleOperations, clean, required, withProse, type EntityFields, type NoteFields, type EntityTypeFields, type RelationshipFields, type RelationshipTypeFields } from "./bible.ts";
export { ManuscriptOperations, type DeletedItem } from "./manuscript.ts";
export { OperationError, transaction, type FileWrite, type OperationErrorCode, type OperationResult } from "./operations.ts";
export { commitMessage, type FileChange } from "./commit-message.ts";
export { Committer, hasGitIdentity, operationInProgress, type BlockedCode, type CommitResult, type CommitStatus, type CommitterOptions, type LastCommit } from "./committer.ts";
export { atomicWrite, checkPath, FileError, hashText, MAX_FILE_BYTES, TEMP_SUFFIX, type FileErrorCode, type TextFile, type WriteHooks } from "./files.ts";
export { git2GitPort, type Git2Call } from "./git-port/git2.ts";
export { cloneUrl, GitFailure, gitFailure, type GitErrorCode, type GitPort } from "./git-port/port.ts";
export { bookSource, filesPort, gitPort, host, setPorts, type Host, type Ports } from "./ports.ts";
export { templateOf, writeNewBook, type NewNovel } from "./new-book.ts";
export { migrateNovel, migrationWrites } from "./migrate.ts";
export { conversionsFor, convertBook } from "./convert.ts";
export { GitHub, GITHUB_CLIENT_ID, GitHubError, githubRepoOf, memoryStore, SCOPES, unreachable, type AccountStatus, type DeviceCode, type GitHubAccount, type GitHubErrorCode, type GitHubOptions, type GitHubRepo, type PollResult, type RepoSummary, type TokenStore } from "./github.ts";
export { githubRoutes } from "./github-routes.ts";
export { publish, PublishError, type PublishErrorCode, type PublishOptions } from "./publish.ts";
export { Library, LibraryError, type CloneOptions, type LibraryEntry, type LibraryErrorCode, type LibraryNotice } from "./library.ts";
export { commitSource, type CommitSource } from "./git-source.ts";
export { discardedVersions, VERSION_PREFIX, VersionError, Versions, type AdoptResult, type BringResult, type DiscardResult, type Version, type VersionErrorCode, type VersionsDeps } from "./versions.ts";
export { statsRoutes, uncommittedChange, writingHistory } from "./stats.ts";
export { Syncer, type SyncerDeps, type SyncErrorCode, type SyncerOptions, type SyncState, type SyncStatus } from "./sync.ts";
export { NovelWorkspace, Workspaces, type FileEvent, type NovelSyncStatus, type WorkspaceOptions, type WriteResult } from "./workspace.ts";
export { createEngine, type EngineOptions } from "./engine.ts";
export { memoryFilesPort } from "./files-port/memory.ts";
export { portSource, type FileEventType, type FileInfo, type FileKind, type FilesPort, type ListEntry } from "./files-port/port.ts";
export { readKind } from "./workspace.ts";
export { encode, decode, httpChannel, remoteFetch, remoteFilesPort, remoteGitPort, remoteHost, remoteTokenStore, type HostFacts, type PortChannel, type RemoteFailure } from "./remote-ports.ts";
