/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BrowserTools } from './browserTools.js';
import type { BrowserManager } from './browserManager.js';
import type { McpClient } from '../../tools/mcp-client.js';

describe('BrowserTools', () => {
  let browserTools: BrowserTools;
  let mockBrowserManager: BrowserManager;
  let mockMcpClient: McpClient;
  let mockPage: {
    goto: ReturnType<typeof vi.fn>;
    click: ReturnType<typeof vi.fn>;
    fill: ReturnType<typeof vi.fn>;
    evaluate: ReturnType<typeof vi.fn>;
    viewportSize: ReturnType<typeof vi.fn>;
    mouse: {
      click: ReturnType<typeof vi.fn>;
      move: ReturnType<typeof vi.fn>;
      down: ReturnType<typeof vi.fn>;
      up: ReturnType<typeof vi.fn>;
      wheel: ReturnType<typeof vi.fn>;
    };
    keyboard: {
      type: ReturnType<typeof vi.fn>;
      press: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    mockPage = {
      goto: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
      fill: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(undefined),
      viewportSize: vi.fn().mockReturnValue({ width: 1024, height: 768 }),
      mouse: {
        click: vi.fn().mockResolvedValue(undefined),
        move: vi.fn().mockResolvedValue(undefined),
        down: vi.fn().mockResolvedValue(undefined),
        up: vi.fn().mockResolvedValue(undefined),
        wheel: vi.fn().mockResolvedValue(undefined),
      },
      keyboard: {
        type: vi.fn().mockResolvedValue(undefined),
        press: vi.fn().mockResolvedValue(undefined),
      },
    };

    mockMcpClient = {
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
      }),
    } as unknown as McpClient;

    mockBrowserManager = {
      getMcpClient: vi.fn().mockResolvedValue(mockMcpClient),
      getPage: vi.fn().mockResolvedValue(mockPage),
    } as unknown as BrowserManager;

    browserTools = new BrowserTools(mockBrowserManager);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('clickAt should scale coordinates and use page.mouse.click', async () => {
    // Viewport is 1024x768, x=500 -> (500/1000)*1024 = 512, y=500 -> (500/1000)*768 = 384
    const result = await browserTools.clickAt(500, 500);

    expect(mockPage.mouse.click).toHaveBeenCalledWith(512, 384);
    expect(result.output).toContain('Clicked at 500, 500');
  });

  it('typeTextAt should click then type', async () => {
    // x=500, y=500 -> scaled as above
    await browserTools.typeTextAt(500, 500, 'hello', false, false);

    // Click should be called for focus
    expect(mockPage.mouse.click).toHaveBeenCalled();
    // Then type
    expect(mockPage.keyboard.type).toHaveBeenCalledWith('hello');
  });

  it('scrollDocument should call page.mouse.wheel', async () => {
    // Mock viewport for centering
    mockPage.viewportSize.mockReturnValue({ width: 1000, height: 1000 });

    const result = await browserTools.scrollDocument('down', 100);

    // Should move to center
    expect(mockPage.mouse.move).toHaveBeenCalledWith(500, 500);
    // Should scroll
    expect(mockPage.mouse.wheel).toHaveBeenCalledWith(0, 100);
    expect(result).toEqual({ output: 'Scrolled down by 100' });
  });

  it('dragAndDrop should scale coordinates and use mouse methods', async () => {
    // x=100, y=100 -> (100/1000)*1024 = 102.4, (100/1000)*768 = 76.8
    // destX=900, destY=900 -> (900/1000)*1024 = 921.6, (900/1000)*768 = 691.2
    await browserTools.dragAndDrop(100, 100, 900, 900);

    expect(mockPage.mouse.move).toHaveBeenNthCalledWith(
      1,
      expect.closeTo(102.4, 1),
      expect.closeTo(76.8, 1),
    );
    expect(mockPage.mouse.down).toHaveBeenCalled();
    expect(mockPage.mouse.move).toHaveBeenNthCalledWith(
      2,
      expect.closeTo(921.6, 1),
      expect.closeTo(691.2, 1),
      { steps: 5 },
    );
    expect(mockPage.mouse.up).toHaveBeenCalled();
  });

  it('evaluateScript should wrap script in function and execute', async () => {
    mockPage.evaluate.mockResolvedValue('test result');
    const result = await browserTools.evaluateScript('document.title');

    expect(mockPage.evaluate).toHaveBeenCalledWith(
      expect.stringContaining('document.title'),
    );
    expect(result.output).toBe('test result');
  });
});
