import { describe, expect, it } from 'vitest';

import { agentsMessages } from './messages';

const ko = agentsMessages.ko;

describe('agents messages', () => {
  it('words a tool added or removed with the right josa', () => {
    expect(ko.toastAdded('파일 읽기', '홈페이지 담당')).toBe('파일 읽기를 홈페이지 담당에 추가했어요');
    expect(ko.toastRemoved('명령 실행', '홈페이지 담당')).toBe('명령 실행을 홈페이지 담당에서 뺐어요');
  });

  it('tells what dropping does', () => {
    expect(ko.drop('내용 검색', '꼼꼼한 검토자')).toBe('여기에 놓으면 내용 검색을 꼼꼼한 검토자에 추가해요');
  });

  it('asks before deleting with the right josa', () => {
    expect(ko.deleteTitle('블로그 작가')).toBe('블로그 작가를 지울까요?');
    expect(ko.deleteTitle('홈페이지 담당')).toBe('홈페이지 담당을 지울까요?');
  });

  it('names a copy and a count', () => {
    expect(ko.copyName('블로그 작가')).toBe('블로그 작가 복사본');
    expect(ko.stripSummary('GPT-5.5', 6)).toBe('GPT-5.5 · 도구 6');
  });
});
