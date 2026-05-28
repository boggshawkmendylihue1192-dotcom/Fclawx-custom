import { completeSetup, expect, test } from './fixtures/electron';

test.describe('Workbench navigation', () => {
  test('opens the workbench from the sidebar', async ({ page }) => {
    await completeSetup(page);

    await page.getByTestId('sidebar-nav-workbench').click();

    await expect(page).toHaveURL(/\/workbench$/);
    await expect(page.getByTestId('workbench-page')).toBeVisible();
  });
});
