// Generated from packages/protocol/python by `pnpm protocol:generate`. Do not edit.

export const PROTOCOL_VERSION = 1;

/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "Activity".
 */
export interface Activity {
  kind: 'thinking' | 'writing' | 'running_tool' | 'waiting_approval' | 'compacting';
  toolName: string | null;
  since: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "AgentMessageItem".
 */
export interface AgentMessageItem {
  id: string;
  kind: 'agent_message';
  text: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ApprovalItem".
 */
export interface ApprovalItem {
  id: string;
  kind: 'approval';
  callId: string;
  title: string;
  preview: string | null;
  previewKind: ('command' | 'diff' | 'text') | null;
  reason: string | null;
  remember: string | null;
  decision: ('allow' | 'allow_always' | 'deny') | null;
  feedback: string | null;
  tool: string;
  args: {
    [k: string]: unknown;
  };
}
/**
 * The ChatGPT account behind a connection that signs in instead of using a key. Tokens never leave the server.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ChatGPTAccountInfo".
 */
export interface ChatGPTAccountInfo {
  email: string | null;
  signedIn: boolean;
  planUsage: boolean;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ChatGPTCancelSignInParams".
 */
export interface ChatGPTCancelSignInParams {
  attemptId: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ChatGPTCancelSignInResult".
 */
export interface ChatGPTCancelSignInResult {}
/**
 * The end of a sign-in, whichever way it ended.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ChatGPTSignInFinishedParams".
 */
export interface ChatGPTSignInFinishedParams {
  attemptId: string;
  result: 'connected' | 'declined' | 'cancelled' | 'timed_out' | 'failed';
  connection?: ConnectionInfo | null;
  message?: string | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ConnectionInfo".
 */
export interface ConnectionInfo {
  name: string;
  provider: string | null;
  baseUrl: string | null;
  billing: 'subscription' | 'usage' | 'none';
  hasKey: boolean;
  account?: ChatGPTAccountInfo | null;
}
/**
 * Starts a sign-in. The app opens ``url`` in the browser and waits for ``chatgpt/signInFinished``. Starting one
 * cancels the sign-in still waiting, if any.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ChatGPTSignInParams".
 */
export interface ChatGPTSignInParams {
  connection?: string | null;
  consent?: boolean;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ChatGPTSignInResult".
 */
export interface ChatGPTSignInResult {
  attemptId: string;
  url: string;
}
/**
 * Ends the connection's sign-in at OpenAI and forgets its tokens. The connection stays, signed out.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ChatGPTSignOutParams".
 */
export interface ChatGPTSignOutParams {
  connection: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ChatGPTSignOutResult".
 */
export interface ChatGPTSignOutResult {
  revoked: boolean;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "CompactionItem".
 */
export interface CompactionItem {
  id: string;
  kind: 'compaction';
  beforeTokens: number;
  afterTokens: number;
}
/**
 * Saves a connection, replacing the one for the same provider or address, and its key.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ConnectionsAddParams".
 */
export interface ConnectionsAddParams {
  provider?: string | null;
  baseUrl?: string | null;
  apiKey?: string | null;
  model: string;
  makeDefault?: boolean;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ConnectionsAddResult".
 */
export interface ConnectionsAddResult {
  connection: ConnectionInfo;
  defaultModel: string | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ConnectionsListParams".
 */
export interface ConnectionsListParams {}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ConnectionsListResult".
 */
export interface ConnectionsListResult {
  connections: ConnectionInfo[];
  defaultModel: string | null;
  providers: ProviderInfo[];
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProviderInfo".
 */
export interface ProviderInfo {
  id: string;
  name: string;
  billing: 'subscription' | 'usage' | 'none';
  keyEnv: string;
}
/**
 * A saved connection by ``connection``, or one that may not be saved yet: a provider, or the address of a
 * compatible server. A ChatGPT connection is always a saved one.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ConnectionsModelsParams".
 */
export interface ConnectionsModelsParams {
  connection?: string | null;
  provider?: string | null;
  baseUrl?: string | null;
  apiKey?: string | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ConnectionsModelsResult".
 */
export interface ConnectionsModelsResult {
  models: string[];
  hidden?: string[];
}
/**
 * Forgets a connection and its saved key. A default model on it is cleared, so new sessions need a choice.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ConnectionsRemoveParams".
 */
export interface ConnectionsRemoveParams {
  connection: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ConnectionsRemoveResult".
 */
export interface ConnectionsRemoveResult {
  defaultModel: string | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ConnectionsSetDefaultParams".
 */
export interface ConnectionsSetDefaultParams {
  model: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ConnectionsSetDefaultResult".
 */
export interface ConnectionsSetDefaultResult {
  defaultModel: string;
}
/**
 * Shows a model of a saved connection in the picker, or leaves it out.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ConnectionsShowModelParams".
 */
export interface ConnectionsShowModelParams {
  connection: string;
  model: string;
  shown: boolean;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ConnectionsShowModelResult".
 */
export interface ConnectionsShowModelResult {}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "DeletedEvent".
 */
export interface DeletedEvent {
  type?: 'deleted';
}
/**
 * ``data`` of an error the app can act on, beyond its message.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ErrorData".
 */
export interface ErrorData {
  reason:
    | 'auth'
    | 'unreachable'
    | 'unsupported'
    | 'other'
    | 'not_a_folder'
    | 'invalid_config'
    | 'exists'
    | 'clone_failed'
    | 'invalid_name'
    | 'package_not_approved'
    | 'install_failed'
    | 'name_taken'
    | 'profile_conflict'
    | 'model_failed'
    | 'not_found'
    | 'memory_full';
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ErrorObject".
 */
export interface ErrorObject {
  code: number;
  message: string;
  data?: {
    [k: string]: unknown;
  };
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "GitInfo".
 */
export interface GitInfo {
  branch: string | null;
  added: number;
  deleted: number;
  pullRequest: PullRequestInfo | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "PullRequestInfo".
 */
export interface PullRequestInfo {
  number: number;
  url: string;
  checks: ('passing' | 'failing' | 'pending') | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "InfoChangedEvent".
 */
export interface InfoChangedEvent {
  type?: 'info_changed';
  info: SessionInfo;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionInfo".
 */
export interface SessionInfo {
  id: string;
  title: string;
  cwd: string;
  model: string;
  mode: 'default' | 'accept_edits' | 'yolo';
  status: 'idle' | 'running' | 'waiting' | 'failed';
  createdAt: string;
  updatedAt: string;
  usage: Usage;
  contextUsed: number;
  contextWindow: number | null;
  activity: Activity | null;
  runStartedAt: string | null;
  runUsage: Usage | null;
  profile: string | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "Usage".
 */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  requests: number;
  cost: number | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "InitializeParams".
 */
export interface InitializeParams {
  protocolVersion: number;
  clientName: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "InitializeResult".
 */
export interface InitializeResult {
  protocolVersion: number;
  server: ServerInfo;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ServerInfo".
 */
export interface ServerInfo {
  name: string;
  version: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ItemCompletedEvent".
 */
export interface ItemCompletedEvent {
  type?: 'item_completed';
  item:
    | UserMessageItem
    | AgentMessageItem
    | ToolCallItem
    | ApprovalItem
    | NoticeItem
    | StatusLineItem
    | MemoryReviewItem
    | CompactionItem
    | RunStoppedItem;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "UserMessageItem".
 */
export interface UserMessageItem {
  id: string;
  kind: 'user_message';
  text: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ToolCallItem".
 */
export interface ToolCallItem {
  id: string;
  kind: 'tool_call';
  name: string;
  args: {
    [k: string]: unknown;
  };
  status: 'running' | 'done' | 'error' | 'input_error' | 'aborted' | 'interrupted' | 'denied' | 'cancelled';
  result: string | null;
  images: number;
}
/**
 * A message the model reads that the user did not write.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "NoticeItem".
 */
export interface NoticeItem {
  id: string;
  kind: 'notice';
  text: string;
  source: string;
}
/**
 * A line only the user reads.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "StatusLineItem".
 */
export interface StatusLineItem {
  id: string;
  kind: 'status_line';
  text: string;
}
/**
 * Something the harness noticed about the project's memory during the run, waiting on the memory page. Only the
 * user reads it.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "MemoryReviewItem".
 */
export interface MemoryReviewItem {
  id: string;
  kind: 'memory_review';
  source: string;
  count: number;
}
/**
 * Why a run ended other than by answering.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "RunStoppedItem".
 */
export interface RunStoppedItem {
  id: string;
  kind: 'run_stopped';
  reason: 'interrupted' | 'failed' | 'limit' | 'repeating' | 'permission' | 'plan_limit' | 'signed_out';
  message: string | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ItemDeltaEvent".
 */
export interface ItemDeltaEvent {
  type?: 'item_delta';
  itemId: string;
  text: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ItemDiscardedEvent".
 */
export interface ItemDiscardedEvent {
  type?: 'item_discarded';
  itemId: string;
}
/**
 * Base of the items. Serialized in full, so ``kind`` and nulls are always present.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ItemModel".
 */
export interface ItemModel {}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ItemStartedEvent".
 */
export interface ItemStartedEvent {
  type?: 'item_started';
  item:
    | UserMessageItem
    | AgentMessageItem
    | ToolCallItem
    | ApprovalItem
    | NoticeItem
    | StatusLineItem
    | MemoryReviewItem
    | CompactionItem
    | RunStoppedItem;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "MemoryApproveParams".
 */
export interface MemoryApproveParams {
  cwd: string;
  suggestionId: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "MemoryApproveResult".
 */
export interface MemoryApproveResult {
  memory: MemoryInfo;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "MemoryInfo".
 */
export interface MemoryInfo {
  id: string;
  kind: string;
  scope: 'team' | 'project_me' | 'me';
  headline: string;
  body: string;
  path: string | null;
  evidence: MemoryEvidence[];
  saidAgain: MemoryEvidence[];
  check?: MemoryCheck | null;
  guard?: MemoryGuard | null;
}
/**
 * Where a suggestion came from, as the harness saw it.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "MemoryEvidence".
 */
export interface MemoryEvidence {
  sessionId: string;
  at: string;
  quote: string;
}
/**
 * What the harness checks while the agent works, in the forms of docs/memory.md (English, for the model).
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "MemoryCheck".
 */
export interface MemoryCheck {
  when: string;
  expect: string;
  say: string;
}
/**
 * A call the user is always asked about, whatever the mode.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "MemoryGuard".
 */
export interface MemoryGuard {
  before: string;
  say: string;
}
/**
 * A project's memories or suggestions changed; ``memory/list`` has the new ones.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "MemoryChangedParams".
 */
export interface MemoryChangedParams {
  cwd: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "MemoryForgetParams".
 */
export interface MemoryForgetParams {
  cwd: string;
  scope: 'team' | 'project_me' | 'me';
  memoryId: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "MemoryForgetResult".
 */
export interface MemoryForgetResult {}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "MemoryListParams".
 */
export interface MemoryListParams {
  cwd: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "MemoryListResult".
 */
export interface MemoryListResult {
  memories: MemoryInfo[];
  pending: MemorySuggestionInfo[];
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "MemorySuggestionInfo".
 */
export interface MemorySuggestionInfo {
  id: string;
  kind: string;
  scope: 'team' | 'project_me' | 'me';
  headline: string;
  body: string;
  replaces: string[];
  evidence: MemoryEvidence[];
  source: string;
  remove: boolean;
  check?: MemoryCheck | null;
  guard?: MemoryGuard | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "MemoryRejectParams".
 */
export interface MemoryRejectParams {
  cwd: string;
  suggestionId: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "MemoryRejectResult".
 */
export interface MemoryRejectResult {}
/**
 * A tool a session can get, and where it comes from.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "OfferedTool".
 */
export interface OfferedTool {
  tool: ToolSummary;
  origin: 'builtin' | 'memory' | 'user';
  optional: boolean;
}
/**
 * A tool as the model sees it.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ToolSummary".
 */
export interface ToolSummary {
  name: string;
  description: string;
  params: ToolParam[];
  readOnly: boolean;
  openWorld: boolean;
  ask: 'never' | 'edit' | 'ask';
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ToolParam".
 */
export interface ToolParam {
  name: string;
  type: string;
  description: string;
  required: boolean;
  default:
    | string
    | number
    | boolean
    | unknown[]
    | {
        [k: string]: unknown;
      }
    | null;
}
/**
 * What the approval of a package Alpine has not reviewed shows. Facts PyPI did not give are ``None``.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "PackageInfo".
 */
export interface PackageInfo {
  name: string;
  firstRelease: string | null;
  lastMonthDownloads: number | null;
  similar: string[];
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProfileInfo".
 */
export interface ProfileInfo {
  id: string;
  name: string;
  project: string | null;
  model: string | null;
  tools: string[];
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProfilesDeleteParams".
 */
export interface ProfilesDeleteParams {
  id: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProfilesDeleteResult".
 */
export interface ProfilesDeleteResult {}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProfilesListParams".
 */
export interface ProfilesListParams {}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProfilesListResult".
 */
export interface ProfilesListResult {
  profiles: ProfileInfo[];
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProfilesResolveParams".
 */
export interface ProfilesResolveParams {
  cwd: string;
  model?: string | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProfilesResolveResult".
 */
export interface ProfilesResolveResult {
  profile: ProfileInfo;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProfilesSaveParams".
 */
export interface ProfilesSaveParams {
  profile: ProfileInfo;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProfilesSaveResult".
 */
export interface ProfilesSaveResult {
  profile: ProfileInfo;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProjectInfo".
 */
export interface ProjectInfo {
  path: string;
  name: string;
  branch: string | null;
  lastUsedAt: string;
  archived: boolean;
}
/**
 * Takes a project off the rail; its sessions stay, and opening the folder brings it back.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProjectsArchiveParams".
 */
export interface ProjectsArchiveParams {
  path: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProjectsArchiveResult".
 */
export interface ProjectsArchiveResult {}
/**
 * Clones into ``parent/<repo name>`` and opens it. Blocks until git is done.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProjectsCloneParams".
 */
export interface ProjectsCloneParams {
  address: string;
  parent: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProjectsCloneResult".
 */
export interface ProjectsCloneResult {
  project: ProjectInfo;
}
/**
 * Forgets a project and what Alpine keeps about it. The folder and its files are never touched.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProjectsDeleteParams".
 */
export interface ProjectsDeleteParams {
  path: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProjectsDeleteResult".
 */
export interface ProjectsDeleteResult {}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProjectsGitParams".
 */
export interface ProjectsGitParams {
  path: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProjectsGitResult".
 */
export interface ProjectsGitResult {
  git: GitInfo | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProjectsListParams".
 */
export interface ProjectsListParams {}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProjectsListResult".
 */
export interface ProjectsListResult {
  projects: ProjectInfo[];
  cloneParent: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProjectsOpenParams".
 */
export interface ProjectsOpenParams {
  path: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProjectsOpenResult".
 */
export interface ProjectsOpenResult {
  project: ProjectInfo;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "Request".
 */
export interface Request {
  jsonrpc?: '2.0';
  id?: number | string | null;
  method: string;
  params?: {
    [k: string]: unknown;
  } | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "Response".
 */
export interface Response {
  jsonrpc?: '2.0';
  id: number | string | null;
  result?: {
    [k: string]: unknown;
  };
  error?: ErrorObject | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionAnswerParams".
 */
export interface SessionAnswerParams {
  sessionId: string;
  requestId: string;
  decision: 'allow' | 'allow_always' | 'deny';
  feedback?: string | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionAnswerResult".
 */
export interface SessionAnswerResult {
  accepted: boolean;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionCancelParams".
 */
export interface SessionCancelParams {
  sessionId: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionCancelResult".
 */
export interface SessionCancelResult {}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionDeleteParams".
 */
export interface SessionDeleteParams {
  sessionId: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionDeleteResult".
 */
export interface SessionDeleteResult {}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionEventParams".
 */
export interface SessionEventParams {
  sessionId: string;
  seq: number;
  event: InfoChangedEvent | DeletedEvent | ItemStartedEvent | ItemDeltaEvent | ItemCompletedEvent | ItemDiscardedEvent;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionListParams".
 */
export interface SessionListParams {}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionListResult".
 */
export interface SessionListResult {
  sessions: SessionInfo[];
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionNewParams".
 */
export interface SessionNewParams {
  cwd: string;
  model?: string | null;
  mode?: ('default' | 'accept_edits' | 'yolo') | null;
  profile?: string | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionNewResult".
 */
export interface SessionNewResult {
  info: SessionInfo;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionOpenParams".
 */
export interface SessionOpenParams {
  sessionId: string;
}
/**
 * A snapshot. Apply the events whose ``seq`` is greater than ``seq``.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionOpenResult".
 */
export interface SessionOpenResult {
  info: SessionInfo;
  seq: number;
  items: (
    | UserMessageItem
    | AgentMessageItem
    | ToolCallItem
    | ApprovalItem
    | NoticeItem
    | StatusLineItem
    | MemoryReviewItem
    | CompactionItem
    | RunStoppedItem
  )[];
  active: (
    | UserMessageItem
    | AgentMessageItem
    | ToolCallItem
    | ApprovalItem
    | NoticeItem
    | StatusLineItem
    | MemoryReviewItem
    | CompactionItem
    | RunStoppedItem
  )[];
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionSendParams".
 */
export interface SessionSendParams {
  sessionId: string;
  text: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionSendResult".
 */
export interface SessionSendResult {}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionSetModeParams".
 */
export interface SessionSetModeParams {
  sessionId: string;
  mode: 'default' | 'accept_edits' | 'yolo';
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionSetModeResult".
 */
export interface SessionSetModeResult {
  info: SessionInfo;
}
/**
 * Switches the model from the next message on; the conversation goes on. Not while the session runs.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionSetModelParams".
 */
export interface SessionSetModelParams {
  sessionId: string;
  model: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionSetModelResult".
 */
export interface SessionSetModelResult {
  info: SessionInfo;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ToolFileInfo".
 */
export interface ToolFileInfo {
  name: string;
  status: 'ready' | 'unconfirmed' | 'error';
  error: string | null;
  missingPackage: string | null;
  changedAt: string | null;
  tools: ToolSummary[];
  packages: string[];
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ToolsCheckParams".
 */
export interface ToolsCheckParams {
  source: string;
}
/**
 * The unsaved source, loaded. Nothing is loaded while ``needs_approval`` is not empty.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ToolsCheckResult".
 */
export interface ToolsCheckResult {
  tools: ToolSummary[];
  packages: string[];
  error: string | null;
  missingPackage: string | null;
  needsApproval: PackageInfo[];
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ToolsConfirmParams".
 */
export interface ToolsConfirmParams {
  name: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ToolsConfirmResult".
 */
export interface ToolsConfirmResult {
  file: ToolFileInfo;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ToolsDeleteParams".
 */
export interface ToolsDeleteParams {
  name: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ToolsDeleteResult".
 */
export interface ToolsDeleteResult {}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ToolsDraftParams".
 */
export interface ToolsDraftParams {
  description: string;
  model?: string | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ToolsDraftResult".
 */
export interface ToolsDraftResult {
  source: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ToolsInstallParams".
 */
export interface ToolsInstallParams {
  packages: string[];
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ToolsInstallResult".
 */
export interface ToolsInstallResult {}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ToolsListParams".
 */
export interface ToolsListParams {
  cwd?: string | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ToolsListResult".
 */
export interface ToolsListResult {
  tools: OfferedTool[];
  files: ToolFileInfo[];
  folder: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ToolsSaveParams".
 */
export interface ToolsSaveParams {
  name: string;
  source: string;
  enableIn?: string | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ToolsSaveResult".
 */
export interface ToolsSaveResult {
  file: ToolFileInfo;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ToolsSourceParams".
 */
export interface ToolsSourceParams {
  name: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ToolsSourceResult".
 */
export interface ToolsSourceResult {
  source: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ToolsTestParams".
 */
export interface ToolsTestParams {
  source: string;
  tool: string;
  args: {
    [k: string]: unknown;
  };
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ToolsTestResult".
 */
export interface ToolsTestResult {
  ok: boolean;
  output: string;
  seconds: number;
}

export interface Methods {
  'initialize': { params: InitializeParams; result: InitializeResult };
  'connections/list': { params: ConnectionsListParams; result: ConnectionsListResult };
  'connections/models': { params: ConnectionsModelsParams; result: ConnectionsModelsResult };
  'connections/add': { params: ConnectionsAddParams; result: ConnectionsAddResult };
  'connections/remove': { params: ConnectionsRemoveParams; result: ConnectionsRemoveResult };
  'connections/showModel': { params: ConnectionsShowModelParams; result: ConnectionsShowModelResult };
  'connections/setDefault': { params: ConnectionsSetDefaultParams; result: ConnectionsSetDefaultResult };
  'chatgpt/signIn': { params: ChatGPTSignInParams; result: ChatGPTSignInResult };
  'chatgpt/cancelSignIn': { params: ChatGPTCancelSignInParams; result: ChatGPTCancelSignInResult };
  'chatgpt/signOut': { params: ChatGPTSignOutParams; result: ChatGPTSignOutResult };
  'projects/list': { params: ProjectsListParams; result: ProjectsListResult };
  'projects/open': { params: ProjectsOpenParams; result: ProjectsOpenResult };
  'projects/archive': { params: ProjectsArchiveParams; result: ProjectsArchiveResult };
  'projects/delete': { params: ProjectsDeleteParams; result: ProjectsDeleteResult };
  'projects/clone': { params: ProjectsCloneParams; result: ProjectsCloneResult };
  'projects/git': { params: ProjectsGitParams; result: ProjectsGitResult };
  'tools/list': { params: ToolsListParams; result: ToolsListResult };
  'tools/source': { params: ToolsSourceParams; result: ToolsSourceResult };
  'tools/check': { params: ToolsCheckParams; result: ToolsCheckResult };
  'tools/save': { params: ToolsSaveParams; result: ToolsSaveResult };
  'tools/confirm': { params: ToolsConfirmParams; result: ToolsConfirmResult };
  'tools/delete': { params: ToolsDeleteParams; result: ToolsDeleteResult };
  'tools/install': { params: ToolsInstallParams; result: ToolsInstallResult };
  'tools/test': { params: ToolsTestParams; result: ToolsTestResult };
  'tools/draft': { params: ToolsDraftParams; result: ToolsDraftResult };
  'profiles/list': { params: ProfilesListParams; result: ProfilesListResult };
  'profiles/save': { params: ProfilesSaveParams; result: ProfilesSaveResult };
  'profiles/delete': { params: ProfilesDeleteParams; result: ProfilesDeleteResult };
  'profiles/resolve': { params: ProfilesResolveParams; result: ProfilesResolveResult };
  'memory/list': { params: MemoryListParams; result: MemoryListResult };
  'memory/approve': { params: MemoryApproveParams; result: MemoryApproveResult };
  'memory/reject': { params: MemoryRejectParams; result: MemoryRejectResult };
  'memory/forget': { params: MemoryForgetParams; result: MemoryForgetResult };
  'session/new': { params: SessionNewParams; result: SessionNewResult };
  'session/list': { params: SessionListParams; result: SessionListResult };
  'session/open': { params: SessionOpenParams; result: SessionOpenResult };
  'session/send': { params: SessionSendParams; result: SessionSendResult };
  'session/cancel': { params: SessionCancelParams; result: SessionCancelResult };
  'session/answer': { params: SessionAnswerParams; result: SessionAnswerResult };
  'session/setMode': { params: SessionSetModeParams; result: SessionSetModeResult };
  'session/setModel': { params: SessionSetModelParams; result: SessionSetModelResult };
  'session/delete': { params: SessionDeleteParams; result: SessionDeleteResult };
}

export interface Notifications {
  'session/event': SessionEventParams;
  'chatgpt/signInFinished': ChatGPTSignInFinishedParams;
  'memory/changed': MemoryChangedParams;
}
