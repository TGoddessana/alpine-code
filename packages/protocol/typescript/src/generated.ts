// Generated from packages/protocol/python by `pnpm protocol:generate`. Do not edit.

export const PROTOCOL_VERSION = 1;

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
 * via the `definition` "ProjectInfo".
 */
export interface ProjectInfo {
  path: string;
  name: string;
  branch: string | null;
  lastUsedAt: string;
  hidden: boolean;
}
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
 * Takes a project off the rail; its sessions stay, and opening the folder shows it again.
 *
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProjectsHideParams".
 */
export interface ProjectsHideParams {
  path: string;
}
/**
 * This interface was referenced by `AlpineProtocol`'s JSON-Schema
 * via the `definition` "ProjectsHideResult".
 */
export interface ProjectsHideResult {}
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

export interface Methods {
  'initialize': { params: InitializeParams; result: InitializeResult };
  'connections/list': { params: ConnectionsListParams; result: ConnectionsListResult };
  'connections/models': { params: ConnectionsModelsParams; result: ConnectionsModelsResult };
  'connections/add': { params: ConnectionsAddParams; result: ConnectionsAddResult };
  'connections/setDefault': { params: ConnectionsSetDefaultParams; result: ConnectionsSetDefaultResult };
  'projects/list': { params: ProjectsListParams; result: ProjectsListResult };
  'projects/open': { params: ProjectsOpenParams; result: ProjectsOpenResult };
  'projects/hide': { params: ProjectsHideParams; result: ProjectsHideResult };
  'projects/clone': { params: ProjectsCloneParams; result: ProjectsCloneResult };
}
