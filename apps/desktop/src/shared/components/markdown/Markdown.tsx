import { memo, type ElementType, type HTMLAttributes, type ReactNode } from 'react';
import { defaultRehypePlugins, Streamdown, useIsCodeFenceIncomplete, type Components } from 'streamdown';

import { useMessages } from '@/shared/i18n';
import { openInBrowser } from '@/shared/platform';

import { CodeBlock } from './CodeBlock';
import { messages } from './messages';

/**
 * Of Streamdown's HTML steps only sanitizing stays: without `raw`, HTML the model writes never becomes elements, and
 * without `harden` a link we don't open is plain text in our look (`Link` decides) rather than a "[blocked]" label.
 */
const rehypePlugins = [defaultRehypePlugins.sanitize!];

/** Links we open: web pages and mail, always in the default browser, never inside the app. */
const OPENABLE = /^(https?:|mailto:)/i;

function Link({ href, children }: { href: string | undefined; children: ReactNode }) {
  if (!href || !OPENABLE.test(href)) return <span>{children}</span>;
  return (
    <a
      href={href}
      title={href}
      onClick={(event) => {
        event.preventDefault();
        void openInBrowser(href);
      }}
      className="text-interactive underline decoration-line underline-offset-2 hover:decoration-interactive"
    >
      {children}
    </a>
  );
}

/**
 * Images are never loaded: a model could be steered into writing an image address that carries data out of the
 * project (the CSP blocks them too). What it meant to show is a link instead.
 */
function Image({ src, alt }: { src?: unknown; alt?: string }) {
  const t = useMessages(messages);
  const href = typeof src === 'string' ? src : undefined;
  return <Link href={href}>{t.image(alt || href || '')}</Link>;
}

function FencedCode({ className, children }: { className?: string; children?: ReactNode }) {
  const incomplete = useIsCodeFenceIncomplete();
  const language = /language-(\S+)/.exec(className ?? '')?.[1] ?? '';
  const code = typeof children === 'string' ? children : '';
  return <CodeBlock code={code.replace(/\n$/, '')} language={language} incomplete={incomplete} />;
}

/** An element with our classes. Streamdown also passes `node` (the syntax tree), which must not reach the DOM. */
function styled(Tag: ElementType, className: string) {
  return function Styled(props: HTMLAttributes<HTMLElement> & { node?: unknown }) {
    const rest = { ...props };
    delete rest.node;
    return <Tag className={className} {...rest} />;
  };
}

const Table = styled('table', 'w-full border-collapse');

/** Every element in our look (tokens only), so none of Streamdown's own styling shows. */
const components: Components = {
  p: styled('p', 'my-2'),
  strong: styled('strong', 'font-emphasis'),
  // The session title is the page's h1, so the reply's headings start below it.
  h1: styled('h3', 'mt-5 mb-2 text-title'),
  h2: styled('h3', 'mt-5 mb-2 text-title'),
  h3: styled('h4', 'mt-4 mb-2 text-lead'),
  h4: styled('h5', 'mt-3 mb-1 text-body'),
  h5: styled('h6', 'mt-3 mb-1 text-body'),
  h6: styled('h6', 'mt-3 mb-1 text-body text-fg-muted'),
  ul: styled('ul', 'my-2 list-disc pl-5 marker:text-fg-faint'),
  ol: styled('ol', 'my-2 list-decimal pl-5 marker:text-fg-muted'),
  li: styled('li', 'my-1 pl-1'),
  blockquote: styled('blockquote', 'my-2 border-l-2 border-line pl-3 text-fg-muted'),
  hr: styled('hr', 'my-4 border-line-subtle'),
  table: (props) => (
    <div className="my-3 overflow-x-auto">
      <Table {...props} />
    </div>
  ),
  th: styled('th', 'border-b border-line px-2 py-1 text-left align-bottom text-fg-muted'),
  td: styled('td', 'border-b border-line-subtle px-2 py-1 align-top'),
  a: ({ href, children }) => <Link href={href}>{children}</Link>,
  img: ({ src, alt }) => <Image src={src} alt={alt} />,
  inlineCode: styled('code', 'rounded-sm bg-canvas-sunken px-1 font-mono text-meta'),
  code: ({ className, children }) => <FencedCode className={className}>{children}</FencedCode>,
};

/**
 * Markdown the model wrote, drawn as it streams in. Streamdown splits it into blocks and parses only the block that
 * is still growing (the ones before it are kept), and closes what is left open (a `**` or a code fence) so the
 * unfinished end does not flicker.
 */
export const Markdown = memo(function Markdown({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <Streamdown
      className="text-body [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
      components={components}
      rehypePlugins={rehypePlugins}
      controls={false}
      linkSafety={{ enabled: false }}
      isAnimating={streaming}
    >
      {text}
    </Streamdown>
  );
});
