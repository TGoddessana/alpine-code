// Generated from packages/protocol/python by `pnpm protocol:generate`. Do not edit.

export const PROTOCOL_VERSION = 1;

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
}
