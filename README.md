# pptr-scraper

A powerful web scraping service built with Puppeteer and Express.js, featuring automatic VPN integration through WireGuard for handling rate limits and captcha challenges.

## Features

- **Web Scraping**: Scrape websites with Puppeteer
- **VPN Integration**: Automatic WireGuard VPN connection on 429 responses and captcha challenges
- **Captcha Solving**: Integrated Cloudflare Turnstile solving
- **Health Monitoring**: Automatic VPN server health checking
- **Multiple VPN Locations**: Support for multiple VPN servers with location-based selection
- **Configuration Management**: Add, remove, and manage VPN configurations via API
- **Infinite Scroll**: Support for infinite scroll scraping
- **Screenshot Capture**: Optional screenshot capture
- **Pool Management**: Browser instance pooling for performance

## Quick Start

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Start the server
npm start
```

## VPN Integration

The scraper automatically handles rate limiting and captcha challenges by connecting to WireGuard VPN servers. When a 429 response or captcha challenge is detected:

1. System selects the best available VPN server
2. Connects to the VPN using WireGuard (no sudo required)
3. Retries the scraping request
4. Adds VPN usage information to response headers

### No Root/Sudo Required

The VPN integration uses userspace WireGuard implementations (wireguard-go) when available, eliminating the need for elevated privileges. The system gracefully falls back to simulation mode in development environments.

### VPN Management API

- `GET /vpn/servers` - List all VPN servers
- `GET /vpn/health` - Get server health status  
- `GET /vpn/active` - Get active VPN connection
- `POST /vpn/register` - Register new VPN configuration
- `POST /vpn/register/bulk` - Register multiple configurations
- `POST /vpn/register/file` - Register from file upload
- `POST /vpn/connect/:id` - Connect to specific VPN
- `POST /vpn/disconnect` - Disconnect from VPN
- `DELETE /vpn/servers/:id` - Remove VPN configuration

For detailed VPN integration documentation, see [WIREGUARD_INTEGRATION.md](WIREGUARD_INTEGRATION.md).

## Usage

### Basic Scraping
```bash
curl "http://localhost:7000/scrape?url=https://example.com"
```

### Scraping with VPN Location
```bash
curl "http://localhost:7000/scrape?url=https://example.com&vpnLocation=de"
```

### Response Headers

When VPN is used, these headers are added:
- `pptr-scraper-vpn-used: true`
- `pptr-scraper-vpn-name: Berlin Germany`
- `pptr-scraper-vpn-location: de`
- `pptr-scraper-vpn-endpoint: berlin.de.wg.nordhold.net:51820`

## Configuration

Environment variables:
- `PORT` - Server port (default: 7000)
- `HOST` - Server host (default: 127.0.0.1)
- `TWOCAPTCHA_API_KEY` - 2Captcha API key for captcha solving

## Deployment

pm2 ile şöyle çalıştırmak mümkün bu aracı:
`pm2 start --name pptr-scraper -x bash -- -c 'xvfb-run node dist/index.js'`

## Demo

Run the demo script to see VPN integration features:
```bash
node demo.js
```
