import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export interface WireGuardConfig {
  id: string;
  name: string;
  location: string;
  endpoint: string;
  config: string;
  isActive: boolean;
  isHealthy: boolean;
  lastHealthCheck?: Date;
}

export interface WireGuardHealth {
  id: string;
  name: string;
  location: string;
  endpoint: string;
  isHealthy: boolean;
  responseTime?: number;
  error?: string;
  lastCheck: Date;
}

const wireGuardConfigSchema = z.object({
  name: z.string().min(1),
  location: z.string().min(1),
  config: z.string().min(1),
});

class WireGuardManager {
  private configs: Map<string, WireGuardConfig> = new Map();
  private activeConfigId: string | null = null;
  private configDir: string;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.configDir = join(process.cwd(), 'wireguard-configs');
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
    }
    this.initializeDefaultConfigs();
    this.startHealthChecking();
  }

  private initializeDefaultConfigs() {
    const defaultConfigs = [
      {
        id: 'istanbul-tr',
        name: 'Istanbul Turkey',
        location: 'tr',
        endpoint: 'istanbul.tr.wg.nordhold.net:51820',
        config: `[Interface]
Address = 10.5.0.2/16
PrivateKey = A/Jb/H+TepfRmSxqlx5Y13kxP22Lpv3XNfOzwGhZVmE=
DNS = 103.86.96.100
MTU = 1350

[Peer]
AllowedIPs = 0.0.0.0/0
Endpoint = istanbul.tr.wg.nordhold.net:51820
PersistentKeepalive = 25
PublicKey = mlY5bcC+NtXxHYpDSANkiQABeYwAAB4lMwgNhAbE4BI=`,
        isActive: false,
        isHealthy: false,
      },
      {
        id: 'berlin-de',
        name: 'Berlin Germany',
        location: 'de',
        endpoint: 'berlin.de.wg.nordhold.net:51820',
        config: `[Interface]
Address = 10.5.0.2/16
PrivateKey = A/Jb/H+TepfRmSxqlx5Y13kxP22Lpv3XNfOzwGhZVmE=
DNS = 103.86.96.100
MTU = 1350

[Peer]
AllowedIPs = 0.0.0.0/0
Endpoint = berlin.de.wg.nordhold.net:51820
PersistentKeepalive = 25
PublicKey = 3ZNjosvvIqfvu3/BqaLzNNXs9zWO4jXpcXNOmDMDpX0=`,
        isActive: false,
        isHealthy: false,
      },
      {
        id: 'brussels-be',
        name: 'Brussels Belgium',
        location: 'be',
        endpoint: 'brussels.be.wg.nordhold.net:51820',
        config: `[Interface]
Address = 10.5.0.2/16
PrivateKey = A/Jb/H+TepfRmSxqlx5Y13kxP22Lpv3XNfOzwGhZVmE=
DNS = 103.86.96.100
MTU = 1350

[Peer]
AllowedIPs = 0.0.0.0/0
Endpoint = brussels.be.wg.nordhold.net:51820
PersistentKeepalive = 25
PublicKey = VSa6XYcD279ahd3IuEiUH6VpXn0+h+kWrD4OcN1ExUs=`,
        isActive: false,
        isHealthy: false,
      },
      {
        id: 'dubai-ae',
        name: 'Dubai UAE',
        location: 'ae',
        endpoint: 'dubai.ae.wg.nordhold.net:51820',
        config: `[Interface]
Address = 10.5.0.2/16
PrivateKey = A/Jb/H+TepfRmSxqlx5Y13kxP22Lpv3XNfOzwGhZVmE=
DNS = 103.86.96.100
MTU = 1350

[Peer]
AllowedIPs = 0.0.0.0/0
Endpoint = dubai.ae.wg.nordhold.net:51820
PersistentKeepalive = 25
PublicKey = 8YHJW3c2We+C3+Ym7NPVPa3rzuZgx825okEa7+fzHSE=`,
        isActive: false,
        isHealthy: false,
      },
    ];

    for (const config of defaultConfigs) {
      this.configs.set(config.id, config);
    }
  }

  private startHealthChecking() {
    // Check health every 5 minutes
    this.healthCheckInterval = setInterval(() => {
      this.checkAllHealth();
    }, 5 * 60 * 1000);

    // Initial health check
    this.checkAllHealth();
  }

  private async checkAllHealth() {
    const configIds = Array.from(this.configs.keys());
    for (const configId of configIds) {
      await this.checkHealth(configId);
    }
  }

  private async checkHealth(configId: string): Promise<void> {
    const config = this.configs.get(configId);
    if (!config) return;

    const startTime = Date.now();
    try {
      // Simple endpoint connectivity check
      const hostname = config.endpoint.split(':')[0];
      const port = config.endpoint.split(':')[1] || '80';
      
      // Use a simple HTTP request to check connectivity
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`http://${hostname}:${port}`, {
        method: 'HEAD',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      const responseTime = Date.now() - startTime;
      config.isHealthy = response.ok || response.status < 500;
      config.lastHealthCheck = new Date();
      
      console.log(`Health check for ${config.name}: ${config.isHealthy ? 'OK' : 'FAILED'} (${responseTime}ms)`);
    } catch (error) {
      config.isHealthy = false;
      config.lastHealthCheck = new Date();
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.log(`Health check for ${config.name}: FAILED (${errorMessage})`);
    }
  }

  public async connectToVPN(configId: string): Promise<boolean> {
    const config = this.configs.get(configId);
    if (!config) {
      throw new Error(`WireGuard config with ID "${configId}" not found`);
    }

    try {
      // First disconnect any active VPN
      await this.disconnectVPN();

      // Write config to temporary file
      const configPath = join(this.configDir, `${configId}.conf`);
      writeFileSync(configPath, config.config);

      // Check if WireGuard tools are available
      try {
        execSync('which wg-quick', { stdio: 'pipe' });
      } catch {
        console.warn('WireGuard tools not available. Simulating VPN connection for development.');
        config.isActive = true;
        this.activeConfigId = configId;
        return true;
      }

      // Connect using wg-quick (requires root/sudo)
      execSync(`wg-quick up ${configPath}`, { stdio: 'inherit' });

      config.isActive = true;
      this.activeConfigId = configId;

      console.log(`Connected to WireGuard VPN: ${config.name}`);
      return true;
    } catch (error) {
      console.error(`Failed to connect to WireGuard VPN ${config.name}:`, error);
      return false;
    }
  }

  public async disconnectVPN(): Promise<void> {
    if (!this.activeConfigId) return;

    const config = this.configs.get(this.activeConfigId);
    if (!config) return;

    try {
      // Check if WireGuard tools are available
      try {
        execSync('which wg-quick', { stdio: 'pipe' });
      } catch {
        console.warn('WireGuard tools not available. Simulating VPN disconnection for development.');
        config.isActive = false;
        this.activeConfigId = null;
        return;
      }

      const configPath = join(this.configDir, `${this.activeConfigId}.conf`);
      execSync(`wg-quick down ${configPath}`, { stdio: 'inherit' });
      
      config.isActive = false;
      this.activeConfigId = null;
      
      console.log(`Disconnected from WireGuard VPN: ${config.name}`);
    } catch (error) {
      console.error('Failed to disconnect from WireGuard VPN:', error);
    }
  }

  public getActiveConfig(): WireGuardConfig | null {
    return this.activeConfigId ? this.configs.get(this.activeConfigId) || null : null;
  }

  public getAllConfigs(): WireGuardConfig[] {
    return Array.from(this.configs.values());
  }

  public getConfigsByLocation(location: string): WireGuardConfig[] {
    return Array.from(this.configs.values()).filter(config => config.location === location);
  }

  public getHealthStatus(): WireGuardHealth[] {
    return Array.from(this.configs.values()).map(config => ({
      id: config.id,
      name: config.name,
      location: config.location,
      endpoint: config.endpoint,
      isHealthy: config.isHealthy,
      lastCheck: config.lastHealthCheck || new Date(),
    }));
  }

  public validateConfig(configText: string): boolean {
    try {
      // Basic validation - check for required sections
      const hasInterface = configText.includes('[Interface]');
      const hasPeer = configText.includes('[Peer]');
      const hasPrivateKey = configText.includes('PrivateKey');
      const hasPublicKey = configText.includes('PublicKey');
      const hasEndpoint = configText.includes('Endpoint');
      
      return hasInterface && hasPeer && hasPrivateKey && hasPublicKey && hasEndpoint;
    } catch {
      return false;
    }
  }

  public addConfig(data: { name: string; location: string; config: string }): string {
    const result = wireGuardConfigSchema.safeParse(data);
    if (!result.success) {
      throw new Error(`Invalid WireGuard config: ${result.error.message}`);
    }

    if (!this.validateConfig(data.config)) {
      throw new Error('Invalid WireGuard configuration format');
    }

    // Extract endpoint from config
    const endpointMatch = data.config.match(/Endpoint\s*=\s*(.+)/);
    const endpoint = endpointMatch ? endpointMatch[1].trim() : 'unknown';

    const id = `${data.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
    const config: WireGuardConfig = {
      id,
      name: data.name,
      location: data.location,
      endpoint,
      config: data.config,
      isActive: false,
      isHealthy: false,
    };

    this.configs.set(id, config);
    
    // Check health immediately for new config
    this.checkHealth(id);
    
    console.log(`Added new WireGuard config: ${config.name}`);
    return id;
  }

  public removeConfig(configId: string): boolean {
    const config = this.configs.get(configId);
    if (!config) return false;

    // Disconnect if this config is active
    if (config.isActive) {
      this.disconnectVPN();
    }

    this.configs.delete(configId);
    console.log(`Removed WireGuard config: ${config.name}`);
    return true;
  }

  public selectBestConfig(location?: string): WireGuardConfig | null {
    let candidates = Array.from(this.configs.values());
    
    if (location) {
      candidates = candidates.filter(config => config.location === location);
    }

    // Filter healthy configs
    const healthyCandidates = candidates.filter(config => config.isHealthy);
    
    if (healthyCandidates.length === 0) {
      // If no healthy configs, try all configs
      candidates = candidates.length > 0 ? candidates : Array.from(this.configs.values());
    } else {
      candidates = healthyCandidates;
    }

    if (candidates.length === 0) return null;

    // Round-robin selection (simple implementation)
    const index = Math.floor(Math.random() * candidates.length);
    return candidates[index];
  }

  public async connectToBestVPN(location?: string): Promise<WireGuardConfig | null> {
    const config = this.selectBestConfig(location);
    if (!config) return null;

    const success = await this.connectToVPN(config.id);
    return success ? config : null;
  }

  public destroy() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    this.disconnectVPN();
  }
}

export const wireGuardManager = new WireGuardManager();

// Clean up on process exit
process.on('exit', () => {
  wireGuardManager.destroy();
});

process.on('SIGINT', () => {
  wireGuardManager.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  wireGuardManager.destroy();
  process.exit(0);
});