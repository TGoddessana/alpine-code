/* Scoped prototype classes are defined in workspace-preview.css and use the shared design tokens. */
/* eslint better-tailwindcss/no-unknown-classes: ["error", { "ignore": ["^wp-", "^good$", "^link$"] }] */
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  ChevronRight,
  Circle,
  Copy,
  FileCode2,
  Folder,
  Globe,
  LoaderCircle,
  Play,
  Plus,
  Search,
  Send,
  Square,
  Terminal,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import './workspace-preview.css';

export type PreviewMode = 'files' | 'terminal' | 'servers' | 'stop';

const code = [
  "import { useState } from 'react';",
  "import { AddToCart } from './AddToCart';",
  "import type { Menu } from '../data/menu';",
  '',
  'type Props = { menu: Menu };',
  '',
  'export function MenuCard({ menu }: Props) {',
  '  const [quantity, setQuantity] = useState(1);',
  '  const soldOut = menu.stock === 0;',
  '',
  '  return (',
  '    <article className="menu-card">',
  '      <img src={menu.image} alt={menu.name} />',
  '      <div className="menu-details">',
  '        <h3>{menu.name}</h3>',
  '        <p>{menu.description}</p>',
  '        <span>{menu.price.toLocaleString()}원</span>',
  '        {soldOut && <span>품절</span>}',
  '      </div>',
  '      <AddToCart',
  '        quantity={quantity}',
  '        onQuantityChange={setQuantity}',
  '        disabled={soldOut}',
  '      />',
  '    </article>',
  '  );',
  '}',
];
const files = ['MenuCard.tsx', 'AddToCart.tsx', 'menu.ts'];
const logs = [
  { time: '14:32:01', text: '> bakery-web@0.1.0 dev', kind: '' },
  { time: '14:32:01', text: '> vite --host', kind: '' },
  { time: '14:32:02', text: 'VITE v8.3.1  ready in 284 ms', kind: 'good' },
  { time: '14:32:02', text: 'Local:   http://localhost:5173/', kind: 'link' },
  { time: '14:32:02', text: 'Network: http://192.168.0.12:5173/', kind: '' },
  { time: '14:33:18', text: '[vite] hmr update /src/components/MenuCard.tsx', kind: '' },
  { time: '14:33:19', text: '[vite] hmr update /src/components/AddToCart.tsx', kind: '' },
];

