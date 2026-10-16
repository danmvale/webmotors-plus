import { describe, expect, it } from 'vitest';
import { planLayout } from '../src/features/search-page/layout';

/** Measured on the live site: 340 px filters + 20 + 16 px gaps, 244 px cards 12 px apart. */
const site = { fixed: 376, card: 244, gap: 12 };

describe('planLayout', () => {
  it('widens a 2048 px screen just enough to keep 4 cards per row next to the panel', () => {
    const plan = planLayout({ ...site, container: 1556, viewport: 2033 });
    expect(plan.panelWidth).toBe(320);
    expect(plan.pageWidth).toBe(1712);
    // 1712 − 376 − 320 = 1016 ≥ 4 × 244 + 3 × 12 = 1012
    expect(plan.pageWidth! - site.fixed - plan.panelWidth).toBeGreaterThanOrEqual(1012);
  });

  it('narrows the panel before giving up a column', () => {
    // Native: 1296 − 536 = 760 → 3 cards. 3 cards + 300 px panel need 1436 px.
    const plan = planLayout({ ...site, container: 1296, viewport: 1490 });
    expect(plan).toEqual({ pageWidth: 1436, panelWidth: 300 });
  });

  it('leaves the page alone when no width keeps the native columns', () => {
    expect(planLayout({ ...site, container: 1296, viewport: 1432 })).toEqual({ panelWidth: 320 });
  });

  it('does not widen when the native layout already has the room', () => {
    expect(planLayout({ ...site, container: 1500, viewport: 1900 })).toEqual({ panelWidth: 320 });
  });
});
