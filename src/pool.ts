import assert from 'assert';
import { newInjectedPage } from 'fingerprint-injector';
import { createPool } from 'generic-pool';
import { Browser, Page } from 'puppeteer';
import program from './program';
import { puppeteer } from './puppeteer';

let browser: Browser | null = null;

const turnstileScript = `
var i = setInterval(() => {
  if (window.turnstile) {
    clearInterval(i);
    window.turnstile.render = (a, b) => {
      let p = {
        method: "turnstile",
        key: "${process.env.TWOCAPTCHA_API_KEY}",
        sitekey: b.sitekey,
        pageurl: window.location.href,
        data: b.cData,
        pagedata: b.chlPageData,
        action: b.action,
        userAgent: navigator.userAgent,
        json: 1,
      };
      console.log('resolve turnstile with 2captcha:', JSON.stringify(p), 'callback:', b.callback.toString());
      window.tsCallback = b.callback;
      window.turnstileConfiguration = p;
      return "foo";
    };
  }
}, 50);
`;

async function newPage(attempts = 1): Promise<Page> {
  const maxAttempts = 5;

  try {
    if (!browser) {
      browser = await puppeteer.launch(program.puppeteerLaunchOptions);
    }

    return await browser.newPage();
  } catch (err) {
    console.log(
      'Cannot create a page. Attempt %d. Error: %s',
      attempts,
      err instanceof Error ? err.message : JSON.stringify(err)
    );

    if (attempts >= maxAttempts) {
      throw new Error('Cannot create a new page');
    }

    // refresh the browser
    try {
      await browser?.close();
    } catch {
      // ignore
    }

    browser = null;

    return await newPage(attempts + 1);
  }
}

export const pool = createPool<Page>(
  {
    create: async () => {
      assert(browser);

      console.log('pool: create a page');

      // check if the browser is alive by creating a dummy page
      const dummy = await newPage();

      await dummy.close();

      const page = await newInjectedPage(browser);

      // github.com/trending sayfası 304 dönüyor bize
      page.setCacheEnabled(false);

      page.evaluateOnNewDocument(turnstileScript);

      return page;
    },
    destroy: async (page) => {
      console.log('pool: close a page');

      await page.close().catch((err) => {
        console.log('Failed to close the page. Ignoring error:', err);

        console.log('TARAYICIYI SIFIRLA...');

        Promise.resolve(browser?.close())
          .catch((err) =>
            console.log('Tarayıcıyı kapatırken hata oluştu:', err)
          )
          .finally(launchBrowser);
      });
    },
  },
  {
    max: Number(program.opts.maxTabs),
    idleTimeoutMillis: 10 * 60 * 1000, // bir tarayıcı sekmesi 10 dakika boyunca boşta durabilir.
    evictionRunIntervalMillis: 10 * 60 * 1000, // 10 dakikada bir kullanılmayan sekmeleri kapatır
  }
);

export async function launchBrowser() {
  browser = await puppeteer.launch(program.puppeteerLaunchOptions);
}

export function getBrowser() {
  return browser;
}
