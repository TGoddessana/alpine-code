import { createContext, useContext, useState, type ReactNode } from 'react';

export interface FileLocation {
  path: string;
  line: number;
}
export interface FileNavigation {
  cwd: string;
  location: FileLocation | null;
  open: (location: FileLocation) => void;
}
const Context = createContext<FileNavigation | null>(null);

export function FileNavigationProvider({
  cwd,
  onOpen,
  children,
}: {
  cwd: string;
  onOpen?: () => void;
  children: ReactNode;
}) {
  const [location, setLocation] = useState<FileLocation | null>(null);
  return (
    <Context.Provider
      value={{
        cwd,
        location,
        open: (next) => {
          setLocation(next);
          onOpen?.();
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export const useFileNavigation = () => useContext(Context);

/** Accept source references, never arbitrary URL schemes. The server enforces workspace boundaries. */
export function parseFileLocation(value: string): FileLocation | null {
  let path: string;
  try {
    path = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (/^(?:https?:|mailto:|javascript:|data:|file:|[a-z][\w+.-]*:\/\/)/i.test(path)) return null;
  const match = /^(.*?)(?::(\d+)(?::\d+)?|#L(\d+)(?:-L?\d+)?)?$/.exec(path);
  if (!match) return null;
  path = match[1] ?? '';
  if (!path || /[\n\r\0]/.test(path) || (!path.includes('/') && !/\.[a-z\d_-]+$/i.test(path))) return null;
  return { path, line: Math.max(1, Number(match[2] ?? match[3] ?? 1)) };
}

export function FileReference({ value, children }: { value: string; children?: ReactNode }) {
  const navigation = useFileNavigation();
  const location = parseFileLocation(value);
  return navigation && location ? (
    <button
      type="button"
      title={value}
      onClick={() => navigation.open(location)}
      className="cursor-pointer text-interactive underline decoration-line underline-offset-2 hover:decoration-interactive"
    >
      {children ?? value}
    </button>
  ) : (
    <>{children ?? value}</>
  );
}

/** Compiler and grep locations inside plain tool output. */
export function FileReferences({ text }: { text: string }) {
  const parts = text.split(/((?:\/?[\w.@+~-]+\/)*[\w.@+~-]+\.[a-zA-Z\d_-]+:\d+(?::\d+)?)/g);
  return <>{parts.map((part, index) => (index % 2 ? <FileReference key={index} value={part} /> : part))}</>;
}
