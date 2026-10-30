import { test, expect } from '@playwright/test';
test('two tabs restore settings, export files and retain working desk cards', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  // Fonts are optional; the test must not depend on external network services.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  await page.goto('./');
  const exporter = page.frameLocator('iframe');
  await expect(exporter.locator('#download')).toBeEnabled();
  await exporter.locator('#seed').fill('42'); await exporter.locator('#seed').dispatchEvent('change');
  await exporter.locator('#seams').check();
  const jsonDownload = page.waitForEvent('download'); await exporter.getByText('Save JSON', { exact: true }).click();
  expect((await jsonDownload).suggestedFilename()).toMatch(/\.json$/);
  await exporter.locator('#w').fill('64'); await exporter.locator('#w').dispatchEvent('change');
  await exporter.locator('#h').fill('64'); await exporter.locator('#h').dispatchEvent('change');
  const pngDownload = page.waitForEvent('download'); await exporter.locator('#download').click();
  expect((await pngDownload).suggestedFilename()).toMatch(/\.png$/);
  await page.getByRole('tab', { name: 'Desk', exact: true }).click();
  await expect(page.locator('iframe')).toHaveCount(1);
  const desk = page.frameLocator('iframe');
  await expect(desk.locator('.card.ready').first()).toBeVisible({ timeout: 60000 });
  await desk.locator('#props').uncheck();
  await desk.locator('#motion').uncheck();
  await page.getByRole('tab', { name: 'Exporter', exact: true }).click();
  await expect(page.frameLocator('iframe').locator('#seed')).toHaveValue('42');
  await expect(page.frameLocator('iframe').locator('#seams')).toBeChecked();
  await page.goBack();
  await expect(page.getByRole('tab', { name: 'Desk', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.frameLocator('iframe').locator('#props')).not.toBeChecked();
  await page.getByRole('tab', { name: 'Desk', exact: true }).focus(); await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Exporter', exact: true })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('tab', { name: 'Desk', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('all desk card styles render and inspector exposes component examples', async ({ page }, testInfo) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
  const hash = '#n=25&l=grid&p=0&mo=0&a=0';
  await page.goto(`./?tab=desk&desk=${encodeURIComponent(hash)}`);
  const desk = page.frameLocator('iframe');
  await expect(desk.locator('.card.ready')).toHaveCount(25, { timeout: 60000 });
  const frame = page.frames().find(f => f.url().includes('/desk/index.html'))!;
  expect(await frame.evaluate(() => new Set((window as any).desk.items.filter((i: any) => i.card).map((i: any) => i.card.kindId)).size)).toBe(25);
  await desk.locator('.card.ready').first().click({ force: true });
  await expect(desk.locator('#iVanilla')).toBeVisible();
  await expect(desk.locator('#iReact')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('desk.png') });
});


test('public vanilla gallery renders all presets with readable selectable content', async ({ page }, testInfo) => {
  await page.goto('./components.html');
  await expect(page.locator('.pp-paper[data-rendered="webgl2"]')).toHaveCount(25);
  await expect(page.locator('[data-preset="sticky"] .pp-slot')).toHaveText('Sticky note');
  const geometry = await page.locator('[data-preset="tag"] .pp-base').evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')!;
    const bytes = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return { transparent: bytes[3] === 0, colored: bytes.some((v, i) => i % 4 === 3 && v > 0) };
  });
  expect(geometry).toEqual({ transparent: true, colored: true });
  await page.screenshot({ path: testInfo.outputPath('components.png'), fullPage: true });
});
