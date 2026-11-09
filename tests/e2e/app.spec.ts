import { test, expect } from '@playwright/test';
async function login(page: any, email = 'admin', password = 'admin') {
  await page.goto('/login');
  await page.getByLabel('Email or username').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in to workspace', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole('heading', { name: /^Good (morning|afternoon|evening),/ }),
  ).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-login-transition');
}
test('company login fits desktop and mobile without clipping the form', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in to workspace', exact: true }).waitFor();
  await expect(page.locator('.login-form-footer')).toContainText('© 2025 Viotech');
  await page.evaluate(() => document.fonts.ready);
  for (const [width, height] of [
    [1920, 1080],
    [1366, 768],
    [1280, 600],
    [768, 1024],
    [390, 844],
    [375, 667],
    [320, 568],
    [844, 390],
    [568, 320],
  ]) {
    await page.setViewportSize({ width, height });
    const layout = await page.evaluate(() => {
      const boxes = [
        '.auth-card',
        '.login-form-footer',
        '.login-brand-link',
        '.login-mobile-brand .brand-logo',
      ]
        .map((selector) => document.querySelector(selector)!.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => ({ x: r.x, y: r.y, right: r.right, bottom: r.bottom }));
      return {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        boxes,
        overlap: boxes.some((a, i) =>
          boxes
            .slice(i + 1)
            .some(
              (b) =>
                Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 &&
                Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1,
            ),
        ),
      };
    });
    expect(layout.width, width + 'x' + height + ' horizontal overflow').toBeLessThanOrEqual(width);
    if (height >= 768)
      expect(layout.height, width + 'x' + height + ' vertical overflow').toBeLessThanOrEqual(
        height,
      );
    expect(layout.overlap, width + 'x' + height + ' overlapping controls').toBe(false);
    for (const box of layout.boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(width);
      expect(box.bottom).toBeLessThanOrEqual(layout.height);
    }
    if (width >= 1280 && height >= 700) expect(layout.boxes[0].right - layout.boxes[0].x).toBe(420);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/auth/login', (route) =>
    route.fulfill({ status: 401, json: { error: 'Incorrect username or password.' } }),
  );
  await page.getByLabel('Email or username').fill('missing');
  await page.getByLabel('Password', { exact: true }).fill('incorrect');
  await page.getByRole('button', { name: 'Sign in to workspace', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Incorrect username or password.');
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(844);
});

test('successful login unfolds into the dashboard on desktop and mobile', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/login');
    await page.getByLabel('Email or username').fill('admin');
    await page.getByLabel('Password', { exact: true }).fill('incorrect');
    await page.getByRole('button', { name: 'Sign in to workspace', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('html')).not.toHaveAttribute('data-login-transition');

    await page.getByLabel('Password', { exact: true }).fill('admin');
    const unfolding = page.waitForFunction(() => {
      const names = document
        .getAnimations()
        .map((animation) => (animation as CSSAnimation).animationName);
      return (
        names.includes('login-unfold-right') &&
        (window.innerWidth < 768 || names.includes('login-unfold-left'))
      );
    });
    await page.getByRole('button', { name: 'Sign in to workspace', exact: true }).click();
    await unfolding;
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole('heading', { name: /^Good (morning|afternoon|evening),/ }),
    ).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute('data-login-transition');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.getByRole('button', { name: 'Account menu', exact: true }).click();
    await page.getByRole('button', { name: 'Logout', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
  }
});

test('login remains immediate with reduced motion or no View Transition support', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    document.startViewTransition = () => {
      throw new Error('Reduced motion must not start a View Transition.');
    };
  });
  await login(page);
  await expect(page.locator('html')).not.toHaveAttribute('data-login-transition');
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() =>
    Object.defineProperty(document, 'startViewTransition', { value: undefined }),
  );
  await page.getByLabel('Email or username').fill('admin');
  await page.getByLabel('Password', { exact: true }).fill('admin');
  await page.getByRole('button', { name: 'Sign in to workspace', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole('heading', { name: /^Good (morning|afternoon|evening),/ }),
  ).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-login-transition');
});

