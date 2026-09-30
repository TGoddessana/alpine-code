import type { ErrorData, Methods } from '@alpine/protocol';

export type Method = keyof Methods;
export type Params<M extends Method> = Methods[M]['params'];
export type Result<M extends Method> = Methods[M]['result'];

/** Something the server says without being asked, such as a session event. */
export interface Notification {
  method: string;
  params?: unknown;
}

/** The app's only way to talk to the server. Real (Tauri) and scripted (Storybook, tests) connections implement it. */
export interface ServerConnection {
  /** Resolves with the result, or rejects with a `ServerError`. */
  request<M extends Method>(method: M, params: Params<M>): Promise<Result<M>>;
  /** Calls `listener` for every notification until the returned function is called. */
  subscribe(listener: (notification: Notification) => void): () => void;
}

export class ServerError extends Error {
  constructor(
    readonly code: number,
    message: string,
    /** Why, for errors an app can act on (a rejected key, a missing folder). */
    readonly data?: ErrorData,
  ) {
    super(message);
  }
}
