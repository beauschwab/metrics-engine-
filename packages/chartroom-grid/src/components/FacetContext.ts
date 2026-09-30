/**
 * Where a filter's choices come from (ADR-85): the rows the grid holds when
 * the client filters them, the source when it serves the filter — then the
 * rows are a window or engine-made groups, and listing their values would
 * leave out every value outside them. The shell provides it.
 */

import { createContext, useContext } from 'react';

export interface Facets {
  /** The source filters: the rows held are not the answer. */
  served: boolean;
  /** A dimension's values under the view's other filters, from the source; absent when the client's facets answer. */
  values?: (columnId: string) => Promise<string[]>;
}

export const FacetContext = createContext<Facets>({ served: false });
export const useFacets = (): Facets => useContext(FacetContext);