test('company sidebar collapses, navigates and keeps the account controls accessible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
    ),
  ).toBe('#df0b3e');
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  expect(await page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().width)).toBe(
    76,
  );
  await page.getByRole('link', { name: 'Attendance', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Team attendance', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  expect(await page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().width)).toBe(
    224,
  );
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Logout', exact: true })).toBeVisible();
});

test('management screens, company assets, dialogs and dark mode', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('edtr-theme', 'light'));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/login');
  await page.screenshot({ path: 'test-results/login-light.png', fullPage: true });
  await login(page);
  await expect(page.getByRole('heading', { name: 'Weekly attendance', exact: true })).toBeVisible();
  await expect(page.locator('.stat-card')).toHaveCount(5);
  await page.screenshot({ path: 'test-results/dashboard-light.png', fullPage: true });
  const logo = page.getByAltText('VioTech IT Solutions');
  await expect(logo).toHaveAttribute('src', '/assets/logo-light-transparent.png');
  expect(await logo.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(logo).toHaveAttribute('src', '/assets/viotech-transparent.png');
  await page.screenshot({ path: 'test-results/dashboard-dark.png', fullPage: true });
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  for (const [link, title] of [
    ['Attendance', 'Team attendance'],
    ['Employee Log', 'Employee daily time records'],
    ['User Management', 'User management'],
    ['Requests', 'Requests & approvals'],
    ['Payroll', 'Payroll management'],
    ['Work Schedules', 'Work schedules'],
    ['Audit Logs', 'Audit logs'],
  ]) {
    await page.getByRole('link', { name: link, exact: true }).click();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.getByText('Loading your records…')).toHaveCount(0);
    await page.screenshot({
      path: `test-results/${link.toLowerCase().replaceAll(' ', '-')}.png`,
      fullPage: true,
    });
  }
  await page.getByRole('link', { name: 'User Management', exact: true }).click();
  await page.getByRole('button', { name: 'Add employee', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'Employee Log', exact: true }).click();
  await page.getByLabel('Search name or ID').fill('Raymond');
  await expect(page.locator('tbody tr').first()).toContainText('Raymond Santiago');
  await page
    .locator('tbody')
    .getByRole('button', { name: /^View / })
    .first()
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  const allImages = await page.locator('img:visible').evaluateAll((imgs: HTMLImageElement[]) =>
    imgs.map((i) => ({
      src: i.getAttribute('src'),
      loaded: i.complete && i.naturalWidth > 0,
      width: i.getBoundingClientRect().width,
      height: i.getBoundingClientRect().height,
    })),
  );
  expect(allImages.every((i) => i.loaded && i.width > 0 && i.height > 0)).toBe(true);
  expect(errors).toEqual([]);
});
test('employee scope, history calendar, payslip and recovery', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page, 'raymondsantiago', 'Raymond');
  await expect(page.getByRole('button', { name: 'Clock In', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'User Management', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/employee-dashboard.png', fullPage: true });
  await page.getByRole('link', { name: 'My DTR', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My daily time records' })).toBeVisible();
  await page.getByRole('button', { name: 'Calendar view' }).click();
  await expect(page.locator('.calendar-grid')).toBeVisible();
  await page.screenshot({ path: 'test-results/employee-calendar.png', fullPage: true });
  await page.getByRole('link', { name: 'My payslips', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Download payslip' })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('heading', { name: 'Forgot password?' })).toBeVisible();
  await page.getByLabel('Work email').fill('missing@example.com');
  await page.getByRole('button', { name: 'Send recovery link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
});
test('mobile navigation and layouts have no page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
  await page.screenshot({ path: 'test-results/mobile-dashboard.png', fullPage: true });
  for (const [link, title] of [
    ['Attendance', 'Team attendance'],
    ['Employee Log', 'Employee daily time records'],
    ['User Management', 'User management'],
    ['Payroll', 'Payroll management'],
  ]) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('link', { name: link, exact: true }).click();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    const widths = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(widths.page).toBeLessThanOrEqual(widths.viewport + 1);
    await expect
      .poll(() => page.locator('.sidebar').evaluate((e) => e.getBoundingClientRect().right))
      .toBeLessThanOrEqual(0);
    await page.screenshot({
      path: `test-results/mobile-${link.toLowerCase().replaceAll(' ', '-')}.png`,
      fullPage: true,
    });
  }
});

test('admin can log out from the header on a short desktop screen', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 650 });
  await login(page);
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page).toHaveURL(/login/);
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Sign in to workspace', exact: true }),
  ).toBeVisible();
  expect((await page.request.get('/api/auth/me')).status()).toBe(401);
});

