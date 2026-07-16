import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string): string => readFileSync(path, 'utf8');

describe('internal navigation stays in-app', () => {
  it('does not open public internal pages in a new tab', () => {
    for (const path of ['index.html', 'marketing.html']) {
      expect(read(path), `${path} should not use target=_blank`).not.toMatch(/target=["']_blank["']/);
    }
  });

  it('landing About link is same-tab navigation to the public About page', () => {
    expect(read('index.html')).toContain('<a id="landingAbout" href="marketing.html">About the Game</a>');
  });
});

describe('Play Now navigation and course layout', () => {
  it('keeps an explicit first-step Back to Home path', () => {
    const main = read('src/slice3d/main.ts');
    expect(main).toContain("backBtn.textContent = sel.step === 0 ? 'Back to Home' : 'Back'");
    expect(main).toContain('if (sel.step <= 0) showLanding();');
  });

  it('renders course selection in the compact course grid, not the vertical mode stack', () => {
    const main = read('src/slice3d/main.ts');
    const html = read('index.html');
    expect(main).toContain('<div class="courseGrid">');
    expect(html).toContain('.courseGrid');
  });
});
