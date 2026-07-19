import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const shots = [
  ['wildvalley', 1, 'tee'], ['wildvalley', 2, 'tee'], ['wildvalley', 3, 'aerial'],
  ['redhollow', 1, 'tee'], ['redhollow', 2, 'tee'], ['redhollow', 3, 'aerial']
];
for (const [course, hole, cam] of shots) {
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
  page.setDefaultTimeout(120000);
  try {
    await page.goto(`http://127.0.0.1:5199/?course=${course}&hole=${hole}&cam=${cam}&freeze=1`);
    await page.waitForFunction(() => (window).__slice3d?.natureSettled === true, null, { timeout: 60000 }).catch(() => {});
    await page.evaluate(() => { const s = (window).__slice3d?.scene; if (s) for (let i = 0; i < 25; i++) s.render(); });
    await page.screenshot({ path: `/tmp/v-${course}-h${hole}.png`, timeout: 120000 });
    console.log('ok', course, hole);
  } catch (e) { console.log('FAIL', course, hole, e.message.split('\n')[0]); }
  await page.close();
}
await browser.close();
