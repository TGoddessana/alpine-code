import type { Notification, Method, Params, Result, ServerConnection } from './connection';

export interface Script {
  /** What each request returns, by method. A function may throw a `ServerError` to script a failure. */
  results?: { [M in Method]?: Result<M> | ((params: Params<M>) => Result<M>) };
  /** Sent in order to each new subscriber, like a recorded session. */
  events?: Notification[];
}

/** A server that follows a script: for Storybook stories and tests, where no server process runs. */
export function scriptedConnection(script: Script = {}): ServerConnection {
  return {
    async request(method, params) {
      const result = script.results?.[method] as Result<typeof method> | ((p: typeof params) => Result<typeof method>);
      if (result === undefined) throw new Error(`The script has no result for ${method}`);
      return typeof result === 'function' ? result(params) : result;
    },
    subscribe(listener) {
      script.events?.forEach(listener);
      return () => {};
    },
  };
}
