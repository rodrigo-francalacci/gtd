import { MobileCapture } from '@/components/mobile-capture';
import { getBoxes, getRecentCaptures } from '@/lib/queries';
import { soleUrl } from '@/lib/sole-url';

/**
 * Capture is the home screen, not a page you navigate to.
 *
 * The reason to have this on a phone at all is to get a thought out of your
 * head before it goes, and any tap spent choosing where to type is a tap spent
 * on the wrong thing. Everything else here is somewhere you go afterwards.
 *
 * It is also where a share lands — from Android's share sheet and from the
 * browser extension's signed-out fallback, which arrive in the same shape.
 */
export default async function MobileHome(props: PageProps<'/m'>) {
  const searchParams = await props.searchParams;
  const one = (key: string) => {
    const value = searchParams[key];
    return typeof value === 'string' ? value : '';
  };

  const title = one('title');
  const text = one('text');
  const url = one('url');

  /**
   * Sharing apps disagree about which field the address goes in.
   *
   * Chrome sends the page title and its URL in the fields named for them.
   * Plenty of others put the whole thing in `text` and leave `url` empty, so a
   * bare address arriving as "text" is the address, not a thought that happens
   * to be one. Sorting it out here means the capture box is prefilled the same
   * way whatever app you shared from — and the URL ends up in the note rather
   * than the title, because a line of query string is unreadable in a list.
   */
  const sharedUrl = url || soleUrl(text) || '';
  const sharedTitle = sharedUrl === text ? title : text || title;

  const [recent, boxes] = await Promise.all([getRecentCaptures(5), getBoxes()]);

  return (
    <MobileCapture
      recent={recent}
      initialText={sharedTitle}
      initialUrl={sharedUrl}
      boxes={boxes.map((box) => ({ id: box.id, name: box.name }))}
      sharedKey={one('shared') || null}
      sharedCount={Number(one('n')) || 0}
      missedFiles={Number(one('missed')) || 0}
    />
  );
}
