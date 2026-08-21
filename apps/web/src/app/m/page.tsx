import { MobileCapture } from '@/components/mobile-capture';
import { getBoxes, getRecentCaptures } from '@/lib/queries';

/**
 * Capture is the home screen, not a page you navigate to.
 *
 * The reason to have this on a phone at all is to get a thought out of your
 * head before it goes, and any tap spent choosing where to type is a tap spent
 * on the wrong thing. Everything else here is somewhere you go afterwards.
 *
 * `text` and `url` prefill it — from the browser extension's signed-out
 * fallback, and from Android's share sheet, which arrive in the same shape.
 */
export default async function MobileHome(props: PageProps<'/m'>) {
  const searchParams = await props.searchParams;

  const text = typeof searchParams.text === 'string' ? searchParams.text : '';
  const url = typeof searchParams.url === 'string' ? searchParams.url : '';
  /** Android sends the page title separately from the selected text. */
  const title = typeof searchParams.title === 'string' ? searchParams.title : '';

  const [recent, boxes] = await Promise.all([getRecentCaptures(5), getBoxes()]);

  return (
    <MobileCapture
      recent={recent}
      initialText={text || title}
      initialUrl={url}
      boxes={boxes.map((box) => ({ id: box.id, name: box.name }))}
    />
  );
}
