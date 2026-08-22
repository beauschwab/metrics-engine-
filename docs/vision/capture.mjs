/**
 * Regenerate the walkthrough screenshots in product.md.
 *
 * The shots are of the real surfaces, not mockups, so they need the same
 * processes a developer runs. See docs/vision/README.md for the full recipe;
 * in short:
 *
 *   npx tsx packages/registry/index.ts                     # :8787
 *   (cd apps/registry-web && npm run build && npx vite preview --port 4173 --host 127.0.0.1)
 *   (cd apps/chartroom-api && KEEL_API=http://127.0.0.1:8787 npx tsx src/index.ts)   # :8788
 *   (cd apps/chartroom-studio && npm run build && npx vite preview --port 4174 --host 127.0.0.1)
 *
 *   node docs/vision/capture.mjs <phase>        # CHROMIUM_PATH=… if needed
 *
 * `phase` prefixes the filenames — the walkthrough shows `before` and `after`
 * the governed rate change, so the same script runs twice around it.
 */
import { chromium } from 'playwright';

const OUT = new URL('.', import.meta.url).pathname;
const phase = process.argv[2] || 'before';

const AUTHORING = 'http://127.0.0.1:4173';
const STUDIO = 'http://127.0.0.1:4174';

// The repo's Playwright pins a browser build the image may not carry; the
// e2e configs have the same escape hatch (CHROMIUM_PATH).
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log('captured', name);
};

// --- the two liquidity use cases, as the consumption half renders them -----
// The read-only view route (`#/view/<id>`): what a committee sees, and the
// same framing for every phase so the before/after shots are comparable.
for (const [slug, name] of [
  ['lcr-monitor', `${phase}-usecase1-lcr-monitor`],
  ['outflow-walk', `${phase}-usecase2-outflow-walk`],
]) {
  await page.goto(`${STUDIO}/#/view/${slug}`, { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  await shot(name);
}

// --- the authoring surface, on the document the change is made in ---------
await page.goto(`${AUTHORING}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const rateDoc = page.getByText('lcr_outflow_rates.yaml', { exact: false }).first();
if (await rateDoc.count()) {
  await rateDoc.click();
  await page.waitForTimeout(2500);
}
await shot(`${phase}-authoring-rate-table`);

await browser.close();
