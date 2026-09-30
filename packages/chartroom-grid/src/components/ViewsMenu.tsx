/**
 * Saved views, in the toolbar (ADR-69): load one, save the current view
 * under a name, delete one, reset to the default, or copy the link that
 * carries the view. The store is whatever the host passed — the browser's
 * today, the governed API tomorrow — and a view loaded from it is the same
 * validated JSON an agent's `set_view` would produce.
 */

import { useEffect, useState } from 'react';
import { Bookmark, Link2, RotateCcw, Save, Trash2 } from 'lucide-react';
import { defaultView, type ViewState } from '../grid/viewState';
import type { SavedView, ViewStore } from '../views/store';
import { writeViewToHash } from '../views/url';
import { useSchema } from './SchemaContext';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Separator } from './ui/separator';

export function ViewsMenu({
  store,
  view,
  onLoad,
}: {
  store: ViewStore | null;
  view: ViewState;
  onLoad: (view: ViewState) => void;
}) {
  // Saved views are listed against the schema this grid shows (ADR-82).
  const schema = useSchema();
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<SavedView[]>([]);
  const [name, setName] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!open || !store) return;
    let live = true;
    void store.list(schema).then((v) => { if (live) setViews(v); });
    return () => { live = false; };
  }, [open, store]);

  const save = async () => {
    if (!store || !name.trim()) return;
    await store.save(name.trim(), view);
    setName('');
    setViews(await store.list(schema));
  };
  const remove = async (id: string) => {
    if (!store) return;
    await store.remove(id);
    setViews(await store.list(schema));
  };
  const copyLink = () => {
    const href = `${location.origin}${location.pathname}${writeViewToHash(location.hash || '#/grid', view)}`;
    try {
      void navigator.clipboard?.writeText(href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The clipboard is a courtesy, not a contract.
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" aria-label="Saved views" aria-expanded={open}>
          <Bookmark /> Views
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2 text-xs" data-slot="views-menu">
        <div className="text-[10px] font-semibold tracking-[0.06em] uppercase text-faint">Saved views</div>
        {store ? (
          <ul className="my-1 max-h-48 overflow-auto" data-slot="saved-views">
            {views.length === 0 && <li className="px-1 py-1 text-faint">none yet</li>}
            {views.map((v) => (
              <li key={v.id} className="flex h-7 items-center gap-1 rounded-sm px-1 hover:bg-muted/50" data-view-id={v.id}>
                <button
                  type="button"
                  data-slot="saved-view-load"
                  onClick={() => { onLoad(v.view); setOpen(false); }}
                  className="min-w-0 flex-1 truncate text-left hover:text-foreground"
                >
                  {v.name}
                </button>
                <Button variant="ghost" size="icon-xs" aria-label={`Delete view ${v.name}`} onClick={() => void remove(v.id)} className="text-faint">
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-1 py-1 text-faint">no store in this host</div>
        )}
        {store && (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => { e.preventDefault(); void save(); }}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this view" aria-label="View name" className="h-7 text-xs" />
            <Button type="submit" size="xs" disabled={!name.trim()} aria-label="Save view">
              <Save /> Save
            </Button>
          </form>
        )}
        <Separator className="my-2" />
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="xs" onClick={() => { onLoad(defaultView(schema)); setOpen(false); }} aria-label="Reset view">
            <RotateCcw /> Reset
          </Button>
          <Button variant="ghost" size="xs" onClick={copyLink} aria-label="Copy link to this view">
            <Link2 /> {copied ? 'Copied' : 'Copy link'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
