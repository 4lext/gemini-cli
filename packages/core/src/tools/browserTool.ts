/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolResult, ToolInvocation } from './tools.js';
import { BaseDeclarativeTool, BaseToolInvocation, Kind } from './tools.js';
import { BrowserAgent } from '../agents/browser/browserAgent.js';
import type { GeminiClient } from '../core/client.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';

interface BrowserToolParams {
  task: string;
}

class BrowserToolInvocation extends BaseToolInvocation<
  BrowserToolParams,
  ToolResult
> {
  constructor(
    params: BrowserToolParams,
    private readonly client: GeminiClient,
    messageBus?: MessageBus,
  ) {
    super(params, messageBus, 'computer_use_browser', 'Browser Agent');
  }

  getDescription(): string {
    return `Browser Agent executing task: ${this.params.task}`;
  }

  async execute(
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const generator = this.client.getContentGeneratorOrFail();
    const config = this.client.getConfig();

    if (config.browserAgentSettings?.enabled === false) {
      return {
        llmContent: [{ text: 'Error: Browser Agent is disabled in settings.' }],
        returnDisplay: 'Error: Browser Agent is disabled in settings.',
        error: { message: 'Browser Agent is disabled in settings.' },
      };
    }

    const tempDir = config.storage.getProjectTempDir();
    const agent = new BrowserAgent(generator, config, tempDir);

    try {
      const result = await agent.runTask(
        this.params.task,
        signal,
        updateOutput,
      );
      return {
        llmContent: [{ text: result || 'Task completed' }],
        returnDisplay: result || 'Task completed',
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        llmContent: [{ text: `Error: ${message}` }],
        returnDisplay: `Error: ${message}`,
        error: { message },
      };
    }
  }
}

export class BrowserTool extends BaseDeclarativeTool<
  BrowserToolParams,
  ToolResult
> {
  constructor(
    private readonly client: GeminiClient,
    messageBus?: MessageBus,
  ) {
    super(
      'computer_use_browser',
      'Browser Agent',
      'Delegates a task to a specialized browser-use agent. Use this for ANY task requiring web browsing, interactions, or collecting information from websites.',
      Kind.Other,
      {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description:
              'The natural language description of the task to perform.',
          },
        },
        required: ['task'],
      },
      false, // isOutputMarkdown
      true, // canUpdateOutput
      messageBus,
    );
  }

  protected createInvocation(
    params: BrowserToolParams,
    messageBus?: MessageBus,
  ): ToolInvocation<BrowserToolParams, ToolResult> {
    return new BrowserToolInvocation(params, this.client, messageBus);
  }
}
