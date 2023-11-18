import 'dotenv/config';

import assert from 'assert';
import express from 'express';
import { newInjectedPage } from 'fingerprint-injector';
import { createPool } from 'generic-pool';
import { Server } from 'http';
import nodeCleanup from 'node-cleanup';
import { Browser, Page, launch } from 'puppeteer';

// /scrape API ucundan dönülecek yanıt
interface ScrapeResult {
  url: string;
  durationMs: number;
  contents: string;
  headers: Record<string, string>;
}

let browser: Browser | null = null;

const pool = createPool<Page>({
  create: async () => {
    assert(browser);

    return await newInjectedPage(browser);
  },
  destroy: async (page) => await page.close(),
});

const app = express();
const port = Number(process.env.PORT ?? '7000');

let server: Server | null = null;

app.get('/scrape', async (req, res) => {
  const { url } = req.query;

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

    const resp = await page.goto(url);

    res.json({
      url: page.url(),
      durationMs: Date.now() - startTime,
      contents: await page.content(),
      headers: resp?.headers() ?? {},
    } satisfies ScrapeResult);
  } catch (err) {
    res.status(500).json({ error: err });
  } finally {
    if (page) {
      pool.release(page);
    }
  }
});

async function main() {
  browser = await launch({ headless: false });
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
