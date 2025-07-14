# WireGuard VPN Integration Demo

This document demonstrates the WireGuard VPN integration features added to the pptr-scraper.

## Overview

The scraper now automatically handles rate limiting (429 responses) and captcha challenges by connecting to a VPN through WireGuard and retrying the request. It also provides comprehensive management endpoints for VPN configurations.

## Features

### 1. Automatic VPN Retry Logic

When scraping encounters a 429 response or captcha challenge:
1. The system automatically selects the best available VPN server
2. Connects to the VPN using WireGuard
3. Retries the scraping request
4. Adds VPN usage information to response headers

### 2. VPN Location Selection

You can specify a VPN location using the `vpnLocation` query parameter:

```bash
curl "http://localhost:7000/scrape?url=https://example.com&vpnLocation=de"
```

### 3. Response Headers

When VPN is used, the following headers are added:
- `pptr-scraper-vpn-used: true`
- `pptr-scraper-vpn-name: Berlin Germany`
- `pptr-scraper-vpn-location: de`
- `pptr-scraper-vpn-endpoint: berlin.de.wg.nordhold.net:51820`

### 4. Management Endpoints

#### List Available VPN Servers
```bash
curl http://localhost:7000/vpn/servers
```

#### Get Health Status
```bash
curl http://localhost:7000/vpn/health
```

#### Get Active VPN
```bash
curl http://localhost:7000/vpn/active
```

#### Register New VPN Configuration
```bash
curl -X POST http://localhost:7000/vpn/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "New Server",
    "location": "us",
    "config": "[Interface]\nAddress = 10.5.0.2/16\nPrivateKey = ...\n\n[Peer]\nAllowedIPs = 0.0.0.0/0\nEndpoint = ...\nPublicKey = ..."
  }'
```

#### Register Multiple VPN Configurations
```bash
curl -X POST http://localhost:7000/vpn/register/bulk \
  -H "Content-Type: application/json" \
  -d '{
    "configs": [
      {
        "name": "Server 1",
        "location": "us",
        "config": "..."
      },
      {
        "name": "Server 2", 
        "location": "uk",
        "config": "..."
      }
    ]
  }'
```

#### Register from File Upload
```bash
curl -X POST "http://localhost:7000/vpn/register/file?name=MyServer&location=us" \
  -H "Content-Type: text/plain" \
  --data-binary @my-config.conf
```

#### Connect to Specific VPN
```bash
curl -X POST http://localhost:7000/vpn/connect/berlin-de
```

#### Disconnect from VPN
```bash
curl -X POST http://localhost:7000/vpn/disconnect
```

#### Remove VPN Configuration
```bash
curl -X DELETE http://localhost:7000/vpn/servers/server-id
```

## Pre-configured VPN Servers

The system comes with 4 pre-configured VPN servers:
- Istanbul Turkey (tr)
- Berlin Germany (de) 
- Brussels Belgium (be)
- Dubai UAE (ae)

## Health Monitoring

The system automatically monitors VPN server health every 5 minutes. Healthy servers are preferred for automatic VPN selection.

## Configuration Validation

All VPN configurations are validated to ensure they contain required WireGuard sections:
- `[Interface]` section with PrivateKey
- `[Peer]` section with PublicKey and Endpoint

## Example Usage

### Basic Scraping (No VPN)
```bash
curl "http://localhost:7000/scrape?url=https://example.com"
```

### Scraping with Specific VPN Location
```bash
curl "http://localhost:7000/scrape?url=https://example.com&vpnLocation=de"
```

### Scraping with VPN Auto-Selection on 429
The system automatically handles this - no additional configuration needed. When a 429 response is received, it will:
1. Connect to the best available VPN
2. Retry the request
3. Add VPN information to response headers

## Security Notes

- VPN configurations contain sensitive private keys
- The system requires appropriate permissions to use `wg-quick` commands
- In development environments without WireGuard tools, the system simulates VPN connections

## Error Handling

The system gracefully handles:
- Invalid VPN configurations
- VPN connection failures
- Health check failures
- Missing WireGuard tools (development mode)

## Extensibility

The system follows the open-closed principle:
- New VPN providers can be added without modifying existing code
- Health check mechanisms can be enhanced
- Configuration validation can be extended
- Management endpoints can be expanded