/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserManager } from './browserManager.js';
import { BrowserTools } from './browserTools.js';
import type { Config } from '../../config/config.js';

// Mock content parts for tool results
const mockMcpClient = {
  getStatus: vi.fn(),
  connect: vi.fn(),
  callTool: vi.fn(),
  notification: vi.fn(),
};

// Mock Playwright
const mockPage = {
  goto: vi.fn(),
  click: vi.fn(),
  fill: vi.fn(),
  evaluate: vi.fn(),
  textContent: vi.fn(),
  viewportSize: vi.fn().mockReturnValue({ width: 1024, height: 768 }),
  mouse: {
    click: vi.fn(),
    move: vi.fn(),
    down: vi.fn(),
    up: vi.fn(),
  },
  keyboard: {
    type: vi.fn(),
    press: vi.fn(),
  },
  isConnected: vi.fn().mockReturnValue(true),
};

const mockContext = {
  newPage: vi.fn().mockResolvedValue(mockPage),
  close: vi.fn(),
};

const mockBrowser = {
  newContext: vi.fn().mockResolvedValue(mockContext),
  isConnected: vi.fn().mockReturnValue(true),
  close: vi.fn(),
};

// We need to mock the imports in BrowserManager
vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn(),
  },
}));
import { chromium } from 'playwright';

describe('Hybrid Browser Agent Integration', () => {
  let browserManager: BrowserManager;
  let browserTools: BrowserTools;
  let config: Config;

  // Tests for Playwright operations (no existing MCP client)
  describe('Playwright operations (fresh launch)', () => {
    beforeEach(() => {
      vi.clearAllMocks();

      // Setup Config mock with NO existing MCP client initially
      const mockMcpManager = {
        getClient: vi.fn().mockReturnValue(null), // No existing client
        maybeDiscoverMcpServer: vi.fn().mockResolvedValue(undefined),
      };

      // Restore mock implementations if they were reset
      mockBrowser.newContext.mockResolvedValue(mockContext);
      mockContext.newPage.mockResolvedValue(mockPage);
      mockPage.isConnected.mockReturnValue(true);
      mockBrowser.isConnected.mockReturnValue(true);
      mockPage.viewportSize.mockReturnValue({ width: 1024, height: 768 });

      config = {
        browserAgentSettings: {
          enabled: true,
          executionMode: 'launch',
          headless: true,
        },
        getMcpClientManager: vi.fn().mockReturnValue(mockMcpManager),
      } as unknown as Config;

      // Setup BrowserManager
      browserManager = new BrowserManager(config);

      // After maybeDiscoverMcpServer, the client becomes available
      mockMcpManager.getClient.mockReturnValue(mockMcpClient);

      // For this test, we simulating the launch sequence.
      (
        chromium.launch as unknown as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockBrowser);
      mockMcpClient.getStatus.mockReturnValue('connected');

      browserTools = new BrowserTools(browserManager);
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it('should use Playwright for visual coordinate interactions (Visual)', async () => {
      // clickAt uses native Playwright page.mouse.click
      // Coordinates are ALWAYS scaled from 0-1000 range to viewport dimensions.
      // Viewport is mocked as 1024x768.
      // x=100 -> (100/1000)*1024 = 102.4
      // y=200 -> (200/1000)*768 = 153.6
      const x = 100;
      const y = 200;
      await browserTools.clickAt(x, y);

      expect(mockPage.mouse.click).toHaveBeenCalledWith(
        102.4,
        153.60000000000002,
      );
    });
  });

  // Tests for MCP reuse (existing connected client)
  describe('MCP client reuse', () => {
    beforeEach(() => {
      vi.clearAllMocks();

      // Setup Config mock WITH existing connected MCP client
      const mockMcpManager = {
        getClient: vi.fn().mockReturnValue(mockMcpClient),
        maybeDiscoverMcpServer: vi.fn(),
      };

      mockMcpClient.getStatus.mockReturnValue('connected');
      mockMcpClient.callTool.mockResolvedValue({
        content: [{ type: 'text', text: 'Snapshot Data' }],
      });

      config = {
        browserAgentSettings: {
          enabled: true,
          executionMode: 'launch',
          headless: true,
        },
        getMcpClientManager: vi.fn().mockReturnValue(mockMcpManager),
      } as unknown as Config;

      browserManager = new BrowserManager(config);
      browserTools = new BrowserTools(browserManager);
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it('should use MCP for inspection (Snapshot)', async () => {
      await browserTools.takeSnapshot();

      expect(mockMcpClient.callTool).toHaveBeenCalledWith(
        'take_snapshot',
        expect.anything(),
      );
    });

    it('should reuse existing MCP client and skip Playwright launch', async () => {
      // When there's an existing connected MCP client, we should reuse it
      // and NOT launch a new browser via Playwright
      await browserTools.takeSnapshot();

      // We reuse the existing MCP client - chromium.launch should NOT be called
      expect(chromium.launch).not.toHaveBeenCalled();
      expect(config.getMcpClientManager).toHaveBeenCalled();
    });
  });
});
