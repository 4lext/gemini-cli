/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserManager } from './browserManager.js';
import { debugLogger } from '../../utils/debugLogger.js';

export interface ToolResult {
  output?: string;
  error?: string;
  url?: string;
}

export class BrowserTools {
  constructor(private browserManager: BrowserManager) {}

  async showOverlay(message: string): Promise<void> {
    await this.browserManager.getMcpClient();
    // Interpolate the message directly into the script since MCP evaluate_script
    // doesn't support passing arbitrary primitive args.
    const safeMessage = JSON.stringify(message);
    const scriptWithMsg = `() => {
      const msg = ${safeMessage};
      let overlay = document.getElementById('gemini-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'gemini-overlay';
        overlay.style.position = 'fixed';
        overlay.style.bottom = '50px';
        overlay.style.left = '50%';
        overlay.style.transform = 'translateX(-50%)';
        overlay.style.background = 'rgba(32, 33, 36, 0.9)';
        overlay.style.color = 'white';
        overlay.style.padding = '12px 24px';
        overlay.style.zIndex = '2147483647';
        overlay.style.borderRadius = '24px';
        overlay.style.fontSize = '16px';
        overlay.style.fontFamily = 'Google Sans, Roboto, sans-serif';
        overlay.style.fontWeight = '500';
        overlay.style.pointerEvents = 'none';
        overlay.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
        overlay.style.transition = 'opacity 0.3s ease-in-out';
        document.body.appendChild(overlay);
      }
      overlay.innerText = msg;
    }`;

    const client = await this.browserManager.getMcpClient();
    try {
      await client.callTool('evaluate_script', { function: scriptWithMsg });
    } catch (err) {
      debugLogger.log(`Failed to show overlay: ${err}`);
    }
  }

  async updateBorderOverlay(options: {
    active: boolean;
    capturing: boolean;
  }): Promise<void> {
    const safeOptions = JSON.stringify(options);
    const script = `() => {
        const { active, capturing } = ${safeOptions};
        // 1. Inject CSS if not present
        if (!document.getElementById('gemini-border-style')) {
          const style = document.createElement('style');
          style.id = 'gemini-border-style';
          style.textContent = \`
            :root {
              --color-blue: rgb(0, 102, 255);
              --color-blue-glow: rgba(0, 102, 255, 0.9);
            }
            #preact-border-container {
              pointer-events: none;
              z-index: 2147483647;
              position: fixed;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
              border: 2px solid var(--color-blue);
              box-shadow: inset 0 0 10px 0px var(--color-blue-glow);
              opacity: 1;
              transition: opacity 300ms ease-in-out;
              box-sizing: border-box;
            }
            #preact-border-container.hidden {
              opacity: 0;
            }
            @keyframes breathe {
              0%, 100% {
                box-shadow: inset 0 0 20px 0px var(--color-blue-glow);
              }
              50% {
                box-shadow: inset 0 0 30px 10px var(--color-blue-glow);
              }
            }
            #preact-border-container.animate-breathing {
              animation: breathe 3s ease-in-out infinite;
            }
          \`;
          document.head.appendChild(style);
        }

        // 2. Manage Container
        let container = document.getElementById('preact-border-container');
        if (!container) {
          container = document.createElement('div');
          container.id = 'preact-border-container';
          document.body.appendChild(container);
        }

        // 3. Update State
        if (active) {
          container.classList.remove('hidden');
          if (!capturing) {
            container.classList.add('animate-breathing');
          } else {
            container.classList.remove('animate-breathing');
          }
        } else {
          container.classList.add('hidden');
          container.classList.remove('animate-breathing');
        }
    }`;
    const client = await this.browserManager.getMcpClient();
    try {
      await client.callTool('evaluate_script', { function: script });
    } catch (err) {
      debugLogger.log(`Failed to update border overlay: ${err}`);
    }
  }

  async removeOverlay(): Promise<void> {
    const script = `() => {
        const overlay = document.getElementById('gemini-overlay');
        if (overlay) {
          overlay.remove();
        }
    }`;
    const client = await this.browserManager.getMcpClient();
    try {
      await client.callTool('evaluate_script', { function: script });
    } catch (err) {
      debugLogger.log(`Failed to remove overlay: ${err}`);
    }
  }

  async clickAt(x: number, y: number): Promise<ToolResult> {
    await this.showOverlay(`Clicking at ${x}, ${y}`);
    const page = await this.browserManager.getPage();
    try {
      // Model sends coordinates in 0-1000 range, scale to viewport
      const viewport = page.viewportSize();
      if (!viewport) {
        return { error: 'Viewport not available' };
      }
      const actualX = (x / 1000) * viewport.width;
      const actualY = (y / 1000) * viewport.height;
      await page.mouse.click(actualX, actualY);
      return {
        output: `Clicked at ${x}, ${y} (scaled to ${actualX.toFixed(0)}, ${actualY.toFixed(0)})`,
      };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return { error: `Failed to click at ${x}, ${y}: ${message}` };
    }
  }

