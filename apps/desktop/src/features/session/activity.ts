import type { Activity } from '@alpine/protocol';

import { toolKind } from '@/shared/tool-calls';

/** The words the progress line can say, one per message key `activity_<word>`. */
export type ActivityWord =
  'thinking' | 'writing' | 'reading' | 'searching' | 'editing' | 'running' | 'tool' | 'approval' | 'compacting';

/** Which word says what the agent is doing: the kind of activity, and for a tool the kind of tool (see `toolKind`). */
export function activityWord(activity: Pick<Activity, 'kind' | 'toolName'> | null): ActivityWord {
  if (!activity) return 'thinking';
  switch (activity.kind) {
    case 'thinking':
      return 'thinking';
    case 'writing':
      return 'writing';
    case 'waiting_approval':
      return 'approval';
    case 'compacting':
      return 'compacting';
    case 'running_tool':
      return ({ read: 'reading', search: 'searching', edit: 'editing', run: 'running', other: 'tool' } as const)[
        toolKind(activity.toolName ?? '')
      ];
  }
}
