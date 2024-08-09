import 'dotenv/config';

import assert from 'assert';
import { program } from 'commander';
import express from 'express';
import { newInjectedPage } from 'fingerprint-injector';
import { createPool } from 'generic-pool';
import { Server } from 'http';
import nodeCleanup from 'node-cleanup';
import { Browser, Page, launch } from 'puppeteer';

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
program.option('--no-headless', undefined, true).parse();

const opts = program.opts<{ headless: boolean }>();

const launchOptions = {
  headless: opts.headless,
  timeout: 180000,
  userDataDir: './userData',
  args: ['--no-sandbox'],
};

async function newPage(attempts = 1): Promise<Page> {
  const maxAttempts = 5;

  try {
    if (!browser) {
      browser = await launch(launchOptions);
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

      return await newInjectedPage(browser);
    },
    destroy: async (page) => {
      console.log('pool: close a page');

      await page.close().catch((err) => {
        console.log('Failed to close the page. Ignoring error:', err);
      });
    },
  },
  {
    max: 1,
    idleTimeoutMillis: 10 * 60 * 1000, // bir tarayıcı sekmesi 10 dakika boyunca boşta durabilir.
    evictionRunIntervalMillis: 10 * 60 * 1000, // 10 dakikada bir kullanılmayan sekmeleri kapatır
  }
);

const app = express();
const port = Number(process.env.PORT ?? '7000');

let server: Server | null = null;

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

    const resp = await page.goto(url, { timeout: 180000 });

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
  browser = await launch(launchOptions);
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
