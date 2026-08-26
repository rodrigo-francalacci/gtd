'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Borrowing the sidebar.
 *
 * The first column is navigation, and while you are filtering a box it is the
 * one column in the app doing nothing. A panel that needs a tall narrow space —
 * the whole of a box's tag vocabulary, grouped and searchable — can have it for
 * as long as that takes, and hand it straight back.
 *
 * The reason this is worth a context rather than a panel drawn somewhere else
 * is that **the sidebar is already a drawer on a phone**. `AppShell` slides it
 * over the panes below `md` and pins it beside them above. So a takeover
 * rendered into that column is a modal on a phone and a column on a desktop
 * without either behaviour being written twice — the same trade the pane track
 * already makes, in the same place.
 *
 * State lives here and content is decided by whoever is borrowing it, which is
 * `FilePreviewProvider`'s arrangement exactly. The panel itself is portalled in
 * from several route segments below, because the thing that knows what the tags
 * *are* is the box page and it has no other way to reach up here.
 */
type SidebarSlot = {
  /** Where a panel portals to. Null until the shell has mounted. */
  node: HTMLElement | null;
  /** `AppShell` attaches this to the element panels render into. */
  attach: (node: HTMLElement | null) => void;
  /**
   * Whether the sidebar is currently lent out.
   *
   * The shell reads it to reveal the drawer on a phone — a panel portalled into
   * a column that is translated off screen is a panel nobody can see. Only one
   * takeover exists at a time, the same assumption the preview pane makes about
   * the file it is showing.
   */
  open: boolean;
  setOpen: (open: boolean) => void;
};

const Context = createContext<SidebarSlot | null>(null);

export function SidebarSlotProvider({ children }: { children: ReactNode }) {
  /*
   * The portal target is state, not a ref, because rendering has to happen
   * again once it exists — a ref would be filled in silently and the panel
   * would go on portalling to nothing. A ref *callback* setting state is the
   * ordinary way to say "re-render when this element appears", and it is not
   * the `set-state-in-effect` shape: it runs on attach, not on every commit.
   */
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);

  const attach = useCallback((next: HTMLElement | null) => setNode(next), []);

  const value = useMemo(
    () => ({ node, attach, open, setOpen }),
    [node, attach, open],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSidebarSlot(): SidebarSlot {
  const slot = useContext(Context);
  if (!slot) throw new Error('useSidebarSlot outside SidebarSlotProvider');
  return slot;
}

/**
 * The element panels portal into. `AppShell` renders one, inside the sidebar
 * column, and that is the whole of its involvement.
 *
 * A component of its own rather than a `ref={slot.attach}` in the shell,
 * because the compiler reasonably concludes that an object handed to a `ref` is
 * ref-like — and then every read of `slot.open` during the shell's render is a
 * ref access during render, which it refuses. Keeping the ref in a component
 * that reads nothing else settles it, and reads better besides: the shell says
 * *there is a slot here* rather than wiring one up.
 *
 * `display: contents` so it occupies nothing while empty. The panel positions
 * itself against the sidebar column, which is the nearest positioned ancestor.
 */
export function SidebarSlotTarget() {
  const { attach } = useSidebarSlot();
  return <div ref={attach} className="contents" />;
}
