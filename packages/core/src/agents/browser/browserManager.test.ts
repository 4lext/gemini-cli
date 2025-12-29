/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserManager } from './browserManager.js';
import type { Config } from '../../config/config.js';
import type { McpClientManager } from '../../tools/mcp-client-manager.js';
import type { McpClient } from '../../tools/mcp-client.js';

// Mock child_process for dataValidation
vi.mock('node:child_process', () => ({
  spawn: vi.fn().mockReturnValue({
    on: vi.fn((event, cb) => {
      if (event === 'close') cb(0); // Default success
      return { on: vi.fn() };
    }),
  }),
}));

// Mock Playwright to avoid real browser launch
const { mockBrowser } = vi.hoisted(() => {
  const mockPage = { close: vi.fn() };
  const mockContext = { newPage: vi.fn().mockResolvedValue(mockPage) };
  const browser = {
    newContext: vi.fn().mockResolvedValue(mockContext),
    isConnected: vi.fn().mockReturnValue(true),
    close: vi.fn(),
  };
  return { mockBrowser: browser };
});

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue(mockBrowser),
  },
}));

// Mock net utils for deterministic port
vi.mock('../../utils/net.js', () => ({
  getFreePort: vi.fn().mockResolvedValue(1234),
}));

describe('BrowserManager', () => {
  let browserManager: BrowserManager;
  let mockConfig: Config;
  let mockMcpManager: McpClientManager;
  let mockMcpClient: McpClient;

  beforeEach(() => {
    // Mock Config and Manager
    mockMcpClient = {
      getStatus: vi.fn().mockReturnValue('disconnected'),
      connect: vi.fn().mockResolvedValue(undefined),
    } as unknown as McpClient;

    mockMcpManager = {
      getClient: vi.fn().mockReturnValue(mockMcpClient),
      maybeDiscoverMcpServer: vi.fn().mockResolvedValue(undefined),
    } as unknown as McpClientManager;

    mockConfig = {
      getMcpClientManager: vi.fn().mockReturnValue(mockMcpManager),
      browserAgentSettings: {
        executionMode: 'launch',
        headless: true, // Now this doesn't matter as much since we mock, but good to keep
      },
    } as unknown as Config;

    browserManager = new BrowserManager(mockConfig);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should ensure connection by getting client from manager', async () => {
    await browserManager.ensureConnection();

    expect(mockConfig.getMcpClientManager).toHaveBeenCalled();
    expect(mockMcpManager.getClient).toHaveBeenCalledWith('chrome-devtools');
    expect(mockMcpClient.connect).toHaveBeenCalled();
  });

  it('should return existing client if connected', async () => {
    const connectedClient = {
      ...mockMcpClient,
      getStatus: () => 'connected',
    } as unknown as McpClient;
    vi.spyOn(mockMcpManager, 'getClient').mockReturnValue(connectedClient);

    // First call to set cached client
    await browserManager.getMcpClient();

    // Second call should reuse
    const client = await browserManager.getMcpClient();
    expect(client).toBe(connectedClient);
  });

  it('should register server if not found with correct port', async () => {
    // getClient is called 3 times before maybeDiscoverMcpServer:
    // 1. getMcpClient() - first check for existing connected client
    // 2. ensureConnection() - check for existing connected client
    // 3. connectMcp() - check for client to register
    // After registration, getClient returns the connected client
    vi.spyOn(mockMcpManager, 'getClient')
      .mockReturnValueOnce(undefined) // getMcpClient check
      .mockReturnValueOnce(undefined) // ensureConnection check
      .mockReturnValueOnce(undefined) // connectMcp check - triggers registration
      .mockReturnValue(mockMcpClient); // after registration

    await browserManager.getMcpClient();

    // Verify it used the browser-url with port 1234 from our mock
    expect(mockMcpManager.maybeDiscoverMcpServer).toHaveBeenCalledWith(
      'chrome-devtools',
      {
        command: 'npx',
        args: [
          '-y',
          'chrome-devtools-mcp@latest',
          '--browser-url',
          'http://127.0.0.1:1234',
        ],
      },
    );
  });
});
