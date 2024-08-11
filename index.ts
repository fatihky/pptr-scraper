import 'dotenv/config';

import { Solver } from '2captcha';
import assert from 'assert';
import { program } from 'commander';
import express from 'express';
import { newInjectedPage } from 'fingerprint-injector';
import { createPool } from 'generic-pool';
import { Server } from 'http';
import nodeCleanup from 'node-cleanup';
import { Browser, HTTPResponse, Page, PuppeteerLaunchOptions } from 'puppeteer';
import puppeteer from 'puppeteer-extra';
import RecaptchaPlugin from 'puppeteer-extra-plugin-recaptcha';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

const captchaSolver = new Solver(process.env.TWOCAPTCHA_API_KEY!);

interface TurnstileConfiguration {
  method: 'turnstile';
  key: string;
  sitekey: string;
  pageurl: string;
  data: string;
  pagedata: string;
  action: 'managed';
  userAgent: string;
  json: 1;
}

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

// /scrape API ucundan dönülecek yanıt
interface ScrapeResult {
  status: number;
  url: string;
  durationMs: number;
  contentType: string;
  contentsBase64: string;
  headers: Record<string, string>;
}

let browser: Browser | null = null;

// --no-headless dersek { headless: false } geliyor
// böylece tarayıcı görünür oluyor.
program
  .option('--no-headless', undefined, true)
  .option('--proxy <address>', 'Proxy address')
  .parse();

const opts = program.opts<{ headless: boolean; proxy: string | undefined }>();

const launchOptions: PuppeteerLaunchOptions = {
  headless: opts.headless,
  timeout: 180000,
  userDataDir: './userData',
  args: ['--no-sandbox'].concat(
    opts.proxy ? `--proxy-server=${opts.proxy}` : []
  ),
};

console.log('launch options:', launchOptions);

// eklentileri kaydet
puppeteer.use(
  RecaptchaPlugin({
    provider: {
      id: '2captcha',
      token: process.env.TWOCAPTCHA_API_KEY!,
    },
    visualFeedback: true,
  })
);

puppeteer.use(StealthPlugin());

async function newPage(attempts = 1): Promise<Page> {
  const maxAttempts = 5;

  try {
    if (!browser) {
      browser = await puppeteer.launch(launchOptions);
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

const pool = createPool<Page>(
  {
    create: async () => {
      assert(browser);

      console.log('pool: create a page');

      // check if the browser is alive by creating a dummy page
      const dummy = await newPage();

      await dummy.close();

      const page = await newInjectedPage(browser);

      page.evaluateOnNewDocument(turnstileScript);

      return page;
    },
    destroy: async (page) => {
      console.log('pool: close a page');

      await page.close().catch((err) => {
        console.log('Failed to close the page. Ignoring error:', err);
      });
    },
  },
  {
    max: 2,
    idleTimeoutMillis: 10 * 60 * 1000, // bir tarayıcı sekmesi 10 dakika boyunca boşta durabilir.
    evictionRunIntervalMillis: 10 * 60 * 1000, // 10 dakikada bir kullanılmayan sekmeleri kapatır
  }
);

const app = express();
const port = Number(process.env.PORT ?? '7000');

let server: Server | null = null;

function isCloudflareMitigateResponse(resp: HTTPResponse): boolean {
  return (
    resp.status() === 403 && resp.headers()['cf-mitigated'] === 'challenge'
  );
}

async function solveCloudflareTurnstile(page: Page) {
  const turnstileConfiguration: TurnstileConfiguration = await page.evaluate(
    () => (window as any).turnstileConfiguration
  );

  console.log('turnstile config:', turnstileConfiguration);

  const solution = await captchaSolver.turnstile(
    turnstileConfiguration.sitekey,
    turnstileConfiguration.pageurl,
    turnstileConfiguration
  );

  console.log('submit turnstile solution:', solution);

  await page.evaluate(
    (val) => (window as any).tsCallback?.(val),
    solution.data
  );

  await page.waitForNetworkIdle();
}

class MaxScrapeAttemptsExceededError extends Error {
  constructor(url: string) {
    super(
      `Max scrape attempts ${maxAttempts} exceeded while trying to scrape "${url}"`
    );
  }
}

const maxAttempts = 1;

async function scrape(
  page: Page,
  url: string,
  attempts = 1
): Promise<HTTPResponse | null> {
  let resp = await page.goto(url, {
    timeout: 180000,
    waitUntil: 'networkidle0',
  });

  if (resp === null) {
    return null;
  }

  if (isCloudflareMitigateResponse(resp)) {
    console.log(
      'Cloudflare mitigated our browsing. Try to automatically pass.'
    );

    if (attempts >= maxAttempts) {
      throw new MaxScrapeAttemptsExceededError(url);
    }

    await solveCloudflareTurnstile(page);

    console.log('Try to scrape the same url again...');

    return await scrape(page, url, attempts + 1);
  }

  return resp;
}

app.get('/scrape', async (req, res) => {
  const { url } = req.query;

  console.log('Tara:', url);

  if (typeof url !== 'string') {
    return res
      .status(400)
      .json({ error: 'url parametresi zorunludur ve tek url verilmelidir.' });
  }

  let page: Page | null = null;

  try {
    const acquireStart = Date.now();

    page = await pool.acquire();

    res.set(
      'X-Puppeteer-Page-Pool-Acquire-Time-Ms',
      String(Date.now() - acquireStart)
    );

    const startTime = Date.now();

    await page.reload();

    const resp = await scrape(page, url);

    if (!resp) {
      res.json(500).json({ error: 'page.goto did not return any response' });

      return;
    }

    // const promise = new Promise<HTTPResponse>((resolve, reject) => {
    //   let finished = false;

    //   function handler(response: HTTPResponse) {
    //     console.log('response:', response.status(), response.url(), response);

    //     if (!finished) {
    //       finished = true;
    //       resolve(response);
    //     }
    //   }

    //   page?.on('response', handler);

    //   page
    //     ?.goto(url, { timeout: 180000 })
    //     .catch((err: Error) => {
    //       finished = true;

    //       reject(err);
    //     })
    //     .finally(() => page?.off('response', handler));
    // });

    // const response = await pTimeout(promise, 180000);

    // console.log('ilk yanıt:', response.status(), response.url());
    console.log('resp:', resp.status(), resp.statusText(), resp.headers());
    const headers = resp.headers();
    const contentType = headers['content-type'] ?? 'text/html';

    res.json({
      status: resp.status(),
      url: page.url(),
      durationMs: Date.now() - startTime,
      contentType: contentType.slice(0, contentType.indexOf(';')).trim(),
      contentsBase64: (await resp.buffer()).toString('base64'),
      headers: resp.headers() ?? {},
    } satisfies ScrapeResult);
  } catch (err) {
    console.error(
      'Scrape işlemi hata ile sonuçlandı:',
      err,
      err instanceof Error ? err.constructor : null
    );

    res.status(500).json({ error: (err as Error).message });
  } finally {
    if (page) {
      await pool.release(page);
    }
  }
});

async function main() {
  browser = await puppeteer.launch(launchOptions);
  console.log('Browser launched...');

  server = app.listen(port);

  console.log(`server listening on http://127.0.0.1:${port}`);
}

main().catch((err) => {
  console.log('Main error:', err);

  process.exit(1);
});

nodeCleanup(() => {
  if (server) {
    console.log('Closing HTTP server...');

    server.close();
  }

  pool.clear().then(() => {
    if (browser) {
      console.log('Closing browser...');

      browser
        .close()
        .catch((err) => console.log('ERROR: Can not close browser:', err));
    }
  });
});
