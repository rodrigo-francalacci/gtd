'use client';

import type { ReactNode } from 'react';

/**
 * A calendar event's notes, drawn the way Google draws them.
 *
 * Google stores an event's description as HTML whenever it was written with
 * formatting — a booking confirmation arrives as paragraphs, bold labels, a
 * bulleted list and links — and as plain text with newlines when it was not.
 * Rendering the first kind as text put every `<li>` and `<b>` on screen, which
 * is the ugliest possible reading of something that was perfectly legible in
 * Google.
 *
 * **Parsed, then rebuilt as React from an allowlist — never injected.** This is
 * somebody else's content, arriving from an invitation, and the app has no
 * business running any of it. `DOMParser` builds an inert document: its scripts
 * do not run and its images are not fetched, because a parsed document has no
 * browsing context. Nothing from it reaches the page directly; each allowed
 * element is re-created here with our own classes, and everything else
 * contributes only its text. The same shape `NoteText` takes with a note, for
 * the same reason: no `dangerouslySetInnerHTML` anywhere near it.
 *
 * **Images are dropped.** A picture in an invitation is overwhelmingly a
 * tracking pixel or a logo, and loading one would tell its sender when you read
 * the event — the same reason a filed email's remote images never load.
 *
 * **A link keeps only an address that cannot run.** http, https, mailto and
 * tel; anything else becomes its text. A `javascript:` href in an invitation is
 * a script that runs when clicked.
 */
export function EventNotes({ text }: { text: string }) {
  const html = /<\/?[a-z][^>]*>/i.test(text);

  return (
    <div className="text-[13px] leading-relaxed text-grey-700 [overflow-wrap:anywhere]">
      {html && typeof DOMParser !== 'undefined' ? (
        fromHtml(text)
      ) : (
        /* Plain text means what it says, newlines included. */
        <p className="whitespace-pre-wrap">{linkify(html ? stripTags(text) : text)}</p>
      )}
    </div>
  );
}

function fromHtml(source: string): ReactNode {
  const body = new DOMParser().parseFromString(source, 'text/html').body;
  trimEnds(body);
  return walk(body.childNodes, false);
}

/**
 * Leading and trailing breaks go.
 *
 * Google's editor pads a description with a `<br>` or an empty paragraph at
 * either end as you type, and drawn literally that is a blank line under the
 * "Notes" heading which reads as a rendering fault.
 */
function trimEnds(body: HTMLElement): void {
  const blank = (node: ChildNode | null) =>
    node !== null &&
    (node.nodeType === Node.TEXT_NODE
      ? !node.textContent?.trim()
      : node.nodeName === 'BR' ||
        (['P', 'DIV'].includes(node.nodeName) && !node.textContent?.trim()));

  while (blank(body.firstChild)) body.firstChild!.remove();
  while (blank(body.lastChild)) body.lastChild!.remove();
}

/** Dropped with everything inside them: none of it is text anybody wrote. */
const SILENT = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'SVG', 'IMG', 'HEAD', 'TITLE']);

function walk(nodes: NodeListOf<ChildNode>, inLink: boolean): ReactNode[] {
  const out: ReactNode[] = [];

  nodes.forEach((node, index) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent ?? '';
      /*
       * Whitespace between tags is the source's indentation, not a line you
       * wrote. Google writes its line breaks as `<br>`; a bare newline sitting
       * between two list items drawn as a break would put a gap in the list.
       */
      if (!value.trim() && value.includes('\n')) return;
      out.push(inLink ? value : linkify(value, index));
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node as Element;
    const tag = element.nodeName;
    if (SILENT.has(tag)) return;

    const children = () => walk(element.childNodes, inLink || tag === 'A');
    const key = index;

    switch (tag) {
      case 'BR':
        out.push(<br key={key} />);
        return;
      case 'P':
      case 'DIV':
        // Both as a `div`: a `p` cannot hold a `div`, and descriptions nest
        // them freely.
        out.push(
          <div key={key} className="my-2 first:mt-0 last:mb-0">
            {children()}
          </div>,
        );
        return;
      case 'H1':
      case 'H2':
      case 'H3':
      case 'H4':
      case 'H5':
      case 'H6':
        out.push(
          <div key={key} className="mt-3 mb-1 font-semibold text-grey-800 first:mt-0">
            {children()}
          </div>,
        );
        return;
      case 'UL':
        out.push(
          <ul key={key} className="my-2 list-disc space-y-0.5 pl-5 first:mt-0 last:mb-0">
            {children()}
          </ul>,
        );
        return;
      case 'OL':
        out.push(
          <ol key={key} className="my-2 list-decimal space-y-0.5 pl-5 first:mt-0 last:mb-0">
            {children()}
          </ol>,
        );
        return;
      case 'LI':
        out.push(<li key={key}>{children()}</li>);
        return;
      case 'B':
      case 'STRONG':
        out.push(
          <strong key={key} className="font-semibold text-grey-800">
            {children()}
          </strong>,
        );
        return;
      case 'I':
      case 'EM':
        out.push(<em key={key}>{children()}</em>);
        return;
      case 'U':
        out.push(<u key={key}>{children()}</u>);
        return;
      case 'S':
      case 'STRIKE':
      case 'DEL':
        out.push(<s key={key}>{children()}</s>);
        return;
      case 'CODE':
        out.push(
          <code key={key} className="font-mono text-[12px]">
            {children()}
          </code>,
        );
        return;
      case 'PRE':
        out.push(
          <pre key={key} className="my-2 whitespace-pre-wrap font-mono text-[12px]">
            {children()}
          </pre>,
        );
        return;
      case 'BLOCKQUOTE':
        out.push(
          <div key={key} className="my-2 border-l-2 border-grey-200 pl-3">
            {children()}
          </div>,
        );
        return;
      case 'HR':
        out.push(<hr key={key} className="my-3 border-grey-200" />);
        return;
      case 'A': {
        const href = safeHref(element.getAttribute('href'));
        out.push(
          href && !inLink ? (
            <Anchor key={key} href={href}>
              {children()}
            </Anchor>
          ) : (
            <span key={key}>{children()}</span>
          ),
        );
        return;
      }
      default:
        // Anything unrecognised contributes its text rather than vanishing:
        // silently dropping words would make the pane lie about the event.
        out.push(<span key={key}>{children()}</span>);
    }
  });

  return out;
}

function safeHref(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function Anchor({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-grey-800 underline underline-offset-2 hover:text-grey-900"
    >
      {children}
    </a>
  );
}

/**
 * Bare addresses become links, in both kinds of description.
 *
 * A meeting link pasted into plain notes is the commonest thing in them, and
 * one you have to select and copy on a phone is one you do not follow.
 * Trailing punctuation stays outside the link — a sentence ending in an
 * address ends in a full stop, not in a URL that 404s.
 */
function linkify(text: string, base: number | string = 0): ReactNode {
  const parts = text.split(/(https?:\/\/[^\s<>"]+)/g);
  if (parts.length === 1) return text;

  return parts.map((part, index) => {
    if (index % 2 === 0) return part;
    const trail = part.match(/[.,;:!?)\]]+$/)?.[0] ?? '';
    const address = trail ? part.slice(0, -trail.length) : part;
    const href = safeHref(address);
    return href ? (
      <span key={`${base}-${index}`}>
        <Anchor href={href}>{address}</Anchor>
        {trail}
      </span>
    ) : (
      part
    );
  });
}

/** Only for the render with no `DOMParser`, which should never be reached. */
function stripTags(text: string): string {
  return text.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
}
