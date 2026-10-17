import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileNavigationProvider, FileReferences, parseFileLocation, useFileNavigation } from './navigation';

afterEach(cleanup);
describe('file references', () => {
  it('parses absolute, relative, encoded, line and column references', () => {
    expect(parseFileLocation('/project/a.ts:42:3')).toEqual({ path: '/project/a.ts', line: 42 });
    expect(parseFileLocation('src/a.ts#L21-L24')).toEqual({ path: 'src/a.ts', line: 21 });
    expect(parseFileLocation('src/My%20File.ts:3')).toEqual({ path: 'src/My File.ts', line: 3 });
    expect(parseFileLocation('README.md')).toEqual({ path: 'README.md', line: 1 });
  });
  it('rejects network or executable URLs and unrecognizable text', () => {
    for (const value of ['https://example.com/a.ts:2', 'javascript:alert(1)', 'file:///etc/passwd', 'hello', '%FF'])
      expect(parseFileLocation(value)).toBeNull();
  });
  it('opens compiler and grep references at their original line', () => {
    const opened = vi.fn();
    function State() {
      return <span data-testid="location">{JSON.stringify(useFileNavigation()?.location)}</span>;
    }
    render(
      <FileNavigationProvider cwd="/project" onOpen={opened}>
        <FileReferences text={'src/a.ts:42:3 error\nsrc/b.py:7: result'} />
        <State />
      </FileNavigationProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'src/a.ts:42:3' }));
    expect(screen.getByTestId('location').textContent).toBe('{"path":"src/a.ts","line":42}');
    expect(opened).toHaveBeenCalledOnce();
  });
});
