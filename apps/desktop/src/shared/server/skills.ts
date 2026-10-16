import type { SkillsAddParams, SkillsSaveParams } from '@alpine/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useServer } from './context';

const skillsKey = ['skills'];

/** The user's skills (Alpine's, then other apps'); with `cwd`, that project's own skills first. */
export function useSkills(cwd?: string | null) {
  const server = useServer();
  return useQuery({
    queryKey: [...skillsKey, 'list', cwd ?? null],
    queryFn: () => server.request('skills/list', cwd ? { cwd } : {}),
    retry: false,
  });
}

/** A skill's whole SKILL.md and its other files. */
export function useSkill(name: string | null, cwd?: string | null) {
  const server = useServer();
  return useQuery({
    queryKey: [...skillsKey, 'get', name, cwd ?? null],
    queryFn: () => server.request('skills/get', { name: name!, ...(cwd ? { cwd } : {}) }),
    enabled: name !== null,
    retry: false,
  });
}

/**
 * Adds the skills at a source (a link, `owner/repo/skill`, a file). A source with several skills and no `names`
 * adds nothing and resolves with its `choices`.
 */
export function useAddSkill() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (params: SkillsAddParams) => server.request('skills/add', params),
    onSuccess: (result) => {
      if (result.added.length > 0) void client.invalidateQueries({ queryKey: skillsKey });
    },
  });
}

export function useSaveSkill() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (params: SkillsSaveParams) => server.request('skills/save', params),
    onSuccess: () => client.invalidateQueries({ queryKey: skillsKey }),
  });
}

/** Deletes a skill Alpine installed or made; another app's skill stays (`not_owned`). */
export function useRemoveSkill() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => server.request('skills/remove', { name }),
    onSuccess: () => client.invalidateQueries({ queryKey: skillsKey }),
  });
}

/** Skills other people made, from skills.sh, the most installed first. Asks once `query` has two letters. */
export function useSearchSkills(query: string) {
  const server = useServer();
  const q = query.trim();
  return useQuery({
    queryKey: [...skillsKey, 'search', q],
    queryFn: () => server.request('skills/search', { query: q }),
    enabled: q.length >= 2,
    retry: false,
    staleTime: 5 * 60_000,
  });
}
