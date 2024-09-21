import 'dotenv/config';

import express from 'express';
import { Server } from 'http';
import nodeCleanup from 'node-cleanup';
import { Page } from 'puppeteer';
import { getBrowser, launchBrowser, pool } from './pool';
import { scrape } from './scrape';
import { z } from 'zod';
import { gzipSync } from 'zlib';

const app = express();
const port = Number(process.env.PORT ?? '7000');

let server: Server | null = null;

const scrapeQuerySchema = z.object({
  url: z.string().url(),
  infiniteScroll: z.coerce.boolean(),
  screenshot: z.coerce.boolean(),
  waitForNetwork: z.coerce.boolean(),
  maxScrolls: z.coerce.number().int().min(1).optional(),
});

app.get('/scrape', async (req, res) => {
  const result = scrapeQuerySchema.safeParse(req.query);

  if (result.error) {
    return res.status(400).json(result.error);
  }

  const { url, infiniteScroll, maxScrolls, screenshot, waitForNetwork } =
    result.data;

  console.log('Tara:', url, {
    infiniteScroll,
    maxScrolls,
    screenshot,
    waitForNetwork,
  });

  if (typeof url !== 'string') {
    return res
      .status(400)
      .json({ error: 'url parametresi zorunludur ve tek url verilmelidir.' });
  }

  let page: Page | null = null;
  let errored = false;

  try {
    page = await pool.acquire();

    const startTime = Date.now();

    await page.reload();

    const resp = await scrape({
      page,
      url,
      infiniteScroll,
      maxScrolls,
      waitForNetwork,
    });

    if (!resp) {
      res.json(500).json({ error: 'page.goto did not return any response' });

      return;
    }

    const headers = screenshot
      ? {
          'content-type': 'image/png',
          'pptr-scraper-original-headers': JSON.stringify(resp.headers),
        }
      : resp.headers;
    const contents = screenshot
      ? await page.screenshot({ fullPage: true })
      : resp.body;
    const contentType = screenshot
      ? 'image/png'
      : headers['content-type'] ?? 'text/html';

    const encoding: 'none' | 'gzip' =
      resp.headers['content-encoding'] === 'gzip' ? 'gzip' : 'none';

    console.log(
      'resp:',
      resp.status,
      resp.statusText,
      { contentType },
      resp.headers
    );

    res
      .set('pptr-scraper-duration', String(Date.now() - startTime))
      .set('pptr-scraper-url', url)
      .set('pptr-scraper-resolved-url', page.url())
      .set(headers);

    if (screenshot) {
      res.type('image/png');
    }

    res
      .status(resp.status)
      .send(encoding === 'none' ? contents : gzipSync(contents));
  } catch (err) {
    errored = true;

    console.error(
      'Scrape işlemi hata ile sonuçlandı:',
      err,
      err instanceof Error ? err.constructor : null
    );

    await page?.screenshot({
      path: `${Date.now()}-${new URL(url).host}-failed.screenshot.png`,
    });

    res.status(500).json({ error: (err as Error).message });
  } finally {
    if (page) {
      if (errored) {
        await pool.destroy(page);
      } else {
        await pool.release(page);
      }
    }
  }
});

async function main() {
  const host = process.env.HOST ?? '127.0.0.1';
  await launchBrowser();
  console.log('Browser launched...');

  server = app.listen(port, host);

  console.log(`server listening on http://${host}:${port}`);
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
    const browser = getBrowser();

    if (browser) {
      console.log('Closing browser...');

      browser
        .close()
        .catch((err) => console.log('ERROR: Can not close browser:', err));
    }
  });
});
