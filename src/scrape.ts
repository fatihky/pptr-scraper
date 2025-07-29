import type { HTTPResponse, Page } from 'puppeteer';
import { captchaSolver } from './captchaSolver';
import { logger } from './logger';

export interface ScrapeParams {
  page: Page;
  url: string;
  infiniteScroll?: boolean;
  waitForNetwork?: boolean;
  maxScrolls?: number;
}

export interface ScrapeResult {
  body: Buffer | null;
  headers: Record<string, string>;
  status: number;
  statusText: string;
  finalUrl: string;
}

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

const maxAttempts = 1;

function isCloudflareMitigateResponse(resp: HTTPResponse): boolean {
  return (
    resp.status() === 403 && resp.headers()['cf-mitigated'] === 'challenge'
  );
}

async function solveCloudflareTurnstile(page: Page) {
  const turnstileConfiguration: TurnstileConfiguration = await page.evaluate(
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    () => (window as any).turnstileConfiguration,
  );

  logger.info('turnstile config:', turnstileConfiguration);

  const solution = await captchaSolver.turnstile(
    turnstileConfiguration.sitekey,
    turnstileConfiguration.pageurl,
    turnstileConfiguration,
  );

  logger.info('submit turnstile solution:', solution);

  await page.evaluate(
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    (val) => (window as any).tsCallback?.(val),
    solution.data,
  );

  await page.waitForNetworkIdle();
}

class MaxScrapeAttemptsExceededError extends Error {
  constructor(url: string) {
    super(
      `Max scrape attempts ${maxAttempts} exceeded while trying to scrape "${url}"`,
    );
  }
}

async function scrollToBottom(page: Page, opts?: { maxScrolls?: number }) {
  const maxScrolls = opts?.maxScrolls ?? 20;
  let scrolls = 0;
  const scrollDelayMs = 800;
  let previousHeight = 0;
  const newItemsLoadTimeout = 20000;

  logger.info('sayfayı en aşağı kadar kaydır');

  for (; scrolls < maxScrolls; scrolls++) {
    previousHeight = await page.evaluate(() => document.body.scrollHeight);

    // önce yukarı taşıyoruz scroll'u. bu sayede yeniden aşağı taşıdığımızda sonraki sayfa yüklenecek
    const coordinates = await page.evaluate(() => {
      const coordinates = {
        x: 0,
        y: Math.max(
          document.body.scrollHeight -
            document.documentElement.clientHeight -
            500,
          0,
        ),
        scrollHeight: document.body.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
      };

      window.scrollTo(coordinates.x, coordinates.y);

      return coordinates;
    });

    logger.info('Yukarı taşıma koordinatları:', coordinates);

    // scroll'u yukarı taşıdıktan sonra bir saniye kadar bekleyelim
    await new Promise((r) => setTimeout(r, 1000));

    // şimdi aşağı taşıyoruz sayfayı
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // sayfaya yeni elemanların eklenmesini, sayfanın uzamasını bekliyoruz
    // bekleme süremizi de kısıtlıyoruz ki yeni bir şey eklenmezse biz hata
    // vermeden süreci sonlandıralım.
    const waitNewItemsUntil = Date.now() + newItemsLoadTimeout;

    await page.waitForFunction(
      (waitNewItemsUntil, previousHeight) =>
        Date.now() >= waitNewItemsUntil ||
        document.body.scrollHeight > previousHeight,
      { timeout: 60000, polling: 100 },
      waitNewItemsUntil,
      previousHeight,
    );

    const currentHeight = await page.evaluate(() => document.body.scrollHeight);

    // sayfa uzamadıysa scroll'u sonlandıralım.
    if (currentHeight === previousHeight) {
      logger.info('sayfa kaydırması sonrası sayfanın yüksekliği değişmedi:', {
        currentHeight,
        previousHeight,
      });
      break;
    }

    // scroll sonrası bekliyoruz ki sitenin istek sınırlamalarına takılmayalım
    // kullanıcı sanki ürünleri inceliyormuş gibi beklemiş oluyor burada.
    await new Promise((r) => setTimeout(r, scrollDelayMs));
  }

  logger.info('sayfa kaydırma bitti. kaydırma sayısı:', scrolls);
}

export async function scrape(
  { maxScrolls, page, url, infiniteScroll, waitForNetwork }: ScrapeParams,
  attempts = 1,
): Promise<ScrapeResult | null> {
  if (attempts > maxAttempts) {
    throw new MaxScrapeAttemptsExceededError(url);
  }

  const resp = await page.goto(url, {
    timeout: 180000,
    waitUntil: waitForNetwork ? 'networkidle0' : undefined,
  });

  if (resp === null) {
    return null;
  }

  if (isCloudflareMitigateResponse(resp)) {
    logger.info(
      'Cloudflare mitigated our browsing. Try to automatically pass.',
    );

    await solveCloudflareTurnstile(page);

    logger.info('Try to scrape the same url again...');

    return await scrape(
      { page, url, infiniteScroll, waitForNetwork },
      attempts + 1,
    );
  }

  if (infiniteScroll) {
    await scrollToBottom(page, { maxScrolls });
  }

  if (waitForNetwork) {
    try {
      // iki dakikaya kadar bağlantıların kapanmasını bekle
      await page.waitForNetworkIdle({ timeout: 120000 });
    } catch {
      // ignore
    }
  }

  let body: Buffer<ArrayBufferLike> | null = null;

  try {
    body = infiniteScroll
      ? Buffer.from(await page.content())
      : await resp.buffer();
  } catch (err) {
    if (infiniteScroll) {
      throw err;
    }

    // bazı sayfalar not found dönüyor ama body boş geliyor.
    // bu durumda resp.buffer() hata veriyor. o yüzden infiniteScroll
    // durumu dışında body dönmüyoruz
  }

  return {
    // ekran kaydırılmışsa html içeriğini döndür
    body,
    headers: resp.headers(),
    status: resp.status(),
    statusText: resp.statusText(),
    finalUrl: page.url(),
  };
}
