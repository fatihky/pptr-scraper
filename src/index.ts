import 'dotenv/config';

import express from 'express';
import nodeCleanup from 'node-cleanup';
import type { Server } from 'node:http';
import { gzipSync } from 'node:zlib';
import type { Page } from 'puppeteer';
import { z } from 'zod';
import { getBrowser, launchBrowser, pool } from './pool';
import { type ScrapeResult, scrape } from './scrape';
import { wireGuardManager } from './wireguard';
import expressAsyncHandler from 'express-async-handler';

const app = express();
const port = Number(process.env.PORT ?? '7000');

// Enable JSON body parsing for POST requests
app.use(express.json());
app.use(express.text({ type: 'text/plain' }));

let server: Server | null = null;

const scrapeQuerySchema = z.object({
  url: z.string().url(),
  infiniteScroll: z.coerce.boolean(),
  screenshot: z.coerce.boolean(),
  waitForNetwork: z.coerce.boolean(),
  maxScrolls: z.coerce.number().int().min(1).optional(),
  noBrowser: z.coerce.boolean().default(false),
  vpnLocation: z.string().optional(),
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
      vpnLocation,
    } = result.data;

    console.log('Tara:', url, {
      infiniteScroll,
      maxScrolls,
      noBrowser,
      screenshot,
      waitForNetwork,
      vpnLocation,
    });

    if (typeof url !== 'string') {
      res
        .status(400)
        .json({ error: 'url parametresi zorunludur ve tek url verilmelidir.' });
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
          vpnLocation,
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
        .set('pptr-scraper-vpn-used', resp.vpnUsed ? 'true' : 'false')
        .set(mappedHeaders);

      // Add VPN info to headers if used
      if (resp.vpnUsed) {
        res.set('pptr-scraper-vpn-name', resp.vpnUsed.name);
        res.set('pptr-scraper-vpn-location', resp.vpnUsed.location);
        res.set('pptr-scraper-vpn-endpoint', resp.vpnUsed.endpoint);
      }

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

// WireGuard VPN Management Endpoints

// Get all available WireGuard servers
app.get('/vpn/servers', (req, res) => {
  const servers = wireGuardManager.getAllConfigs();
  res.json(servers);
});

// Get health status of all WireGuard servers
app.get('/vpn/health', (req, res) => {
  const health = wireGuardManager.getHealthStatus();
  res.json(health);
});

// Get currently active VPN configuration
app.get('/vpn/active', (req, res) => {
  const active = wireGuardManager.getActiveConfig();
  res.json(active);
});

// Register a new WireGuard configuration
app.post('/vpn/register', expressAsyncHandler(async (req, res) => {
  try {
    const { name, location, config } = req.body;
    
    if (!name || !location || !config) {
      res.status(400).json({ 
        error: 'name, location, and config are required fields' 
      });
      return;
    }

    const configId = wireGuardManager.addConfig({ name, location, config });
    res.json({ 
      success: true, 
      configId,
      message: `WireGuard configuration "${name}" registered successfully` 
    });
  } catch (error) {
    res.status(400).json({ 
      error: error instanceof Error ? error.message : 'Failed to register configuration' 
    });
  }
}));

// Register multiple WireGuard configurations
app.post('/vpn/register/bulk', expressAsyncHandler(async (req, res) => {
  try {
    const { configs } = req.body;
    
    if (!Array.isArray(configs)) {
      res.status(400).json({ 
        error: 'configs must be an array of configuration objects' 
      });
      return;
    }

    const results = [];
    const errors = [];

    for (let i = 0; i < configs.length; i++) {
      const config = configs[i];
      const index = i;
      
      try {
        const { name, location, config: configText } = config;
        
        if (!name || !location || !configText) {
          errors.push({
            index,
            error: 'name, location, and config are required fields'
          });
          continue;
        }

        const configId = wireGuardManager.addConfig({ 
          name, 
          location, 
          config: configText 
        });
        
        results.push({ 
          index,
          success: true, 
          configId,
          name 
        });
      } catch (error) {
        errors.push({
          index,
          error: error instanceof Error ? error.message : 'Failed to register configuration'
        });
      }
    }

    res.json({ 
      results,
      errors,
      summary: {
        total: configs.length,
        successful: results.length,
        failed: errors.length
      }
    });
  } catch (error) {
    res.status(400).json({ 
      error: error instanceof Error ? error.message : 'Failed to process bulk registration' 
    });
  }
}));

// Register WireGuard configuration from file upload (plain text)
app.post('/vpn/register/file', expressAsyncHandler(async (req, res) => {
  try {
    const { name, location } = req.query;
    const config = req.body;
    
    if (!name || !location) {
      res.status(400).json({ 
        error: 'name and location query parameters are required' 
      });
      return;
    }

    if (typeof config !== 'string') {
      res.status(400).json({ 
        error: 'Request body must be plain text WireGuard configuration' 
      });
      return;
    }

    const configId = wireGuardManager.addConfig({ 
      name: name as string, 
      location: location as string, 
      config 
    });
    
    res.json({ 
      success: true, 
      configId,
      message: `WireGuard configuration "${name}" registered successfully from file` 
    });
  } catch (error) {
    res.status(400).json({ 
      error: error instanceof Error ? error.message : 'Failed to register configuration from file' 
    });
  }
}));

// Manually connect to a specific VPN
app.post('/vpn/connect/:configId', expressAsyncHandler(async (req, res) => {
  try {
    const { configId } = req.params;
    const success = await wireGuardManager.connectToVPN(configId);
    
    if (success) {
      const config = wireGuardManager.getActiveConfig();
      res.json({ 
        success: true, 
        message: `Connected to VPN: ${config?.name}`,
        activeConfig: config 
      });
    } else {
      res.status(500).json({ 
        error: 'Failed to connect to VPN' 
      });
    }
  } catch (error) {
    res.status(400).json({ 
      error: error instanceof Error ? error.message : 'Failed to connect to VPN' 
    });
  }
}));

// Disconnect from VPN
app.post('/vpn/disconnect', expressAsyncHandler(async (req, res) => {
  try {
    await wireGuardManager.disconnectVPN();
    res.json({ 
      success: true, 
      message: 'Disconnected from VPN' 
    });
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to disconnect from VPN' 
    });
  }
}));

// Remove a WireGuard configuration
app.delete('/vpn/servers/:configId', expressAsyncHandler(async (req, res) => {
  try {
    const { configId } = req.params;
    const success = wireGuardManager.removeConfig(configId);
    
    if (success) {
      res.json({ 
        success: true, 
        message: 'WireGuard configuration removed successfully' 
      });
    } else {
      res.status(404).json({ 
        error: 'Configuration not found' 
      });
    }
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to remove configuration' 
    });
  }
}));

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

  // Clean up WireGuard manager
  wireGuardManager.destroy();

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
