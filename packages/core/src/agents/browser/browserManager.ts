/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { debugLogger } from '../../utils/debugLogger.js';
import type { Config } from '../../config/config.js';
import type { McpClient } from '../../tools/mcp-client.js';
import { chromium, type Browser, type Page } from 'playwright';

import { getFreePort } from '../../utils/net.js';

export class BrowserManager {
  private mcpClient: McpClient | undefined;
  private browser: Browser | undefined;
  private page: Page | undefined;
  private remoteDebuggingPort: number | undefined;

  constructor(private config: Config) {}

  async getMcpClient(): Promise<McpClient> {
    // Always ensure our own dedicated browser connection
    if (this.mcpClient && this.mcpClient.getStatus() === 'connected') {
      return this.mcpClient;
    }
    await this.ensureConnection();
    if (!this.mcpClient) {
      throw new Error('Failed to initialize chrome-devtools MCP client');
    }
    return this.mcpClient;
  }

  async getPage(): Promise<Page> {
    // Always ensure we have a Playwright page for visual operations
    if (!this.page) {
      await this.ensureBrowserLaunched();
    }
    if (!this.page) {
      throw new Error('Browser page not available');
    }
    return this.page;
  }

  async ensureConnection() {
    // Always launch our own browser and connect MCP to it
    await this.ensureBrowserLaunched();
  }

  private async ensureBrowserLaunched() {
    // Get a free port if we haven't already
    if (!this.remoteDebuggingPort) {
      this.remoteDebuggingPort = await getFreePort();
    }
    const port = this.remoteDebuggingPort;

    // Launch Browser via Playwright (if not running)
    if (!this.browser || !this.browser.isConnected()) {
      await this.launchBrowser(port);
    }

    // Connect MCP Client (if not connected)
    if (!this.mcpClient || this.mcpClient.getStatus() !== 'connected') {
      await this.connectMcp(port);
    }
  }

  private async launchBrowser(port: number) {
    debugLogger.log('Launching Chrome via Playwright...');
    const settings = this.config.browserAgentSettings;
    const headless = settings?.headless ?? false;

    // Launch with remote debugging for MCP to attach
    // Use fixed 1024x1024 window to provide consistent viewport
    this.browser = await chromium.launch({
      headless,
      args: [`--remote-debugging-port=${port}`, '--window-size=1024,1024'],
    });

    const context = await this.browser.newContext({
      viewport: null, // Let window size dictate viewport. Explicit viewport causes "Viewport not available" on resize.
    });
    this.page = await context.newPage();

    debugLogger.log(`Browser launched successfully on port ${port}.`);
  }

  private async connectMcp(port: number) {
    const mcpManager = this.config.getMcpClientManager();
    if (!mcpManager) {
      throw new Error('MCP Client Manager not available in config');
    }

    // Use unique client name based on port to avoid conflicts
    // Each browser agent instance gets its own MCP client
    const clientName = `chrome-devtools-${port}`;
    let client = mcpManager.getClient(clientName);

    if (!client) {
      debugLogger.log(
        `Registering chrome-devtools-mcp server (${clientName}) dynamically...`,
      );

      // Use --browser-url to connect to the Playwright-launched browser
      // instead of launching a new one
      const browserUrl = `http://127.0.0.1:${port}`;
      const args = [
        '-y',
        'chrome-devtools-mcp@latest',
        '--browser-url',
        browserUrl,
      ];

      await mcpManager.maybeDiscoverMcpServer(clientName, {
        command: 'npx',
        args,
      });

      client = mcpManager.getClient(clientName);
    }

    if (!client) {
      throw new Error('Failed to initialize chrome-devtools MCP client');
    }

    if (client.getStatus() !== 'connected') {
      await client.connect();
    }

    this.mcpClient = client;
  }
}
