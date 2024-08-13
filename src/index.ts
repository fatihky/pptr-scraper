import 'dotenv/config';

import express from 'express';
import { Server } from 'http';
import nodeCleanup from 'node-cleanup';
import { Page } from 'puppeteer';
import { getBrowser, launchBrowser, pool } from './pool';
import { scrape } from './scrape';
import { z } from 'zod';

// /scrape API ucundan dönülecek yanıt
interface ScrapeResult {
  status: number;
  url: string;
  durationMs: number;
  contentType: string;
  contentsBase64: string;
  headers: Record<string, string>;
}

const app = express();
const port = Number(process.env.PORT ?? '7000');

let server: Server | null = null;

const scrapeQuerySchema = z.object({
  url: z.string().url(),
  infiniteScroll: z.coerce.boolean(),
  screenshot: z.coerce.boolean(),
});

app.get('/scrape', async (req, res) => {
  const result = scrapeQuerySchema.safeParse(req.query);

  if (result.error) {
    return res.status(400).json(result.error);
  }

  const { url, infiniteScroll, screenshot } = result.data;

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

    const resp = await scrape({
      page,
      url,
      infiniteScroll,
    });

    if (!resp) {
      res.json(500).json({ error: 'page.goto did not return any response' });

      return;
    }

    const headers = resp.headers();
    const contents = screenshot ? await page.screenshot() : await resp.buffer();
    const contentType = screenshot
      ? 'image/png'
      : headers['content-type'] ?? 'text/html';

    console.log('resp:', resp.status(), resp.statusText(), resp.headers());

    res.json({
      status: resp.status(),
      url: page.url(),
      durationMs: Date.now() - startTime,
      contentType: contentType.slice(0, contentType.indexOf(';')).trim(),
      contentsBase64: contents.toString('base64'),
      headers: resp.headers() ?? {},
    } satisfies ScrapeResult);
  } catch (err) {
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
      await pool.release(page);
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