  async typeTextAt(
    x: number,
    y: number,
    text: string,
    pressEnter: boolean = false,
    clearBeforeTyping: boolean = false,
  ): Promise<ToolResult> {
    const page = await this.browserManager.getPage();
    try {
      // Click to focus
      await this.clickAt(x, y);

      // Clear if requested (naive approach: select all + backspace)
      if (clearBeforeTyping) {
        // MacOS: Meta+A, Windows/Linux: Control+A
        // Playwright handles 'Control' or 'Meta' depending on platform usually,
        // but we can just send both or check platform.
        // Safer: click 3 times to select line? Or Ctrl+A.
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
      }

      await page.keyboard.type(text);

      if (pressEnter) {
        await page.keyboard.press('Enter');
      }
      return { output: `Typed "${text}" at ${x}, ${y}` };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return { error: `Failed to type at ${x}, ${y}: ${message}` };
    }
  }

  async dragAndDrop(
    x: number,
    y: number,
    destX: number,
    destY: number,
  ): Promise<ToolResult> {
    const page = await this.browserManager.getPage();
    try {
      // Model sends coordinates in 0-1000 range, scale to viewport
      const viewport = page.viewportSize();
      if (!viewport) {
        return { error: 'Viewport not available' };
      }
      const actualX = (x / 1000) * viewport.width;
      const actualY = (y / 1000) * viewport.height;
      const actualDestX = (destX / 1000) * viewport.width;
      const actualDestY = (destY / 1000) * viewport.height;

      await page.mouse.move(actualX, actualY);
      await page.mouse.down();
      await page.mouse.move(actualDestX, actualDestY, { steps: 5 });
      await page.mouse.up();
      return { output: `Dragged from ${x},${y} to ${destX},${destY}` };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return { error: `Failed to drag: ${message}` };
    }
  }

  // Make sure we expose viewport size helper if needed by Agent
  async getViewportSize(): Promise<{ width: number; height: number } | null> {
    const page = await this.browserManager.getPage();
    return page.viewportSize();
  }

  async openWebBrowser(): Promise<ToolResult> {
    await this.browserManager.getMcpClient();
    return { output: 'Browser opened' };
  }

  async scrollDocument(
    direction: 'up' | 'down' | 'left' | 'right',
    amount: number,
  ): Promise<ToolResult> {
    const page = await this.browserManager.getPage();
    let x = 0;
    let y = 0;
    switch (direction) {
      case 'up':
        y = -amount;
        break;
      case 'down':
        y = amount;
        break;
      case 'left':
        x = -amount;
        break;
      case 'right':
        x = amount;
        break;
      default:
        break;
    }

    // Use mouse wheel to scroll, which works on scrollable containers (divs)
    // unlike window.scrollBy which only works on the main document.
    // Move mouse to center first to ensure we scroll the main content.
    const viewport = page.viewportSize();
    if (viewport) {
      await page.mouse.move(viewport.width / 2, viewport.height / 2);
    }
    await page.mouse.wheel(x, y);

    return { output: `Scrolled ${direction} by ${amount}` };
  }

  async pagedown(): Promise<ToolResult> {
    const page = await this.browserManager.getPage();
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    return { output: 'Paged down' };
  }

  async pageup(): Promise<ToolResult> {
    const page = await this.browserManager.getPage();
    await page.evaluate(() => window.scrollBy(0, -window.innerHeight));
    return { output: 'Paged up' };
  }

  async takeSnapshot(verbose: boolean = false): Promise<ToolResult> {
    const client = await this.browserManager.getMcpClient();
    const result = await client.callTool('take_snapshot', { verbose });

    // Handle standard MCP result content
    const content = result.content;
    let output = '';
    if (content && Array.isArray(content)) {
      output = content
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((item: any) => item.type === 'text')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((item: any) => item.text)
        .join('');
    }
    return { output };
  }

  async waitFor(text: string): Promise<ToolResult> {
    const client = await this.browserManager.getMcpClient();
    await client.callTool('wait_for', { text });
    return { output: `Waited for text "${text}"` };
  }

  async handleDialog(
    action: 'accept' | 'dismiss',
    promptText?: string,
  ): Promise<ToolResult> {
    const client = await this.browserManager.getMcpClient();
    await client.callTool('handle_dialog', { action, promptText });
    return { output: `Dialog ${action}ed` };
  }

  async evaluateScript(script: string): Promise<ToolResult> {
    const page = await this.browserManager.getPage();
    try {
      // Wrap script in a function call to handle both expressions and statements
      const wrappedScript = `(function() { return ${script}; })()`;
      const result = await page.evaluate(wrappedScript);

      let output = '';
      if (typeof result === 'object') {
        output = JSON.stringify(result);
      } else {
        output = String(result);
      }
      return { output };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return { error: `Script execution failed: ${message}` };
    }
  }

  async pressKey(key: string): Promise<ToolResult> {
    const client = await this.browserManager.getMcpClient();
    await client.callTool('press_key', { key });
    return { output: `Pressed key "${key}"` };
  }

  async drag(fromUid: string, toUid: string): Promise<ToolResult> {
    const client = await this.browserManager.getMcpClient();
    await client.callTool('drag', { from_uid: fromUid, to_uid: toUid });
    return { output: 'Dragged element' };
  }

  // Deprecated: Use pressKey if possible, but keeping for coordinate-based/legacy support or where UID isn't known
  async keyCombination(keys: string): Promise<ToolResult> {
    return this.pressKey(keys);
  }
}
