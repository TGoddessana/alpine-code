import type { Notification, Method, Params, Result, ServerConnection } from './connection';

/** What a scripted result can do besides answering: speak to the app without being asked. */
export interface ScriptContext {
  /** Sends `notification` to every subscriber now. */
  emit(notification: Notification): void;
}

export interface Script {
  /**
   * What each request returns, by method. A function may throw a `ServerError` to script a failure, and may use the
   * context to send notifications, before or after it answers.
   */
  results?: { [M in Method]?: Result<M> | ((params: Params<M>, context: ScriptContext) => Result<M>) };
  /** Sent in order to each new subscriber, like a recorded session. */
  events?: Notification[];
}

/** One script that answers with the results of all of `scripts`; for the same method, a later script wins. */
export function mergeScripts(...scripts: Script[]): Script {
  return {
    results: Object.assign({}, ...scripts.map((script) => script.results)) as Script['results'],
    events: scripts.flatMap((script) => script.events ?? []),
  };
}

/** A server that follows a script: for Storybook stories and tests, where no server process runs. */
export function scriptedConnection(script: Script = {}): ServerConnection {
  const listeners = new Set<(notification: Notification) => void>();
  const context: ScriptContext = {
    emit: (notification) => [...listeners].forEach((listener) => listener(notification)),
  };
  return {
    async request(method, params) {
      const result = script.results?.[method] as unknown;
      if (result === undefined) throw new Error(`The script has no result for ${method}`);
      return (typeof result === 'function' ? result(params, context) : result) as Result<typeof method>;
    },
    subscribe(listener) {
      script.events?.forEach(listener);
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
