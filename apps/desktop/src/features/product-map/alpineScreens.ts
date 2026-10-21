// Screens for the flow-tree stories: real captures of Alpine's own screens, taken from these Storybook stories, and
// a few sketches standing in where no capture exists yet.
import type { CardScreen, TreeMap } from './flowTreeModel';

import connectChatgpt from './exampleScreens/connect-chatgpt.jpg?url';
import connectApiKey from './exampleScreens/connect-api-key.jpg?url';
import connectServer from './exampleScreens/connect-server.jpg?url';
import chatWork from './exampleScreens/chat-work.jpg?url';
import approveAction from './exampleScreens/approve-action.jpg?url';
import workResult from './exampleScreens/work-result.jpg?url';
import keepMemory from './exampleScreens/keep-memory.jpg?url';
import conversationUsage from './exampleScreens/conversation-usage.jpg?url';
import defaultModel from './exampleScreens/default-model.jpg?url';
import installSkill from './exampleScreens/install-skill.jpg?url';
import configureAgent from './exampleScreens/configure-agent.jpg?url';
import forgetMemory from './exampleScreens/forget-memory.jpg?url';
import openProject from './exampleScreens/open-project.jpg?url';
import importConversation from './exampleScreens/import-conversation.jpg?url';
import cloneProject from './exampleScreens/clone-project.svg?url';
import githubSignIn from './exampleScreens/github-sign-in.svg?url';
import changeLanguage from './exampleScreens/change-language.svg?url';
import downloadUpdate from './exampleScreens/download-update.svg?url';

const SHOT_AT = '2026-10-21T00:00:00Z';

const screens: Record<string, CardScreen> = {
  'connect-chatgpt': { src: connectChatgpt, kind: 'shot', at: SHOT_AT },
  'connect-api-key': { src: connectApiKey, kind: 'shot', at: SHOT_AT },
  'connect-server': { src: connectServer, kind: 'shot', at: SHOT_AT },
  'chat-work': { src: chatWork, kind: 'shot', at: SHOT_AT },
  'approve-action': { src: approveAction, kind: 'shot', at: SHOT_AT },
  'work-result': { src: workResult, kind: 'shot', at: SHOT_AT },
  'keep-memory': { src: keepMemory, kind: 'shot', at: SHOT_AT },
  'conversation-usage': { src: conversationUsage, kind: 'shot', at: SHOT_AT },
  'default-model': { src: defaultModel, kind: 'shot', at: SHOT_AT },
  'install-skill': { src: installSkill, kind: 'shot', at: SHOT_AT },
  'configure-agent': { src: configureAgent, kind: 'shot', at: SHOT_AT },
  'forget-memory': { src: forgetMemory, kind: 'shot', at: SHOT_AT },
  'open-project': { src: openProject, kind: 'shot', at: SHOT_AT },
  'import-conversation': { src: importConversation, kind: 'shot', at: SHOT_AT },
  'clone-project': { src: cloneProject, kind: 'sketch', at: SHOT_AT },
  'github-sign-in': { src: githubSignIn, kind: 'sketch', at: SHOT_AT },
  'change-language': { src: changeLanguage, kind: 'sketch', at: SHOT_AT },
  'download-update': { src: downloadUpdate, kind: 'sketch', at: SHOT_AT },
};

export function withScreens(map: TreeMap): TreeMap {
  return {
    ...map,
    cards: Object.fromEntries(
      Object.entries(map.cards).map(([id, card]) => [id, screens[id] ? { ...card, screen: screens[id] } : card]),
    ),
  };
}
