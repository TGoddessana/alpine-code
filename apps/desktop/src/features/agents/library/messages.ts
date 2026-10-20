import { defineMessages } from '@/shared/i18n';

export const libraryMessages = defineMessages({
  ko: {
    title: '라이브러리',
    create: '만들기',
    writeSkill: '스킬 쓰기',
    writeSkillNote: '에이전트가 필요할 때 읽을 작업 안내',
    connectMcp: 'MCP 연결',
    connectMcpNote: '노션, 캘린더, 깃허브 같은 서비스',
    soon: '준비 중',
    tabs: '라이브러리 종류',
    tabSkill: '스킬',
    tabMcp: 'MCP',
    tabSub: '서브에이전트',
    mcpSoonTitle: 'MCP는 준비 중이에요',
    mcpSoonBody:
      '노션, 캘린더 같은 서비스를 MCP로 한 번 연결하면, 그 서비스가 주는 도구를 에이전트마다 골라 추가할 수 있어요.',
    subSoonTitle: '서브에이전트는 준비 중이에요',
    subSoonBody:
      '다른 에이전트를 서브에이전트로 추가하면 일을 맡기고 결과만 받아요. 서브에이전트는 자기 모델과 도구로 따로 일해요.',
  },
  en: {
    title: 'Library',
    create: 'Create',
    writeSkill: 'Write a skill',
    writeSkillNote: 'Instructions the agent reads when it needs them',
    connectMcp: 'Connect MCP',
    connectMcpNote: 'Services like Notion, Calendar, GitHub',
    soon: 'Coming soon',
    tabs: 'Kinds of library items',
    tabSkill: 'Skills',
    tabMcp: 'MCP',
    tabSub: 'Subagents',
    mcpSoonTitle: 'MCP is coming soon',
    mcpSoonBody:
      'Connect a service like Notion or Calendar through MCP once, then pick the tools it offers agent by agent.',
    subSoonTitle: 'Subagents are coming soon',
    subSoonBody:
      'Add another agent as a subagent to hand work over and get only the result back. A subagent works on its own with its own model and tools.',
  },
});
