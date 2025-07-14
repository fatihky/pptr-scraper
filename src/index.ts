import 'dotenv/config';

import express from 'express';
import nodeCleanup from 'node-cleanup';
import type { Server } from 'node:http';
import { gzipSync } from 'node:zlib';
import type { Page } from 'puppeteer';
import { z } from 'zod';
import { getBrowser, launchBrowser, pool } from './pool';
import { type ScrapeResult, scrape } from './scrape';
import expressAsyncHandler from 'express-async-handler';

const app = express();
const port = Number(process.env.PORT ?? '7000');

let server: Server | null = null;

const scrapeQuerySchema = z.object({
  url: z.string().url(),
  infiniteScroll: z.coerce.boolean(),
  screenshot: z.coerce.boolean(),
  waitForNetwork: z.coerce.boolean(),
  maxScrolls: z.coerce.number().int().min(1).optional(),
  noBrowser: z.coerce.boolean().default(false),
  disableJs: z.coerce.boolean().default(false),
});

function cleanHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.keys(headers).reduce(
    (acc, key) => {
      acc[key] = headers[key].replace(/\r?\n|\r/g, '');

      return acc;
    },
    {} as Record<string, string>,
  );
}

app.get(
  '/scrape',
  expressAsyncHandler(async (req, res): Promise<void> => {
    const result = scrapeQuerySchema.safeParse(req.query);

    if (result.error) {
      res.status(400).json(result.error);
      return;
    }

    const {
      url,
      infiniteScroll,
      maxScrolls,
      noBrowser,
      screenshot,
      waitForNetwork,
      disableJs,
    } = result.data;

    console.log('Tara:', url, {
      infiniteScroll,
      maxScrolls,
      noBrowser,
      screenshot,
      waitForNetwork,
      disableJs,
    });

    if (typeof url !== 'string') {
      res
        .status(400)
        .json({ error: 'url parametresi zorunludur ve tek url verilmelidir.' });
      return;
    }

    if (noBrowser && disableJs) {
      res
        .status(400)
        .json({ error: 'noBrowser ve disableJs birlikte kullanılamaz.' });
      return;
    }

    if (noBrowser && screenshot) {
      res
        .status(400)
        .json({ error: 'noBrowser ile screenshot birlikte kullanılamaz.' });
      return;
    }

    let page: Page | null = null;
    let errored = false;
    let resp: ScrapeResult | null = null;

    try {
      const startTime = Date.now();

      if (noBrowser) {
        const response = await fetch(url);
        const responseHeaders: Record<string, string> = {};

        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        const buf = Buffer.from(await response.bytes());

        resp = {
          status: response.status,
          statusText: response.statusText,
          finalUrl: response.url,
          headers: responseHeaders,
          body: buf.length > 0 ? buf : null,
        };

        console.log('resp body:', resp.body);
      } else {
        page = await pool.acquire();

        await page.reload();

        resp = await scrape({
          page,
          url,
          infiniteScroll,
          maxScrolls,
          waitForNetwork,
          disableJs,
        });
      }

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
      const contents =
        screenshot && page
          ? await page.screenshot({ fullPage: true })
          : resp.body;
      const contentType: string | undefined = screenshot
        ? 'image/png'
        : (headers['content-type'] ?? undefined);

      const contentEncodingHeader = resp.headers['content-encoding'];
      const encoding: 'none' | 'br' | 'gzip' =
        contentEncodingHeader === 'br'
          ? 'none' // bize br geldiyse encode etmeden döneceğiz
          : contentEncodingHeader === 'gzip'
            ? 'gzip'
            : 'none';

      console.log(
        'resp:',
        resp.status,
        resp.statusText,
        { contentType, encoding },
        resp.headers,
      );

      const mappedHeaders = cleanHeaders(resp.headers);

      if (encoding !== 'gzip' && mappedHeaders['content-encoding']) {
        mappedHeaders['content-encoding'] = 'none';
      }

      res
        .set('pptr-scraper-duration', String(Date.now() - startTime))
        .set('pptr-scraper-url', encodeURI(url))
        .set('pptr-scraper-resolved-url', resp.finalUrl)
        .set(mappedHeaders);

      if (screenshot) {
        res.type('image/png');
      }

      res.status(resp.status);

      if (contents) {
        res.send(encoding === 'gzip' ? gzipSync(contents) : contents);
      } else {
        res.send(); // no content
      }
    } catch (err) {
      errored = true;

      console.error(
        'Scrape işlemi hata ile sonuçlandı:',
        url,
        err,
        err instanceof Error ? err.constructor : null,
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
  }),
);

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