test('HR access and brand motion respect user preferences', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page, 'HRAlex', 'hralex');
  await expect(page.getByRole('link', { name: 'User Management', exact: true })).toBeVisible();
  expect(
    await page
      .getByAltText('VioTech IT Solutions')
      .evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('none');
  await page.getByRole('link', { name: 'User Management', exact: true }).click();
  await expect(page.locator('img[src*="employee-welcome"]')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('eDTR');
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page).toHaveURL(/login/);
});

test('photo upload enables clock out immediately and preserves it after refresh', async ({
  page,
}) => {
  let own: any = null;
  await page.route('**/api/dashboard', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ json: { ...data, own } });
  });
  await page.route('**/api/attendance/clock-in', async (route) => {
    expect(route.request().postDataJSON().proof).toMatch(/^data:image\/png;base64,/);
    own = {
      id: 'proof-test',
      work_date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }),
      clock_in: new Date().toISOString(),
      clock_out: null,
      schedule_snapshot: { break_after_minutes: 360, break_minutes: 60 },
      worked_minutes: 0,
    };
    await route.fulfill({ status: 201, json: own });
  });
  await page.route('**/api/attendance/clock-out', async (route) => {
    own = { ...own, clock_out: new Date().toISOString() };
    await route.fulfill({ json: own });
  });
  await login(page, 'raymondsantiago', 'Raymond');
  await page.getByRole('button', { name: 'Clock In', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm clock in', exact: true })).toBeDisabled();
  await page
    .getByLabel('Upload clock-in photo')
    .setInputFiles('client/public/assets/logo-light-transparent.png');
  await expect(page.getByAltText('Clock-in proof preview')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm clock in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Clock Out', exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Clock Out', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Clock Out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Clock Out', exact: true })).toBeDisabled();
});

test('account menu opens profile and appearance settings', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('edtr-theme', 'light'));
  await login(page);
  await expect(page.locator('.sidebar .logout-button')).toHaveCount(0);
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('admin@edtr.local');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Appearance');
  await page.getByRole('dialog').getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('camera proof previews a capture and stops the camera', async ({ page }) => {
  await page.route('**/api/dashboard', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ json: { ...(await response.json()), own: null } });
  });
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#aaaaaa';
      ctx.fillRect(0, 0, 320, 240);
      const stream = canvas.captureStream(10);
      (window as any).testCameraStream = stream;
      return stream;
    };
  });
  await login(page, 'raymondsantiago', 'Raymond');
  await page.getByRole('button', { name: 'Clock In', exact: true }).click();
  await page.getByRole('button', { name: 'Use camera', exact: true }).click();
  await expect
    .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.videoWidth))
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Take photo', exact: true }).click();
  await expect(page.getByAltText('Clock-in proof preview')).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as any).testCameraStream
        .getTracks()
        .every((track: MediaStreamTrack) => track.readyState === 'ended'),
    ),
  ).toBe(true);
  await expect(page.getByRole('button', { name: 'Confirm clock in', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
