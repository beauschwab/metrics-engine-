/**
 * A deliberately small markdown renderer for the chat's Response component —
 * headings, bold/italic, inline code, fenced code, lists, paragraphs. No
 * dependency, no HTML injection (everything renders through React text
 * nodes), and unfinished fences render sanely mid-stream.
 */

import type { ReactNode } from 'react';

function inline(text: string, keyBase: string): ReactNode[] {
  // Split on `code`, **bold**, *italic* — in that precedence.
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith('`')) out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('**')) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    else out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence (or end of stream)
      blocks.push(<pre key={key++} className="cr-chat-code">{code.join('\n')}</pre>);
      continue;
    }

    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(<div key={key++} className="cr-chat-h" data-level={h[1].length}>{inline(h[2], `h${key}`)}</div>);
      i += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i += 1;
      }
      blocks.push(
        <ul key={key++} className="cr-chat-ul">
          {items.map((it, j) => <li key={j}>{inline(it, `li${key}-${j}`)}</li>)}
        </ul>,
      );
      continue;
    }

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    const para: string[] = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() !== ''
      && !lines[i].startsWith('```') && !/^(#{1,4})\s/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i])) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push(<p key={key++} className="cr-chat-p">{inline(para.join(' '), `p${key}`)}</p>);
  }

  return <>{blocks}</>;
}
