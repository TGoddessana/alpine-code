import type {
  JudgedChange,
  JudgedNew,
  ProjectInfo,
  ProjectsCreateChangedParams,
  ProjectsCreateParams,
  ProjectsJudgeParams,
} from '@alpine/protocol';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useServer } from './context';
import { sessionsKey } from './sessionStore';

/** The stack templates the app shows (the server offers the ones it has). */
export type TemplateId = JudgedNew['template'];

/** The steps `projects/create` announces as it goes. */
export type CreateStep = ProjectsCreateChangedParams['step'];

/** What the agent made of a message sent from the new-session screen: work on the open project, or a new app. */
export type Judgement = JudgedChange | JudgedNew;

/**
 * Asks the default model whether what was sent is work on the project or a new app (`projects/judge`). Resolves with
 * the judgement; the caller decides what a failed question means (the new-session screen treats it as work on the
 * project, so a new project is never made by mistake). Calls may overlap; each resolves on its own.
 */
export function useJudgeNewProject() {
  const server = useServer();
  return useMutation({
    mutationFn: async (params: ProjectsJudgeParams): Promise<Judgement> =>
      (await server.request('projects/judge', params)).judgement,
  });
}

export interface CreateProjectInput extends Omit<ProjectsCreateParams, 'id'> {
  /** Called as each step finishes, with the project being made. */
  onStep?: (step: CreateStep, project: ProjectInfo) => void;
}

/**
 * Makes a project from a template and starts the agent on the idea (`projects/create`). The steps are announced
 * through `projects/createChanged` while the request runs, and `onStep` hears the ones of this call only. Resolves
 * with the project and the session working on the idea, once the projects and sessions the app shows are current.
 * A rejection can come after the project was made (the session could not start): the projects are refreshed then too.
 */
export function useCreateProject() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ onStep, ...params }: CreateProjectInput) => {
      const id = crypto.randomUUID();
      // Listening starts before asking, so a step announced at once is not missed.
      const stop = server.subscribe((notification) => {
        if (notification.method !== 'projects/createChanged') return;
        const changed = notification.params as ProjectsCreateChangedParams;
        if (changed.id === id) onStep?.(changed.step, changed.project);
      });
      try {
        return await server.request('projects/create', { ...params, id });
      } finally {
        stop();
      }
    },
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['projects'] }),
        client.invalidateQueries({ queryKey: sessionsKey }),
      ]),
  });
}