function Action({
  children,
  onClick,
  primary = false,
  danger = false,
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`wp-action ${primary ? 'wp-primary' : ''} ${danger ? 'wp-danger' : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function IconButton({
  label,
  children,
  onClick,
  disabled,
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="wp-icon" title={label} aria-label={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/** Interactive design fixture only. No filesystem, shell, or process APIs are called. */
export function WorkspacePreview({ mode = 'files' }: { mode?: PreviewMode }) {
  const [tab, setTab] = useState<PreviewMode>(mode);
  const codePane = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState('MenuCard.tsx');
  const [line, setLine] = useState(23);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [command, setCommand] = useState('');
  const [logsByTerminal, setLogsByTerminal] = useState<Record<string, string[]>>({});
  const [terminalTab, setTerminalTab] = useState('개발 서버');
  const extraLogs = logsByTerminal[terminalTab] ?? [];
  const setExtraLogs = (next: string[]) => setLogsByTerminal((current) => ({ ...current, [terminalTab]: next }));
  const [server, setServer] = useState<'running' | 'stopped' | 'conflict'>('running');
  const [stop, setStop] = useState<'running' | 'stopping' | 'remaining' | 'stopped'>('running');
  const [preview, setPreview] = useState(false);
  const [timestamps, setTimestamps] = useState(true);

  useEffect(() => {
    if (stop !== 'stopping') return;
    const timer = setTimeout(() => setStop('remaining'), 1600);
    return () => clearTimeout(timer);
  }, [stop]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const pane = codePane.current;
    const selected = pane?.querySelector('[aria-current="location"]');
    if (tab === 'files' && pane && selected) {
      pane.scrollTop += selected.getBoundingClientRect().top - pane.getBoundingClientRect().top - pane.clientHeight / 2;
    }
  }, [file, line, tab]);

  const openFile = (name: string, target = 23) => {
    setFile(name);
    setLine(target);
    setTab('files');
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`/Users/me/bakery-web/src/components/${file}:${line}`);
      setNotice('파일 경로를 복사했어요');
    } catch {
      setNotice('이 브라우저에서는 클립보드 접근이 허용되지 않았어요');
    }
  };
  const renderCode =
    file === 'MenuCard.tsx'
      ? code
      : file === 'AddToCart.tsx'
        ? [
            'type Props = { disabled: boolean };',
            '',
            'export function AddToCart({ disabled }: Props) {',
            '  return (',
            '    <button disabled={disabled}>',
            '      장바구니에 담기',
            '    </button>',
            '  );',
            '}',
          ]
        : [
            'export const menu = [',
            '  { name: "버터 크루아상", price: 4500, stock: 0 },',
            '  { name: "소금빵", price: 3000, stock: 12 },',
            '];',
          ];

  return (
    <div className="wp-shell">
      <aside className="wp-rail">
        <div className="wp-brand">
          <span className="wp-mark">a</span> alpinecode <span className="wp-prototype">UI 미리보기</span>
        </div>
        <button className="wp-project" type="button" onClick={() => setNotice('샘플 프로젝트 · bakery-web')}>
          <Folder size={16} /> bakery-web <ChevronRight size={14} />
        </button>
        <div className="wp-rail-label">작업</div>
        <div className="wp-session wp-selected">
          <span className="wp-dot" />
          품절 메뉴 버튼 고치기
        </div>
        <div className="wp-session">메뉴 사진 바꾸기</div>
        <div className="wp-session">예약 페이지 만들기</div>
        <div className="wp-rail-bottom">
          <span className="wp-dot" /> 내 컴퓨터에서 작업 중
        </div>
      </aside>
      <main className="wp-main">
        <header className="wp-top">
          <div>
            <span className="wp-muted">bakery-web</span>
            <ChevronRight size={14} />
            <span>품절 메뉴 버튼 고치기</span>
          </div>
          <span className="wp-muted">main · +10 −2</span>
        </header>
        <div className="wp-body">
          <section className="wp-chat" aria-label="작업 대화">
            <div className="wp-chat-content">
              <div className="wp-date">오늘 · 오후 2:32</div>
              <div className="wp-user">품절된 메뉴는 장바구니에 담을 수 없게 해줘. 화면에서도 확인하고 싶어.</div>
              <div className="wp-agent-name">
                <span className="wp-agent-avatar">a</span> Alpine
              </div>
              <p>품절 여부를 버튼에도 연결했어요. 품절 메뉴에는 ‘품절’ 표시가 나오고, 담기 버튼이 비활성화돼요.</p>
              <button className="wp-file-link" type="button" onClick={() => openFile('MenuCard.tsx')}>
                <FileCode2 size={15} />
                src/components/MenuCard.tsx<span>:23</span>
                <ArrowUpRight size={13} />
              </button>
              <div className="wp-changes">
                <span className="wp-muted">바뀐 파일 2개</span>
                {files.slice(0, 2).map((name, i) => (
                  <button type="button" key={name} onClick={() => openFile(name, i ? 5 : 23)}>
                    <FileCode2 size={14} />
                    <span>{name}</span>
                    <span className="wp-diff">+{i ? 6 : 4} −1</span>
                    <ChevronRight size={14} />
                  </button>
                ))}
              </div>
              <div className="wp-evidence">
                <Check size={15} />
                <span>메뉴 테스트 12개 통과</span>
              </div>
              <p>
                {tab === 'files'
                  ? '파일을 누르면 바뀐 위치를 바로 볼 수 있어요.'
                  : tab === 'stop'
                    ? '빌드와 이미지 최적화를 진행하고 있어요.'
                    : '개발 서버를 켜 두었어요. 실행 화면을 보면서 이어서 수정할 수 있어요.'}
              </p>
              {tab !== 'files' && (
                <button className="wp-inline-process" type="button" onClick={() => setTab('terminal')}>
                  <span className="wp-dot" />
                  <Terminal size={15} />
                  <span>개발 서버 실행 중</span>
                  <span className="wp-muted">:5173</span>
                  <ChevronRight size={14} />
                </button>
              )}
            </div>
            <div className="wp-composer">
              <div className="wp-composer-box">
                <span className="wp-muted">이어서 요청해 보세요</span>
                <div>
                  <Plus size={17} />
                  <span className="wp-muted">Alpine · 기본</span>
                  <IconButton
                    label="미리보기 입력 안내"
                    onClick={() => setNotice('이 화면은 UI 미리보기예요. 오른쪽 패널을 조작해 보세요.')}
                  >
                    <Send size={15} />
                  </IconButton>
                </div>
              </div>
              <span className="wp-composer-note">로컬 프로젝트 · 편집 자동 허용</span>
            </div>
          </section>
          <section className="wp-panel" aria-label="작업 패널">
            <div className="wp-panel-tabs" role="tablist" aria-label="작업 도구">
              {(
                [
                  ['files', '파일', FileCode2],
                  ['terminal', '터미널', Terminal],
                  ['servers', '개발 서버', Globe],
                  ['stop', '실행 관리', Square],
                ] as const
              ).map(([id, title, Icon]) => (
                <button
                  type="button"
                  key={id}
                  role="tab"
                  id={`preview-tab-${id}`}
                  aria-selected={tab === id}
                  aria-controls="preview-panel"
                  tabIndex={tab === id ? 0 : -1}
                  onKeyDown={(event) => {
                    const ids: PreviewMode[] = ['files', 'terminal', 'servers', 'stop'];
                    const index = ids.indexOf(id);
                    const next =
                      event.key === 'ArrowRight'
                        ? ids[(index + 1) % 4]
                        : event.key === 'ArrowLeft'
                          ? ids[(index + 3) % 4]
                          : event.key === 'Home'
                            ? ids[0]
                            : event.key === 'End'
                              ? ids[3]
                              : null;
                    if (next) {
                      event.preventDefault();
                      setTab(next);
                      document.getElementById(`preview-tab-${next}`)?.focus();
                    }
                  }}
                  onClick={() => setTab(id)}
                >
                  <Icon size={15} />
                  {title}
                  {id === 'servers' && server === 'running' && <span className="wp-dot" />}
                </button>
              ))}
            </div>
            <div className="wp-panel-content" role="tabpanel" id="preview-panel" aria-labelledby={`preview-tab-${tab}`}>
              {tab === 'files' && (
                <>
                  <div className="wp-file-tabs">
                    {files
                      .filter((name) => name !== 'menu.ts')
                      .map((name) => (
                        <button
                          type="button"
                          className={file === name ? 'wp-file-active' : ''}
                          key={name}
                          onClick={() => openFile(name, name === 'MenuCard.tsx' ? 23 : 5)}
                        >
                          <FileCode2 size={14} />
                          {name}
                        </button>
                      ))}
                  </div>
                  <div className="wp-file-toolbar">
                    <span className="wp-path">
                      src / {file === 'menu.ts' ? 'data' : 'components'} / <strong>{file}</strong>
                    </span>
                    <IconButton label="파일 경로 복사" onClick={copy}>
                      <Copy size={14} />
                    </IconButton>
                    <IconButton
                      label="외부 에디터에서 열기"
                      onClick={() => setNotice(`실제 연결 시 ${file}:${line}을 기본 에디터에서 열어요`)}
                    >
                      <ArrowUpRight size={16} />
                    </IconButton>
                  </div>
                  <div className="wp-location">
                    <span>
                      <span className="wp-dot" />
                      현재 원본
                    </span>
                    <span>대화에서 선택한 위치 · {line}행</span>
                  </div>
                  <div ref={codePane} className="wp-code" aria-label={`${file} 원본`}>
                    <pre>
                      {renderCode.map((text, index) => (
                        <div
                          key={index}
                          className={`wp-code-line ${index + 1 === line ? 'wp-line-selected' : ''}`}
                          aria-current={index + 1 === line ? 'location' : undefined}
                        >
                          <button type="button" aria-label={`${index + 1}행 선택`} onClick={() => setLine(index + 1)}>
                            {index + 1}
                          </button>
                          <code>{text}</code>
                        </div>
                      ))}
                    </pre>
                  </div>
                  <div className="wp-file-footer">
                    <span>TypeScript React · UTF-8</span>
                    <span>읽기 전용 · {renderCode.length}줄</span>
                  </div>
                  <div className="wp-quick-open">
                    <Search size={15} />
                    <input
                      aria-label="프로젝트 파일 찾기"
                      placeholder="프로젝트 파일 찾기…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                  {query && (
                    <div className="wp-search-results">
                      {files
                        .filter((name) => name.toLowerCase().includes(query.toLowerCase()))
                        .map((name) => (
                          <button
                            type="button"
                            key={name}
                            onClick={() => {
                              openFile(name, 1);
                              setQuery('');
                            }}
                          >
                            <FileCode2 size={14} />
                            {name}
                            <ArrowUpRight size={14} />
                          </button>
                        ))}
                      {!files.some((name) => name.toLowerCase().includes(query.toLowerCase())) && (
                        <p>일치하는 파일이 없어요.</p>
                      )}
                    </div>
                  )}
                </>
              )}
              {tab === 'terminal' && (
                <>
                  <div className="wp-section-heading">
                    <div>
                      <h2>터미널</h2>
                      <p>작업을 옮겨도 실행과 로그가 유지돼요.</p>
                    </div>
                    <IconButton
                      label="새 터미널"
                      onClick={() => {
                        setTerminalTab('새 터미널');
                        setLogsByTerminal((current) => ({ ...current, '새 터미널': [] }));
                      }}
                    >
                      <Plus size={17} />
                    </IconButton>
                  </div>
                  <div className="wp-terminal-tabs">
                    {['개발 서버', '테스트', ...(terminalTab === '새 터미널' ? ['새 터미널'] : [])].map((name) => (
                      <button
                        type="button"
                        key={name}
                        className={terminalTab === name ? 'wp-file-active' : ''}
                        onClick={() => setTerminalTab(name)}
                      >
                        {name === '개발 서버' ? <span className="wp-dot" /> : <Check size={13} />}
                        {name}
                      </button>
                    ))}
                  </div>
                  <div className="wp-terminal-meta">
                    <span>~/bakery-web · zsh</span>
                    <span>
                      {terminalTab === '개발 서버' && server === 'running' ? '실행 중 · 2분 18초' : '입력 가능'}
                    </span>
                  </div>
                  <div className="wp-log" role="log" aria-label="터미널 출력">
                    {terminalTab === '개발 서버' ? (
                      logs.map((log, i) => (
                        <div key={i} className={`wp-log-line ${log.kind}`}>
                          {timestamps && <time>{log.time}</time>}
                          <span>{log.text}</span>
                        </div>
                      ))
                    ) : (
                      <>
                        <div className="wp-log-line">
                          <span>$ {terminalTab === '테스트' ? 'pnpm test menu' : ''}</span>
                        </div>
                        {terminalTab === '테스트' && (
                          <>
                            <div className="wp-log-line good">✓ MenuCard.test.tsx (12 tests)</div>
                            <div className="wp-log-line">Test Files 1 passed (1)</div>
                            <div className="wp-log-line good">Tests 12 passed (12)</div>
                          </>
                        )}
                      </>
                    )}
                    {extraLogs.map((text, i) => (
                      <div className="wp-log-line" key={i}>
                        {text}
                      </div>
                    ))}
                    <span className="wp-terminal-cursor" />
                  </div>
                  <form
                    className="wp-terminal-input"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!command.trim()) return;
                      setExtraLogs([
                        ...extraLogs,
                        `$ ${command}`,
                        command.trim() === 'pwd'
                          ? '/Users/me/bakery-web'
                          : 'UI 미리보기: 명령을 입력했어요. 실제 셸 실행은 연결 전이에요.',
                      ]);
                      setCommand('');
                    }}
                  >
                    <ChevronRight size={16} />
                    <input
                      aria-label="터미널 입력"
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      placeholder={terminalTab === '개발 서버' ? '실행 중인 터미널에 입력…' : '명령 입력…'}
                    />
                    <IconButton
                      label="터미널 입력 보내기"
                      onClick={() => {
                        if (command.trim()) {
                          setExtraLogs([...extraLogs, `> ${command}`, 'UI 미리보기: 입력을 전달했어요.']);
                          setCommand('');
                        }
                      }}
                    >
                      <Send size={14} />
                    </IconButton>
                  </form>
                  <div className="wp-log-footer">
                    <button type="button" onClick={() => setTimestamps(!timestamps)}>
                      {timestamps ? <Check size={13} /> : <Circle size={13} />}시간 표시
                    </button>
                    <button type="button" onClick={() => setNotice('전체 로그는 이 미리보기에서 모두 표시하고 있어요')}>
                      <ArrowDown size={13} />
                      전체 로그
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTab('stop');
                        setStop('running');
                      }}
                    >
                      <Square size={12} />이 명령 중단
                    </button>
                  </div>
                </>
              )}
              {tab === 'servers' && (
                <>
                  <div className="wp-section-heading">
                    <div>
                      <h2>개발 서버</h2>
                      <p>이 프로젝트에서 켜 둔 실행 화면이에요.</p>
                    </div>
                    <span className="wp-badge">{server === 'stopped' ? '0' : '1'}개 실행 중</span>
                  </div>
                  <div className="wp-server-card">
                    <div className="wp-card-heading">
                      <span className={`wp-server-icon ${server === 'stopped' ? 'wp-offline' : ''}`}>
                        <Globe size={22} />
                      </span>
                      <div>
                        <h3>베이커리 웹</h3>
                        <span className="wp-muted">Vite · bakery-web</span>
                      </div>
                      <span className="wp-status">
                        {server === 'stopped' ? <Circle size={12} /> : <span className="wp-dot" />}
                        {server === 'stopped' ? '종료됨' : '실행 중'}
                      </span>
                    </div>
                    <div className="wp-server-url">
                      <span>localhost</span>
                      <strong>:5173</strong>
                      <span className="wp-muted">개발 서버</span>
                    </div>
                    <dl className="wp-server-details">
                      <div>
                        <dt>실행 명령</dt>
                        <dd>pnpm dev</dd>
                      </div>
                      <div>
                        <dt>시작한 작업</dt>
                        <dd>품절 메뉴 버튼 고치기</dd>
                      </div>
                      <div>
                        <dt>실행 시간</dt>
                        <dd>{server === 'stopped' ? '종료됨 · 로그 보존됨' : '2분 18초 · 대화 이동 후에도 유지'}</dd>
                      </div>
                    </dl>
                    <div className="wp-actions">
                      <Action primary onClick={() => (server === 'stopped' ? setServer('running') : setPreview(true))}>
                        {server === 'stopped' ? <Play size={14} /> : <ArrowUpRight size={14} />}
                        {server === 'stopped' ? '다시 시작' : '미리보기 열기'}
                      </Action>
                      <Action onClick={() => setTab('terminal')}>
                        <Terminal size={14} />
                        로그 보기
                      </Action>
                      {server !== 'stopped' && (
                        <IconButton
                          label="개발 서버 중단"
                          onClick={() => {
                            setTab('stop');
                            setStop('running');
                          }}
                        >
                          <Square size={13} />
                        </IconButton>
                      )}
                    </div>
                  </div>
                  <div className="wp-subsection">
                    <h3>다른 포트로 실행</h3>
                    <p>포트가 이미 사용 중이면 실행할 위치를 선택해요.</p>
                    <Action onClick={() => setServer('conflict')}>
                      <Plus size={14} />
                      서버 추가
                    </Action>
                  </div>
                  {server === 'conflict' && (
                    <div className="wp-conflict" role="alert">
                      <h3>5173번 포트를 사용 중이에요</h3>
                      <p>현재 베이커리 웹이 실행되고 있어요.</p>
                      <div className="wp-actions">
                        <Action
                          primary
                          onClick={() => {
                            setServer('running');
                            setPreview(true);
                          }}
                        >
                          기존 서버 열기
                        </Action>
                        <Action
                          onClick={() => {
                            setServer('running');
                            setNotice('UI 미리보기: 5174번 포트로 새 서버를 시작했어요');
                          }}
                        >
                          5174에서 시작
                        </Action>
                      </div>
                    </div>
                  )}
                  {preview && (
                    <div className="wp-browser-preview">
                      <div>
                        <Globe size={14} />
                        <span>localhost:5173</span>
                        <IconButton label="미리보기 닫기" onClick={() => setPreview(false)}>
                          <X size={15} />
                        </IconButton>
                      </div>
                      <section>
                        <span className="wp-bakery-label">우리 동네 베이커리</span>
                        <h3>매일 아침, 갓 구운 빵.</h3>
                        <p>버터 크루아상 · 4,500원</p>
                        <button type="button" disabled>
                          품절
                        </button>
                        <small>화면 구성 예시 · 실제 서버 연결 전</small>
                      </section>
                    </div>
                  )}
                </>
              )}
              {tab === 'stop' && (
                <>
                  <div className="wp-section-heading">
                    <div>
                      <h2>실행 관리</h2>
                      <p>중단 요청과 실제 종료를 따로 확인해요.</p>
                    </div>
                    <span className="wp-badge">
                      {stop === 'stopped' ? '0' : stop === 'remaining' ? '1' : '2'}개 실행 중
                    </span>
                  </div>
                  <div className="wp-stop-summary" role="status">
                    {stop === 'running' ? (
                      <>
                        <span className="wp-dot" />
                        <div>
                          <h3>작업 2개가 실행 중이에요</h3>
                          <p>원하는 명령만 멈추거나 전체를 중단할 수 있어요.</p>
                        </div>
                      </>
                    ) : stop === 'stopping' ? (
                      <>
                        <LoaderCircle size={18} className="wp-spin" />
                        <div>
                          <h3>중단을 요청했어요</h3>
                          <p>안전하게 마무리하고 종료되는지 확인 중이에요.</p>
                        </div>
                      </>
                    ) : stop === 'remaining' ? (
                      <>
                        <Circle size={18} />
                        <div>
                          <h3>아직 작업 1개가 실행 중이에요</h3>
                          <p>이미지 최적화 도구가 종료 요청에 응답하지 않았어요.</p>
                        </div>
                      </>
                    ) : (
                      <>
                        <Check size={18} />
                        <div>
                          <h3>모든 작업이 종료됐어요</h3>
                          <p>종료 전 출력과 이미 적용된 변경은 보존했어요.</p>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="wp-process-card">
                    <div className="wp-card-heading">
                      <Terminal size={18} />
                      <div>
                        <h3>프로덕션 빌드</h3>
                        <span className="wp-command">pnpm build</span>
                      </div>
                      <span className="wp-muted">
                        {stop === 'running' ? '실행 중' : stop === 'stopping' ? '종료 확인 중' : '종료됨'}
                      </span>
                    </div>
                    <div className="wp-process-log">
                      vite v8.3.1 building for production…
                      <br />✓ 142 modules transformed.
                      <br />
                      {stop === 'remaining' || stop === 'stopped'
                        ? '종료 신호 수신 · 프로세스 종료 확인'
                        : 'rendering chunks…'}
                    </div>
                    <div className="wp-process-footer">
                      <span>PID 48217 · 38초</span>
                      <Action disabled={stop !== 'running'} onClick={() => setStop('stopping')}>
                        <Square size={12} />이 명령 중단
                      </Action>
                    </div>
                  </div>
                  <div className="wp-process-card">
                    <div className="wp-card-heading">
                      <FileCode2 size={18} />
                      <div>
                        <h3>메뉴 이미지 최적화</h3>
                        <span className="wp-command">node scripts/optimize-images.mjs</span>
                      </div>
                      <span className={stop === 'remaining' ? 'wp-warning' : 'wp-muted'}>
                        {stop === 'stopped'
                          ? '강제 종료됨'
                          : stop === 'remaining'
                            ? '종료되지 않음'
                            : stop === 'stopping'
                              ? '종료 확인 중'
                              : '실행 중'}
                      </span>
                    </div>
                    <div className="wp-process-log">
                      croissant.webp 저장 완료
                      <br />
                      salt-bread.webp 변환 중…
                      {stop === 'stopped' && (
                        <>
                          <br />
                          강제 종료 · 일부 파일 변경이 남아 있어요
                        </>
                      )}
                    </div>
                    {stop === 'remaining' && (
                      <div className="wp-remaining">
                        <p>도구가 계속 파일을 쓸 수 있어요. 강제 종료하면 처리 중인 파일이 불완전할 수 있어요.</p>
                        <Action
                          danger
                          onClick={() => {
                            setStop('stopped');
                            setServer('stopped');
                          }}
                        >
                          이 작업 강제 종료
                        </Action>
                      </div>
                    )}
                    <div className="wp-process-footer">
                      <span>별도 실행 프로세스 · 24초</span>
                      <span>{stop === 'stopped' ? '로그 보존됨' : '이미지 1 / 3개 저장'}</span>
                    </div>
                  </div>
                  <div className="wp-stop-bottom">
                    <div className="wp-muted">
                      <Check size={14} />
                      중단 전 로그와 적용된 변경은 남아요.
                    </div>
                    {stop === 'running' ? (
                      <Action danger onClick={() => setStop('stopping')}>
                        <Square size={13} />
                        전체 중단
                      </Action>
                    ) : stop === 'stopped' ? (
                      <Action
                        onClick={() => {
                          setStop('running');
                          setServer('running');
                        }}
                      >
                        시나리오 다시 보기
                      </Action>
                    ) : (
                      <Action disabled>
                        <LoaderCircle size={13} />
                        {stop === 'remaining' ? '남은 작업 확인 필요' : '종료 확인 중'}
                      </Action>
                    )}
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      </main>
      {notice && (
        <div className="wp-toast" role="status">
          <Check size={15} />
          {notice}
        </div>
      )}
    </div>
  );
}
