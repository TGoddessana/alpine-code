// Generated from packages/protocol/python by `pnpm protocol:generate`. Do not edit.

export const PROTOCOL_VERSION = 1;

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
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ConnectionInfo".
 */
export interface ConnectionInfo {
  name: string;
  provider: string | null;
  baseUrl: string | null;
  billing: 'subscription' | 'usage' | 'none';
  hasKey: boolean;
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
 * A connection that may not be saved yet: a provider, or the address of a compatible server.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ConnectionsModelsParams".
 */
export interface ConnectionsModelsParams {
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
    'auth' | 'unreachable' | 'unsupported' | 'other' | 'not_a_folder' | 'invalid_config' | 'exists' | 'clone_failed';
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
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "Usage".
 */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  requests: number;
  cost: number;
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
 * Why a run ended other than by answering.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "RunStoppedItem".
 */
export interface RunStoppedItem {
  id: string;
  kind: 'run_stopped';
  reason: 'interrupted' | 'failed' | 'limit' | 'repeating' | 'permission';
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
    | CompactionItem
    | RunStoppedItem;
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

export interface Methods {
  'initialize': { params: InitializeParams; result: InitializeResult };
  'connections/list': { params: ConnectionsListParams; result: ConnectionsListResult };
  'connections/models': { params: ConnectionsModelsParams; result: ConnectionsModelsResult };
  'connections/add': { params: ConnectionsAddParams; result: ConnectionsAddResult };
  'connections/setDefault': { params: ConnectionsSetDefaultParams; result: ConnectionsSetDefaultResult };
  'projects/list': { params: ProjectsListParams; result: ProjectsListResult };
  'projects/open': { params: ProjectsOpenParams; result: ProjectsOpenResult };
  'projects/archive': { params: ProjectsArchiveParams; result: ProjectsArchiveResult };
  'projects/delete': { params: ProjectsDeleteParams; result: ProjectsDeleteResult };
  'projects/clone': { params: ProjectsCloneParams; result: ProjectsCloneResult };
  'projects/git': { params: ProjectsGitParams; result: ProjectsGitResult };
  'session/new': { params: SessionNewParams; result: SessionNewResult };
  'session/list': { params: SessionListParams; result: SessionListResult };
  'session/open': { params: SessionOpenParams; result: SessionOpenResult };
  'session/send': { params: SessionSendParams; result: SessionSendResult };
  'session/cancel': { params: SessionCancelParams; result: SessionCancelResult };
  'session/answer': { params: SessionAnswerParams; result: SessionAnswerResult };
  'session/setMode': { params: SessionSetModeParams; result: SessionSetModeResult };
  'session/delete': { params: SessionDeleteParams; result: SessionDeleteResult };
}

export interface Notifications {
  'session/event': SessionEventParams;
}
