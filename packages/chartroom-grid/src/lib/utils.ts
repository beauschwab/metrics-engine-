/**
 * shadcn's `cn`: clsx for the conditionals, tailwind-merge so a caller's
 * class wins over a primitive's default instead of fighting it in the
 * cascade (ADR-65).
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
