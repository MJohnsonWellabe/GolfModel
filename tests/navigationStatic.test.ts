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

  it('landing buttons are explicitly ordered as promo row, About row, account row', () => {
    const html = read('index.html');
    expect(html).toContain('"season store"');
    expect(html).toContain('"about about"');
    expect(html).toContain('"profile profile"');
    expect(html.indexOf('id="landingSeason"')).toBeLessThan(html.indexOf('id="landingStore"'));
    expect(html.indexOf('id="landingStore"')).toBeLessThan(html.indexOf('id="landingAbout"'));
    expect(html.indexOf('id="landingAbout"')).toBeLessThan(html.indexOf('id="landingProfile"'));
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

describe('About page media cleanup', () => {
  it('uses the longer montage footage for the Par 3 payoff clip', () => {
    const marketing = read('src/marketing/main.ts');
    expect(marketing).not.toContain('assets/marketing/videos/hole-in-one.mp4');
    expect(marketing).toContain("badge: 'Par 3'");
    expect(marketing).toContain('assets/marketing/videos/montage.mp4');
  });

  it('does not render the Fire-section pill row', () => {
    expect(read('marketing.html')).not.toContain('<div class=\"pillrow\">');
  });
});
