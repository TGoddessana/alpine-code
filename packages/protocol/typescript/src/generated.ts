// Generated from packages/protocol/python by `pnpm protocol:generate`. Do not edit.

export const PROTOCOL_VERSION = 2;

/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "Activity".
 */
export interface Activity {
  kind: 'thinking' | 'writing' | 'running_tool' | 'reviewing' | 'waiting_approval' | 'compacting';
  toolName: string | null;
  since: string;
}
/**
 * The agent was edited between two turns in a way the model sees.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "AgentChangedItem".
 */
export interface AgentChangedItem {
  id: string;
  kind: 'agent_changed';
  agent: string;
  name: string;
  look:
    | 'antenna'
    | 'hardhat'
    | 'glasses'
    | 'beret'
    | 'headphones'
    | 'cap'
    | 'chef'
    | 'sprout'
    | 'ribbon'
    | 'beanie'
    | 'bowtie'
    | 'grad';
  color: number;
  added: string[];
  removed: string[];
  instructions: boolean;
  model: string | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "AgentInfo".
 */
export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  model: string | null;
  instructions: string;
  tools: string[];
  look:
    | 'antenna'
    | 'hardhat'
    | 'glasses'
    | 'beret'
    | 'headphones'
    | 'cap'
    | 'chef'
    | 'sprout'
    | 'ribbon'
    | 'beanie'
    | 'bowtie'
    | 'grad';
  color: number;
  skillsOff?: string[];
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "AgentMessageItem".
 */
export interface AgentMessageItem {
  id: string;
  kind: 'agent_message';
  text: string;
  agent: string | null;
}
/**
 * The session went on with another agent from here.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "AgentSwitchedItem".
 */
export interface AgentSwitchedItem {
  id: string;
  kind: 'agent_switched';
  agent: string;
  name: string;
  look:
    | 'antenna'
    | 'hardhat'
    | 'glasses'
    | 'beret'
    | 'headphones'
    | 'cap'
    | 'chef'
    | 'sprout'
    | 'ribbon'
    | 'beanie'
    | 'bowtie'
    | 'grad';
  color: number;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "AgentsDeleteParams".
 */
export interface AgentsDeleteParams {
  id: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "AgentsDeleteResult".
 */
export interface AgentsDeleteResult {}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "AgentsListParams".
 */
export interface AgentsListParams {}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "AgentsListResult".
 */
export interface AgentsListResult {
  agents: AgentInfo[];
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "AgentsSaveParams".
 */
export interface AgentsSaveParams {
  agent: AgentInfo;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "AgentsSaveResult".
 */
export interface AgentsSaveResult {
  agent: AgentInfo;
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
  review: ('blocked_in_a_row' | 'failed') | null;
  reviewError: string | null;
  askedBy: string[];
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
 * Facts Alpine recorded about one check run (decisions 1 and 2).
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "CheckStamp".
 */
export interface CheckStamp {
  at: string;
  sessionId?: string | null;
  firstSeen?: boolean;
  witness?: 'mine' | 'other' | 'mismatch';
  uncertain?: boolean;
}
/**
 * A repository being brought to this computer, or one that stopped before it got here.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "CloneInfo".
 */
export interface CloneInfo {
  id: string;
  address: string;
  name: string;
  path: string;
  state: 'receiving' | 'failed' | 'done' | 'cancelled';
  percent: number;
  received?: number | null;
  reason?: ('no_access' | 'unreachable' | 'clone_failed') | null;
  message?: string | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "CommandResult".
 */
export interface CommandResult {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  timedOut?: boolean;
  cancelled?: boolean;
  message?: string | null;
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
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "DevServerConflict".
 */
export interface DevServerConflict {
  port: number;
  pid?: number | null;
  cwd?: string | null;
  canReuse?: boolean;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "DevServerInfo".
 */
export interface DevServerInfo {
  id: string;
  cwd: string;
  command: string;
  port: number;
  url?: string | null;
  processId?: string | null;
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';
  external?: boolean;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "DevServersListParams".
 */
export interface DevServersListParams {
  cwd: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "DevServersListResult".
 */
export interface DevServersListResult {
  servers: DevServerInfo[];
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "DevServersLogsParams".
 */
export interface DevServersLogsParams {
  id: string;
  offset?: number;
  limit?: number;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "DevServersLogsResult".
 */
export interface DevServersLogsResult {
  text: string;
  nextOffset: number;
  total: number;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "DevServersRestartParams".
 */
export interface DevServersRestartParams {
  id: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "DevServersRestartResult".
 */
export interface DevServersRestartResult {
  server?: DevServerInfo | null;
  conflict?: DevServerConflict | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "DevServersStartParams".
 */
export interface DevServersStartParams {
  cwd: string;
  command: string;
  port: number;
  sessionId?: string | null;
  reuse?: boolean;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "DevServersStartResult".
 */
export interface DevServersStartResult {
  server?: DevServerInfo | null;
  conflict?: DevServerConflict | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "DevServersStopParams".
 */
export interface DevServersStopParams {
  id: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "DevServersStopResult".
 */
export interface DevServersStopResult {
  server: DevServerInfo;
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
    | 'no_access'
    | 'no_git_tools'
    | 'invalid_name'
    | 'package_not_approved'
    | 'install_failed'
    | 'name_taken'
    | 'agent_not_found'
    | 'model_failed'
    | 'not_found'
    | 'memory_full'
    | 'flow_conflict'
    | 'invalid_flow'
    | 'invalid_flow_path'
    | 'map_read_only'
    | 'reason_required'
    | 'replay_changed'
    | 'flow_busy'
    | 'unknown_source'
    | 'offline'
    | 'too_big'
    | 'bad_archive'
    | 'no_skills'
    | 'not_a_skill'
    | 'bad_name'
    | 'not_owned'
    | 'invalid'
    | 'import_failed'
    | 'taskforce_not_found'
    | 'taskforce_state';
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
 * A conversation Claude Code or Codex had in the folder, which can be carried over and continued here.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ExternalSessionInfo".
 */
export interface ExternalSessionInfo {
  source: 'claude_code' | 'codex';
  id: string;
  title: string;
  updatedAt: string;
  imported: string | null;
}
/**
 * ``.alpine-code/map/features/<id>.json``: one card, written by the agent.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FeatureFile".
 */
export interface FeatureFile {
  id: string;
  title: string;
  description?: string;
  kind?: 'screen' | 'api' | 'sdk' | 'process' | 'data';
  /**
   * @maxItems 50
   */
  tags?: string[];
  phase?: 'planned' | 'building' | 'built';
  /**
   * @maxItems 100
   */
  sources?: string[];
  preview?: string | null;
  previewAt?: string | null;
  example?: string;
  howToTry?: string;
  /**
   * @maxItems 60
   */
  conditions?: FlowCondition[];
  /**
   * @maxItems 60
   */
  checks?: FlowCheck[];
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FlowCondition".
 */
export interface FlowCondition {
  id: string;
  expectation: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FlowCheck".
 */
export interface FlowCheck {
  id?: string;
  conditionId?: string | null;
  expectation?: string;
  summary: string;
  command: string;
  result: 'passed' | 'failed' | 'blocked';
  output: string;
  /**
   * @maxItems 200
   */
  dependsOn?: string[];
  plain?: string;
  screenshot?: string | null;
  /**
   * @maxItems 20
   */
  steps?:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ];
  /**
   * @maxItems 20
   */
  observations?:
    | []
    | [Observation]
    | [Observation, Observation]
    | [Observation, Observation, Observation]
    | [Observation, Observation, Observation, Observation]
    | [Observation, Observation, Observation, Observation, Observation]
    | [Observation, Observation, Observation, Observation, Observation, Observation]
    | [Observation, Observation, Observation, Observation, Observation, Observation, Observation]
    | [Observation, Observation, Observation, Observation, Observation, Observation, Observation, Observation]
    | [
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation
      ]
    | [
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation
      ]
    | [
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation
      ]
    | [
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation
      ]
    | [
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation
      ]
    | [
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation
      ]
    | [
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation
      ]
    | [
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation
      ]
    | [
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation
      ]
    | [
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation
      ]
    | [
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation
      ]
    | [
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation,
        Observation
      ];
  /**
   * @maxItems 20
   */
  limits?:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ];
  environment?: string;
  replay?: FlowReplay | null;
}
/**
 * One thing the agent saw while checking a promise, in words a non-developer can read.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "Observation".
 */
export interface Observation {
  label: string;
  show?: 'text' | 'image' | 'video' | 'table' | 'diff' | 'request' | 'link';
  source?: ObservationSource | null;
  excerpt?: string;
  expected?: string;
  actual?: string;
}
/**
 * Where an observation came from, so Alpine can compare it with its own records. The agent writes this; the
 * server never trusts it without checking.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ObservationSource".
 */
export interface ObservationSource {
  kind: 'tool_call' | 'file' | 'surface_action' | 'surface_capture';
  sessionId?: string | null;
  ref?: string;
}
/**
 * How Alpine can re-run a check without a model (decision 5). The agent leaves it out for checks with side
 * effects such as real payments or mail.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FlowReplay".
 */
export interface FlowReplay {
  command: string;
  cwd?: string;
  /**
   * @maxItems 20
   */
  expect?:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ];
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FileChange".
 */
export interface FileChange {
  path: string;
  added: number;
  removed: number;
  diff: string[] | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FileEntry".
 */
export interface FileEntry {
  name: string;
  path: string;
  kind: 'directory' | 'file' | 'symlink';
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FilesActionParams".
 */
export interface FilesActionParams {
  cwd: string;
  path: string;
  line?: number;
  action: 'editor' | 'reveal';
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FilesActionResult".
 */
export interface FilesActionResult {
  ok?: boolean;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FilesListParams".
 */
export interface FilesListParams {
  cwd: string;
  path?: string;
  offset?: number;
  limit?: number;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FilesListResult".
 */
export interface FilesListResult {
  entries: FileEntry[];
  nextOffset: number;
  hasMore: boolean;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FilesReadParams".
 */
export interface FilesReadParams {
  cwd: string;
  path: string;
  line?: number;
  startLine?: number | null;
  limit?: number;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FilesReadResult".
 */
export interface FilesReadResult {
  path: string;
  relativePath: string;
  content: string;
  startLine: number;
  totalLines: number;
  line: number;
  truncated: boolean;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FilesSearchParams".
 */
export interface FilesSearchParams {
  cwd: string;
  query: string;
  limit?: number;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FilesSearchResult".
 */
export interface FilesSearchResult {
  paths: string[];
  truncated?: boolean;
}
/**
 * One recorded change to the map, kept by the server next to the document.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FlowChange".
 */
export interface FlowChange {
  at: string;
  nodeId: string;
  title: string;
  kind:
    | 'added'
    | 'removed'
    | 'phase'
    | 'check_passed'
    | 'check_failed'
    | 'check_blocked'
    | 'promise_added'
    | 'promise_changed'
    | 'promise_confirmed'
    | 'issue_later'
    | 'issue_wontfix'
    | 'issue_reopened'
    | 'exclude_changed'
    | 'replay_same'
    | 'replay_different';
  detail?: string;
}
/**
 * Deletes the project's map: every file under ``.alpine-code/map/`` and this computer's records of it.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FlowDeleteParams".
 */
export interface FlowDeleteParams {
  cwd: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FlowEdge".
 */
export interface FlowEdge {
  source: string;
  target: string;
  label?: string;
}
/**
 * The user rewrites one sentence of a card in the app. Alpine writes it into the card file and records it as the
 * user's own (decision 16). An empty ``value`` removes a promise or clears ``how_to_try``.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FlowEditParams".
 */
export interface FlowEditParams {
  cwd: string;
  nodeId: string;
  field: 'title' | 'how_to_try' | 'promise';
  conditionId?: string | null;
  value?: string;
}
/**
 * ``.alpine-code/map/flows/<id>.json``: one journey and the transitions between its cards, written by the agent.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FlowFile".
 */
export interface FlowFile {
  id: string;
  title: string;
  description?: string;
  trigger?: string;
  /**
   * @maxItems 200
   */
  nodeIds?: string[];
  /**
   * @maxItems 400
   */
  edges?: FlowEdge[];
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FlowGetParams".
 */
export interface FlowGetParams {
  cwd: string;
  since?: string | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FlowGetResult".
 */
export interface FlowGetResult {
  revision: string;
  etag?: string;
  unchanged?: boolean;
  document?: ProductMap;
  exists?: boolean;
  readOnly?: boolean;
  previews?: {
    [k: string]: string;
  };
  changes?: FlowChange[];
  states?: {
    [k: string]: NodeState;
  };
  provenance?: {
    [k: string]: ObservationProvenance[];
  };
  coverage?: MapCoverage;
  include?: string[];
  exclude?: string[];
  problems?: MapProblem[];
  schedule?: MapSchedule;
  removedCards?: RemovedCard[];
  review?: MapReview | null;
  unmapped?: UnmappedPart[];
}
/**
 * The assembled map the app shows.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProductMap".
 */
export interface ProductMap {
  flows?: ProductFlow[];
  nodes?: FlowNode[];
  edges?: FlowEdge[];
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProductFlow".
 */
export interface ProductFlow {
  id: string;
  title: string;
  description?: string;
  trigger?: string;
  /**
   * @maxItems 200
   */
  nodeIds?: string[];
  /**
   * @maxItems 400
   */
  edges?: FlowEdge[];
}
/**
 * A card as the app sees it: the agent's file plus the user's decisions and the session link Alpine keeps.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FlowNode".
 */
export interface FlowNode {
  id: string;
  title: string;
  description?: string;
  kind?: 'screen' | 'api' | 'sdk' | 'process' | 'data';
  /**
   * @maxItems 50
   */
  tags?: string[];
  phase?: 'planned' | 'building' | 'built';
  /**
   * @maxItems 100
   */
  sources?: string[];
  preview?: string | null;
  previewAt?: string | null;
  example?: string;
  howToTry?: string;
  /**
   * @maxItems 60
   */
  conditions?: FlowCondition[];
  /**
   * @maxItems 60
   */
  checks?: FlowCheck[];
  priority?: ('must' | 'should' | 'later') | null;
  scope?: ('now' | 'next' | 'out') | null;
  decision?: string;
  sessionId?: string | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "NodeState".
 */
export interface NodeState {
  status: 'failed' | 'question' | 'recheck' | 'unconfirmed' | 'passed' | 'none';
  passed?: number;
  total?: number;
  promises?: {
    [k: string]: PromiseState;
  };
  changed?: boolean;
  missing?: string[];
  unread?: string[];
  overridden?: {
    [k: string]: string;
  };
  removedPromises?: RemovedPromise[];
}
/**
 * Everything Alpine computed about one promise.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "PromiseState".
 */
export interface PromiseState {
  status: 'passed' | 'failed' | 'blocked' | 'recheck' | 'unconfirmed';
  issue?: '' | 'open' | 'resolved' | 'regressed' | 'maybe_fixed' | 'later' | 'wontfix' | 'question';
  origin?: 'inferred' | 'confirmed' | 'plan';
  reason?: string;
  since?: string | null;
  stamp?: CheckStamp | null;
  changed?: string[];
  replay?: ReplayState | null;
  reworded?: boolean;
  mine?: string;
  written?: boolean;
  decidedElsewhere?: boolean;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ReplayState".
 */
export interface ReplayState {
  key?: string;
  approved?: boolean;
  running?: boolean;
  at?: string | null;
  same?: boolean | null;
  output?: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "RemovedPromise".
 */
export interface RemovedPromise {
  id: string;
  text: string;
}
/**
 * The server's label for one observation, computed on every read. The agent never writes it.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ObservationProvenance".
 */
export interface ObservationProvenance {
  label: 'verified' | 'captured' | 'read' | 'mismatch' | 'agent';
  reason?:
    | ''
    | 'call_not_found'
    | 'excerpt_missing'
    | 'no_excerpt'
    | 'session_not_found'
    | 'other_project'
    | 'file_missing'
    | 'file_changed'
    | 'surface_not_found'
    | 'outside_session'
    | 'alpine_record';
  matched?: string;
  elsewhere?: boolean;
}
/**
 * Changes the map does not cover (decision 3).
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "MapCoverage".
 */
export interface MapCoverage {
  git?: boolean;
  uncovered?: string[];
  uncoveredCount?: number;
  outOfScope?: number;
  excluded?: number;
  since?: string | null;
}
/**
 * Something in the map files Alpine could not use. The rest of the map still shows.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "MapProblem".
 */
export interface MapProblem {
  file: string;
  message: string;
}
/**
 * The optional scheduled 지도 점검 (decision 6), kept on this computer.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "MapSchedule".
 */
export interface MapSchedule {
  enabled?: boolean;
  limit?: number;
  lastRun?: string | null;
}
/**
 * A card the user made decisions on (wrote, confirmed or planned) that is no longer in the map.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "RemovedCard".
 */
export interface RemovedCard {
  id: string;
  title: string;
}
/**
 * What a "지도 고치기" session changed, waiting for the user to accept it or put the map back (decision 16).
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "MapReview".
 */
export interface MapReview {
  sessionId: string;
  at: string;
  added?: string[];
  removed?: string[];
  changed?: string[];
}
/**
 * A part of the product the agent knows exists but has not mapped yet.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "UnmappedPart".
 */
export interface UnmappedPart {
  title: string;
  why?: string;
  /**
   * @maxItems 20
   */
  paths?:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ];
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FlowNodeParams".
 */
export interface FlowNodeParams {
  cwd: string;
  nodeId: string;
}
/**
 * Images for one card's checks, loaded when it opens.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FlowNodeResult".
 */
export interface FlowNodeResult {
  checkScreenshots?: {
    [k: string]: string;
  };
  observationImages?: {
    [k: string]: string;
  };
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FlowPrepareParams".
 */
export interface FlowPrepareParams {
  cwd: string;
  revision: string;
  action: 'discover' | 'extend' | 'change' | 'verify' | 'sync' | 'reshape';
  request?: string;
  nodeId?: string | null;
  flowId?: string | null;
  /**
   * @maxItems 500
   */
  nodeIds?: string[];
  sessionId: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FlowPrepareResult".
 */
export interface FlowPrepareResult {
  board: FlowGetResult;
  prompt: string;
  nodeId?: string | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FlowPromiseParams".
 */
export interface FlowPromiseParams {
  cwd: string;
  nodeId: string;
  conditionId: string;
  action: 'confirm' | 'unconfirm' | 'later' | 'wontfix' | 'reopen' | 'approve_replay' | 'revoke_replay';
  reason?: string;
  key?: string;
}
/**
 * The user's answer to a change of something they decided, or to a "지도 고치기" session's result.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FlowReviewParams".
 */
export interface FlowReviewParams {
  cwd: string;
  target: 'promise' | 'field' | 'card' | 'map';
  action: 'accept' | 'restore';
  nodeId?: string | null;
  conditionId?: string | null;
  field?: ('title' | 'how_to_try') | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FlowScheduleParams".
 */
export interface FlowScheduleParams {
  cwd: string;
  enabled: boolean;
  limit?: number;
  ran?: boolean;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FlowScopeParams".
 */
export interface FlowScopeParams {
  cwd: string;
  /**
   * @maxItems 100
   */
  include?: string[];
}
/**
 * One of the user's own decisions. Only Alpine writes them, into its own state files.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "FlowSetParams".
 */
export interface FlowSetParams {
  cwd: string;
  nodeId: string;
  field: 'priority' | 'scope' | 'decision';
  value?: string | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "GitHubAccountInfo".
 */
export interface GitHubAccountInfo {
  login: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "GitHubCancelSignInParams".
 */
export interface GitHubCancelSignInParams {
  attemptId: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "GitHubCancelSignInResult".
 */
export interface GitHubCancelSignInResult {}
/**
 * The repositories the sign-in can see, the most recently pushed first. Fails with ``auth`` when signed out (or
 * GitHub no longer accepts the token, which is then forgotten) and ``unreachable`` when GitHub cannot be reached.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "GitHubReposParams".
 */
export interface GitHubReposParams {}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "GitHubReposResult".
 */
export interface GitHubReposResult {
  repositories: GitHubRepository[];
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "GitHubRepository".
 */
export interface GitHubRepository {
  fullName: string;
  cloneUrl: string;
  private: boolean;
  pushedAt: string | null;
  description: string | null;
}
/**
 * The end of a sign-in, whichever way it ended.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "GitHubSignInFinishedParams".
 */
export interface GitHubSignInFinishedParams {
  attemptId: string;
  result: 'connected' | 'declined' | 'cancelled' | 'timed_out' | 'failed';
  account?: GitHubAccountInfo | null;
  message?: string | null;
}
/**
 * Starts a sign-in, cancelling one still waiting. The app shows ``user_code`` and opens ``verification_uri``.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "GitHubSignInParams".
 */
export interface GitHubSignInParams {}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "GitHubSignInResult".
 */
export interface GitHubSignInResult {
  attemptId: string;
  userCode: string;
  verificationUri: string;
}
/**
 * Forgets the sign-in here. GitHub keeps the grant until the user revokes it at ``access_url``.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "GitHubSignOutParams".
 */
export interface GitHubSignOutParams {}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "GitHubSignOutResult".
 */
export interface GitHubSignOutResult {}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "GitHubStatusParams".
 */
export interface GitHubStatusParams {}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "GitHubStatusResult".
 */
export interface GitHubStatusResult {
  available: boolean;
  account: GitHubAccountInfo | null;
  accessUrl: string;
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
 * Where a conversation carried over from another app ends; the session goes on from here.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ImportedItem".
 */
export interface ImportedItem {
  id: string;
  kind: 'imported';
  source: 'claude_code' | 'codex';
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
  pinned?: boolean;
  archived?: boolean;
  summary?: string;
  cwd: string;
  model: string;
  mode: 'default' | 'accept_edits' | 'auto' | 'yolo';
  status: 'idle' | 'running' | 'waiting' | 'failed';
  createdAt: string;
  updatedAt: string;
  usage: Usage;
  contextUsed: number;
  contextWindow: number | null;
  activity: Activity | null;
  runStartedAt: string | null;
  runUsage: Usage | null;
  agent: string | null;
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
    | ReviewBlockedItem
    | NoticeItem
    | StatusLineItem
    | MemoryReviewItem
    | CompactionItem
    | RunStoppedItem
    | AgentSwitchedItem
    | AgentChangedItem
    | ImportedItem
    | TaskForceItem;
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
  commandResult: CommandResult | null;
  fileChanges: FileChange[] | null;
}
/**
 * Auto mode's reviewer blocked a call; the model was told ``reason`` and went on. The call follows as a denied
 * ``tool_call`` with the same ``call_id``.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ReviewBlockedItem".
 */
export interface ReviewBlockedItem {
  id: string;
  kind: 'review_blocked';
  callId: string;
  tool: string;
  args: {
    [k: string]: unknown;
  };
  reason: string | null;
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
 * A TF: the session's model proposed it, then the user starts it and its agents work. Sent again with the same
 * id (``item_started``) as it changes; completed when it is over.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "TaskForceItem".
 */
export interface TaskForceItem {
  id: string;
  kind: 'taskforce';
  title: string;
  steps: TaskForceStep[];
  minutes: number;
  status: 'proposed' | 'declined' | 'running' | 'over' | 'stopping' | 'done' | 'stopped' | 'failed' | 'interrupted';
  members: TaskForceMember[];
  step: string;
  log: string | null;
  needed: number | null;
  error: string | null;
  startedAt: string | null;
}
/**
 * One step of the plan the card shows.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "TaskForceStep".
 */
export interface TaskForceStep {
  title: string;
  count: number;
  model: string;
}
/**
 * One agent of a TF, as the room and the agent list draw it.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "TaskForceMember".
 */
export interface TaskForceMember {
  id: string;
  step: string;
  task: string;
  agent: string;
  look:
    | 'antenna'
    | 'hardhat'
    | 'glasses'
    | 'beret'
    | 'headphones'
    | 'cap'
    | 'chef'
    | 'sprout'
    | 'ribbon'
    | 'beanie'
    | 'bowtie'
    | 'grad';
  color: number;
  model: string;
  state: 'queued' | 'working' | 'asking' | 'done' | 'failed' | 'stopped';
  activity?: ('thinking' | 'writing' | 'read' | 'search' | 'edit' | 'run' | 'tool') | null;
  turn?: number;
  source?: string | null;
  cached?: boolean;
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
    | ReviewBlockedItem
    | NoticeItem
    | StatusLineItem
    | MemoryReviewItem
    | CompactionItem
    | RunStoppedItem
    | AgentSwitchedItem
    | AgentChangedItem
    | ImportedItem
    | TaskForceItem;
}
/**
 * ``.alpine-code/map/map.json``, written by the agent.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "MapFile".
 */
export interface MapFile {
  formatVersion?: 1;
  /**
   * @maxItems 200
   */
  exclude?: string[];
  /**
   * @maxItems 100
   */
  unmapped?: UnmappedPart[];
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
 * What the harness checks while the agent works, in the forms memory rules take (English, for the model).
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
 * via the `definition` "ProcessesListParams".
 */
export interface ProcessesListParams {
  kind?: ('command' | 'shell') | null;
  cwd?: string | null;
  sessionId?: string | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProcessesListResult".
 */
export interface ProcessesListResult {
  processes: TerminalProcess[];
  tools: ToolExecution[];
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "TerminalProcess".
 */
export interface TerminalProcess {
  id: string;
  command: string;
  cwd: string;
  sessionId?: string | null;
  title: string;
  pty: boolean;
  kind?: 'command' | 'shell';
  pid: number;
  status: 'running' | 'stopping' | 'exited' | 'failed' | 'cancelled';
  exitCode?: number | null;
  stopError?: string | null;
  cancelled?: boolean;
  createdAt: number;
  outputSize: number;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ToolExecution".
 */
export interface ToolExecution {
  id: string;
  sessionId?: string | null;
  name: string;
  createdAt: number;
  status: 'running' | 'stopping' | 'finished' | 'cancelled';
  cancellable: boolean;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProcessesStopParams".
 */
export interface ProcessesStopParams {
  kind?: ('command' | 'shell') | null;
  cwd?: string | null;
  sessionId?: string | null;
  force?: boolean;
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
  lastAgent: string | null;
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
 * Stops a clone and removes what it wrote, or dismisses a failed one. Does nothing for an unknown id.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProjectsCancelCloneParams".
 */
export interface ProjectsCancelCloneParams {
  id: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProjectsCancelCloneResult".
 */
export interface ProjectsCancelCloneResult {}
/**
 * A clone moved on: more received, or it finished (``done``, with ``project``), failed or was cancelled.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProjectsCloneChangedParams".
 */
export interface ProjectsCloneChangedParams {
  clone: CloneInfo;
  project?: ProjectInfo | null;
}
/**
 * Brings a repository into the clone folder and opens it as a project.
 *
 * Answers once the host has answered: with ``project`` when the repository is already here (a project with the same
 * ``origin``, or the same repository in the clone folder) or the clone already finished, else with ``clone``, which
 * goes on in the background and announces itself through ``projects/cloneChanged``. A wrong address or a missing
 * sign-in fails the request itself (``no_access``, ``unreachable``, ``no_git_tools``, ``clone_failed``), so the app
 * can ask again before anything shows on the rail.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProjectsCloneParams".
 */
export interface ProjectsCloneParams {
  id: string;
  address: string;
  username?: string | null;
  password?: string | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProjectsCloneResult".
 */
export interface ProjectsCloneResult {
  project?: ProjectInfo | null;
  existing?: boolean;
  clone?: CloneInfo | null;
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
 * via the `definition` "ProjectsGitToolsParams".
 */
export interface ProjectsGitToolsParams {}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProjectsGitToolsResult".
 */
export interface ProjectsGitToolsResult {
  ready: boolean;
  installable: boolean;
}
/**
 * Opens Apple's installer for the command line developer tools. ``projects/gitTools`` says when it is done.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProjectsInstallGitToolsParams".
 */
export interface ProjectsInstallGitToolsParams {}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProjectsInstallGitToolsResult".
 */
export interface ProjectsInstallGitToolsResult {}
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
  clones: CloneInfo[];
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
 * via the `definition` "SessionChangesParams".
 */
export interface SessionChangesParams {
  sessionId: string;
  checkpointId?: string | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionChangesResult".
 */
export interface SessionChangesResult {
  checkpoints: SessionCheckpoint[];
  files: FileChange[];
  available: boolean;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionCheckpoint".
 */
export interface SessionCheckpoint {
  id: string;
  label: string;
  createdAt: string;
  status: string;
}
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
 * Carries a conversation over as a new session of ``cwd``; its earlier messages, tool calls and results come
 * with it, and the next message continues it.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionImportParams".
 */
export interface SessionImportParams {
  cwd: string;
  source: 'claude_code' | 'codex';
  id: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionImportResult".
 */
export interface SessionImportResult {
  info: SessionInfo;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionImportableParams".
 */
export interface SessionImportableParams {
  cwd: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionImportableResult".
 */
export interface SessionImportableResult {
  sessions: ExternalSessionInfo[];
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
  mode?: ('default' | 'accept_edits' | 'auto' | 'yolo') | null;
  agent?: string | null;
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
    | ReviewBlockedItem
    | NoticeItem
    | StatusLineItem
    | MemoryReviewItem
    | CompactionItem
    | RunStoppedItem
    | AgentSwitchedItem
    | AgentChangedItem
    | ImportedItem
    | TaskForceItem
  )[];
  active: (
    | UserMessageItem
    | AgentMessageItem
    | ToolCallItem
    | ApprovalItem
    | ReviewBlockedItem
    | NoticeItem
    | StatusLineItem
    | MemoryReviewItem
    | CompactionItem
    | RunStoppedItem
    | AgentSwitchedItem
    | AgentChangedItem
    | ImportedItem
    | TaskForceItem
  )[];
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionSearchHit".
 */
export interface SessionSearchHit {
  info: SessionInfo;
  excerpt: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionSearchParams".
 */
export interface SessionSearchParams {
  query: string;
  limit?: number;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionSearchResult".
 */
export interface SessionSearchResult {
  hits: SessionSearchHit[];
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
 * Goes on with another agent from the next message on. Not while the session runs. An unknown id fails with
 * ``agent_not_found``.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionSetAgentParams".
 */
export interface SessionSetAgentParams {
  sessionId: string;
  agent: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionSetAgentResult".
 */
export interface SessionSetAgentResult {
  info: SessionInfo;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionSetDetailsParams".
 */
export interface SessionSetDetailsParams {
  sessionId: string;
  title?: string | null;
  pinned?: boolean | null;
  archived?: boolean | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionSetDetailsResult".
 */
export interface SessionSetDetailsResult {
  info: SessionInfo;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SessionSetModeParams".
 */
export interface SessionSetModeParams {
  sessionId: string;
  mode: 'default' | 'accept_edits' | 'auto' | 'yolo';
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
 * via the `definition` "SettingsGetParams".
 */
export interface SettingsGetParams {}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SettingsGetResult".
 */
export interface SettingsGetResult {
  mode: 'default' | 'accept_edits' | 'auto' | 'yolo';
  reviewModel?: string | null;
  cloneFolder: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SettingsSetCloneFolderParams".
 */
export interface SettingsSetCloneFolderParams {
  cloneFolder: string | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SettingsSetCloneFolderResult".
 */
export interface SettingsSetCloneFolderResult {
  cloneFolder: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SettingsSetModeParams".
 */
export interface SettingsSetModeParams {
  mode: 'default' | 'accept_edits' | 'auto' | 'yolo';
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SettingsSetModeResult".
 */
export interface SettingsSetModeResult {
  mode: 'default' | 'accept_edits' | 'auto' | 'yolo';
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SettingsSetReviewModelParams".
 */
export interface SettingsSetReviewModelParams {
  reviewModel: string | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SettingsSetReviewModelResult".
 */
export interface SettingsSetReviewModelResult {
  reviewModel: string | null;
}
/**
 * A skill found at a source, not installed yet.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SkillCandidate".
 */
export interface SkillCandidate {
  name: string;
  description: string;
  hasScripts: boolean;
  installed: boolean;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SkillHit".
 */
export interface SkillHit {
  name: string;
  source: string;
  id: string;
  installs: number;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SkillInfo".
 */
export interface SkillInfo {
  name: string;
  description: string;
  origin: 'project' | 'alpine' | 'agents' | 'claude' | 'codex';
  source: string | null;
  folder: string;
  hasScripts: boolean;
  notes: string[];
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SkillsAddParams".
 */
export interface SkillsAddParams {
  source: string;
  names?: string[] | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SkillsAddResult".
 */
export interface SkillsAddResult {
  source: string;
  added: SkillInfo[];
  choices: SkillCandidate[];
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SkillsGetParams".
 */
export interface SkillsGetParams {
  name: string;
  cwd?: string | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SkillsGetResult".
 */
export interface SkillsGetResult {
  skill: SkillInfo;
  text: string;
  files: string[];
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SkillsListParams".
 */
export interface SkillsListParams {
  cwd?: string | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SkillsListResult".
 */
export interface SkillsListResult {
  skills: SkillInfo[];
  folder: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SkillsRemoveParams".
 */
export interface SkillsRemoveParams {
  name: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SkillsRemoveResult".
 */
export interface SkillsRemoveResult {}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SkillsSaveParams".
 */
export interface SkillsSaveParams {
  name: string;
  text: string;
  new?: boolean;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SkillsSaveResult".
 */
export interface SkillsSaveResult {
  skill: SkillInfo;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SkillsSearchParams".
 */
export interface SkillsSearchParams {
  query: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "SkillsSearchResult".
 */
export interface SkillsSearchResult {
  hits: SkillHit[];
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "TaskForceAgentParams".
 */
export interface TaskForceAgentParams {
  sessionId: string;
  runId: string;
  memberId: string;
}
/**
 * Names a TF of a session. ``taskforce/start`` (시작), ``taskforce/decline`` (혼자 하기), ``taskforce/stop``
 * (멈추기, 여기까지 결과 받기), ``taskforce/allowMore`` (more agents than planned) and ``taskforce/takeResults``
 * (after the app closed mid-run) take only this. A TF not in a state for the action fails with
 * ``taskforce_state``; an unknown one with ``taskforce_not_found``.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "TaskForceParams".
 */
export interface TaskForceParams {
  sessionId: string;
  runId: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "TaskForceRecordResult".
 */
export interface TaskForceRecordResult {
  items: (
    | UserMessageItem
    | AgentMessageItem
    | ToolCallItem
    | ApprovalItem
    | ReviewBlockedItem
    | NoticeItem
    | StatusLineItem
    | MemoryReviewItem
    | CompactionItem
    | RunStoppedItem
    | AgentSwitchedItem
    | AgentChangedItem
    | ImportedItem
    | TaskForceItem
  )[];
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "TaskForceResult".
 */
export interface TaskForceResult {}
/**
 * 이어 하기 after the app closed mid-run.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "TaskForceResumeParams".
 */
export interface TaskForceResumeParams {
  sessionId: string;
  runId: string;
  fresh?: boolean;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "TaskForceStopAgentResult".
 */
export interface TaskForceStopAgentResult {
  stopped: boolean;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "TerminalsCloseResult".
 */
export interface TerminalsCloseResult {
  closed?: boolean;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "TerminalsListParams".
 */
export interface TerminalsListParams {
  cwd?: string | null;
  sessionId?: string | null;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "TerminalsListResult".
 */
export interface TerminalsListResult {
  processes: TerminalProcess[];
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "TerminalsProcessParams".
 */
export interface TerminalsProcessParams {
  processId: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "TerminalsProcessResult".
 */
export interface TerminalsProcessResult {
  process: TerminalProcess;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "TerminalsReadParams".
 */
export interface TerminalsReadParams {
  processId: string;
  offset?: number;
  waitMs?: number;
  limit?: number;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "TerminalsReadResult".
 */
export interface TerminalsReadResult {
  text: string;
  nextOffset: number;
  total: number;
  process: TerminalProcess;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "TerminalsResizeParams".
 */
export interface TerminalsResizeParams {
  processId: string;
  cols: number;
  rows: number;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "TerminalsStartParams".
 */
export interface TerminalsStartParams {
  command: string;
  cwd: string;
  sessionId?: string | null;
  title?: string | null;
  pty?: boolean;
  kind?: 'command' | 'shell';
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "TerminalsStopParams".
 */
export interface TerminalsStopParams {
  processId: string;
  force?: boolean;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "TerminalsWriteParams".
 */
export interface TerminalsWriteParams {
  processId: string;
  data: string;
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
  'devServers/list': { params: DevServersListParams; result: DevServersListResult };
  'devServers/start': { params: DevServersStartParams; result: DevServersStartResult };
  'devServers/stop': { params: DevServersStopParams; result: DevServersStopResult };
  'devServers/restart': { params: DevServersRestartParams; result: DevServersRestartResult };
  'devServers/logs': { params: DevServersLogsParams; result: DevServersLogsResult };
  'files/list': { params: FilesListParams; result: FilesListResult };
  'files/read': { params: FilesReadParams; result: FilesReadResult };
  'files/action': { params: FilesActionParams; result: FilesActionResult };
  'files/search': { params: FilesSearchParams; result: FilesSearchResult };
  'processes/list': { params: ProcessesListParams; result: ProcessesListResult };
  'processes/stop': { params: ProcessesStopParams; result: ProcessesListResult };
  'terminals/list': { params: TerminalsListParams; result: TerminalsListResult };
  'terminals/start': { params: TerminalsStartParams; result: TerminalsProcessResult };
  'terminals/read': { params: TerminalsReadParams; result: TerminalsReadResult };
  'terminals/write': { params: TerminalsWriteParams; result: TerminalsProcessResult };
  'terminals/resize': { params: TerminalsResizeParams; result: TerminalsProcessResult };
  'terminals/close': { params: TerminalsProcessParams; result: TerminalsCloseResult };
  'terminals/stop': { params: TerminalsStopParams; result: TerminalsProcessResult };
  'initialize': { params: InitializeParams; result: InitializeResult };
  'flow/get': { params: FlowGetParams; result: FlowGetResult };
  'flow/prepare': { params: FlowPrepareParams; result: FlowPrepareResult };
  'flow/set': { params: FlowSetParams; result: FlowGetResult };
  'flow/node': { params: FlowNodeParams; result: FlowNodeResult };
  'flow/promise': { params: FlowPromiseParams; result: FlowGetResult };
  'flow/edit': { params: FlowEditParams; result: FlowGetResult };
  'flow/review': { params: FlowReviewParams; result: FlowGetResult };
  'flow/scope': { params: FlowScopeParams; result: FlowGetResult };
  'flow/schedule': { params: FlowScheduleParams; result: FlowGetResult };
  'flow/delete': { params: FlowDeleteParams; result: FlowGetResult };
  'connections/list': { params: ConnectionsListParams; result: ConnectionsListResult };
  'connections/models': { params: ConnectionsModelsParams; result: ConnectionsModelsResult };
  'connections/add': { params: ConnectionsAddParams; result: ConnectionsAddResult };
  'connections/remove': { params: ConnectionsRemoveParams; result: ConnectionsRemoveResult };
  'connections/showModel': { params: ConnectionsShowModelParams; result: ConnectionsShowModelResult };
  'connections/setDefault': { params: ConnectionsSetDefaultParams; result: ConnectionsSetDefaultResult };
  'settings/get': { params: SettingsGetParams; result: SettingsGetResult };
  'settings/setMode': { params: SettingsSetModeParams; result: SettingsSetModeResult };
  'settings/setReviewModel': { params: SettingsSetReviewModelParams; result: SettingsSetReviewModelResult };
  'settings/setCloneFolder': { params: SettingsSetCloneFolderParams; result: SettingsSetCloneFolderResult };
  'chatgpt/signIn': { params: ChatGPTSignInParams; result: ChatGPTSignInResult };
  'chatgpt/cancelSignIn': { params: ChatGPTCancelSignInParams; result: ChatGPTCancelSignInResult };
  'chatgpt/signOut': { params: ChatGPTSignOutParams; result: ChatGPTSignOutResult };
  'github/status': { params: GitHubStatusParams; result: GitHubStatusResult };
  'github/signIn': { params: GitHubSignInParams; result: GitHubSignInResult };
  'github/cancelSignIn': { params: GitHubCancelSignInParams; result: GitHubCancelSignInResult };
  'github/signOut': { params: GitHubSignOutParams; result: GitHubSignOutResult };
  'github/repos': { params: GitHubReposParams; result: GitHubReposResult };
  'projects/list': { params: ProjectsListParams; result: ProjectsListResult };
  'projects/open': { params: ProjectsOpenParams; result: ProjectsOpenResult };
  'projects/archive': { params: ProjectsArchiveParams; result: ProjectsArchiveResult };
  'projects/delete': { params: ProjectsDeleteParams; result: ProjectsDeleteResult };
  'projects/clone': { params: ProjectsCloneParams; result: ProjectsCloneResult };
  'projects/cancelClone': { params: ProjectsCancelCloneParams; result: ProjectsCancelCloneResult };
  'projects/gitTools': { params: ProjectsGitToolsParams; result: ProjectsGitToolsResult };
  'projects/installGitTools': { params: ProjectsInstallGitToolsParams; result: ProjectsInstallGitToolsResult };
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
  'agents/list': { params: AgentsListParams; result: AgentsListResult };
  'agents/save': { params: AgentsSaveParams; result: AgentsSaveResult };
  'agents/delete': { params: AgentsDeleteParams; result: AgentsDeleteResult };
  'skills/list': { params: SkillsListParams; result: SkillsListResult };
  'skills/add': { params: SkillsAddParams; result: SkillsAddResult };
  'skills/get': { params: SkillsGetParams; result: SkillsGetResult };
  'skills/save': { params: SkillsSaveParams; result: SkillsSaveResult };
  'skills/remove': { params: SkillsRemoveParams; result: SkillsRemoveResult };
  'skills/search': { params: SkillsSearchParams; result: SkillsSearchResult };
  'memory/list': { params: MemoryListParams; result: MemoryListResult };
  'memory/approve': { params: MemoryApproveParams; result: MemoryApproveResult };
  'memory/reject': { params: MemoryRejectParams; result: MemoryRejectResult };
  'memory/forget': { params: MemoryForgetParams; result: MemoryForgetResult };
  'session/new': { params: SessionNewParams; result: SessionNewResult };
  'session/list': { params: SessionListParams; result: SessionListResult };
  'session/open': { params: SessionOpenParams; result: SessionOpenResult };
  'session/changes': { params: SessionChangesParams; result: SessionChangesResult };
  'session/send': { params: SessionSendParams; result: SessionSendResult };
  'session/cancel': { params: SessionCancelParams; result: SessionCancelResult };
  'session/answer': { params: SessionAnswerParams; result: SessionAnswerResult };
  'session/search': { params: SessionSearchParams; result: SessionSearchResult };
  'session/setDetails': { params: SessionSetDetailsParams; result: SessionSetDetailsResult };
  'session/setMode': { params: SessionSetModeParams; result: SessionSetModeResult };
  'session/setModel': { params: SessionSetModelParams; result: SessionSetModelResult };
  'session/setAgent': { params: SessionSetAgentParams; result: SessionSetAgentResult };
  'session/delete': { params: SessionDeleteParams; result: SessionDeleteResult };
  'session/importable': { params: SessionImportableParams; result: SessionImportableResult };
  'session/import': { params: SessionImportParams; result: SessionImportResult };
  'taskforce/start': { params: TaskForceParams; result: TaskForceResult };
  'taskforce/decline': { params: TaskForceParams; result: TaskForceResult };
  'taskforce/stop': { params: TaskForceParams; result: TaskForceResult };
  'taskforce/allowMore': { params: TaskForceParams; result: TaskForceResult };
  'taskforce/resume': { params: TaskForceResumeParams; result: TaskForceResult };
  'taskforce/takeResults': { params: TaskForceParams; result: TaskForceResult };
  'taskforce/stopAgent': { params: TaskForceAgentParams; result: TaskForceStopAgentResult };
  'taskforce/record': { params: TaskForceAgentParams; result: TaskForceRecordResult };
}

export interface Notifications {
  'session/event': SessionEventParams;
  'chatgpt/signInFinished': ChatGPTSignInFinishedParams;
  'memory/changed': MemoryChangedParams;
  'projects/cloneChanged': ProjectsCloneChangedParams;
  'github/signInFinished': GitHubSignInFinishedParams;
}
