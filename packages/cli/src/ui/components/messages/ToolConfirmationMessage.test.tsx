/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { ToolConfirmationMessage } from './ToolConfirmationMessage.js';
import type {
  ToolCallConfirmationDetails,
  Config,
  SerializableConfirmationDetails,
} from '@google/gemini-cli-core';
import { ApprovalMode, ToolConfirmationOutcome } from '@google/gemini-cli-core';
import {
  renderWithProviders,
  createMockSettings,
} from '../../../test-utils/render.js';
import { waitFor } from '../../../test-utils/async.js';
import { useToolActions } from '../../contexts/ToolActionsContext.js';
import * as fs from 'node:fs';

vi.mock('../../contexts/ToolActionsContext.js', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../contexts/ToolActionsContext.js')
    >();
  return {
    ...actual,
    useToolActions: vi.fn(),
  };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn(),
    },
  };
});

describe('ToolConfirmationMessage', () => {
  const mockConfirm = vi.fn().mockResolvedValue(undefined);
  vi.mocked(useToolActions).mockReturnValue({
    confirm: mockConfirm,
    cancel: vi.fn(),
    isDiffingEnabled: false,
  });

  const mockConfig = {
    isTrustedFolder: () => true,
    getIdeMode: () => false,
  } as unknown as Config;

  it('should not display urls if prompt and url are the same', () => {
    const confirmationDetails: ToolCallConfirmationDetails = {
      type: 'info',
      title: 'Confirm Web Fetch',
      prompt: 'https://example.com',
      urls: ['https://example.com'],
      onConfirm: vi.fn(),
    };

    const { lastFrame } = renderWithProviders(
      <ToolConfirmationMessage
        callId="test-call-id"
        confirmationDetails={confirmationDetails}
        config={mockConfig}
        availableTerminalHeight={30}
        terminalWidth={80}
      />,
    );

    expect(lastFrame()).toMatchSnapshot();
  });

  it('should display urls if prompt and url are different', () => {
    const confirmationDetails: ToolCallConfirmationDetails = {
      type: 'info',
      title: 'Confirm Web Fetch',
      prompt:
        'fetch https://github.com/google/gemini-react/blob/main/README.md',
      urls: [
        'https://raw.githubusercontent.com/google/gemini-react/main/README.md',
      ],
      onConfirm: vi.fn(),
    };

    const { lastFrame } = renderWithProviders(
      <ToolConfirmationMessage
        callId="test-call-id"
        confirmationDetails={confirmationDetails}
        config={mockConfig}
        availableTerminalHeight={30}
        terminalWidth={80}
      />,
    );

    expect(lastFrame()).toMatchSnapshot();
  });

  it('should display multiple commands for exec type when provided', () => {
    const confirmationDetails: ToolCallConfirmationDetails = {
      type: 'exec',
      title: 'Confirm Multiple Commands',
      command: 'echo "hello"', // Primary command
      rootCommand: 'echo',
      rootCommands: ['echo'],
      commands: ['echo "hello"', 'ls -la', 'whoami'], // Multi-command list
      onConfirm: vi.fn(),
    };

    const { lastFrame } = renderWithProviders(
      <ToolConfirmationMessage
        callId="test-call-id"
        confirmationDetails={confirmationDetails}
        config={mockConfig}
        availableTerminalHeight={30}
        terminalWidth={80}
      />,
    );

    const output = lastFrame();
    expect(output).toContain('echo "hello"');
    expect(output).toContain('ls -la');
    expect(output).toContain('whoami');
    expect(output).toMatchSnapshot();
  });

  describe('with folder trust', () => {
    const editConfirmationDetails: ToolCallConfirmationDetails = {
      type: 'edit',
      title: 'Confirm Edit',
      fileName: 'test.txt',
      filePath: '/test.txt',
      fileDiff: '...diff...',
      originalContent: 'a',
      newContent: 'b',
      onConfirm: vi.fn(),
    };

    const execConfirmationDetails: ToolCallConfirmationDetails = {
      type: 'exec',
      title: 'Confirm Execution',
      command: 'echo "hello"',
      rootCommand: 'echo',
      rootCommands: ['echo'],
      onConfirm: vi.fn(),
    };

    const infoConfirmationDetails: ToolCallConfirmationDetails = {
      type: 'info',
      title: 'Confirm Web Fetch',
      prompt: 'https://example.com',
      urls: ['https://example.com'],
      onConfirm: vi.fn(),
    };

    const mcpConfirmationDetails: ToolCallConfirmationDetails = {
      type: 'mcp',
      title: 'Confirm MCP Tool',
      serverName: 'test-server',
      toolName: 'test-tool',
      toolDisplayName: 'Test Tool',
      onConfirm: vi.fn(),
    };

    describe.each([
      {
        description: 'for edit confirmations',
        details: editConfirmationDetails,
        alwaysAllowText: 'Allow for this session',
      },
      {
        description: 'for exec confirmations',
        details: execConfirmationDetails,
        alwaysAllowText: 'Allow for this session',
      },
      {
        description: 'for info confirmations',
        details: infoConfirmationDetails,
        alwaysAllowText: 'Allow for this session',
      },
      {
        description: 'for mcp confirmations',
        details: mcpConfirmationDetails,
        alwaysAllowText: 'always allow',
      },
    ])('$description', ({ details }) => {
      it('should show "allow always" when folder is trusted', () => {
        const mockConfig = {
          isTrustedFolder: () => true,
          getIdeMode: () => false,
        } as unknown as Config;

        const { lastFrame } = renderWithProviders(
          <ToolConfirmationMessage
            callId="test-call-id"
            confirmationDetails={details}
            config={mockConfig}
            availableTerminalHeight={30}
            terminalWidth={80}
          />,
        );

        expect(lastFrame()).toMatchSnapshot();
      });

      it('should NOT show "allow always" when folder is untrusted', () => {
        const mockConfig = {
          isTrustedFolder: () => false,
          getIdeMode: () => false,
        } as unknown as Config;

        const { lastFrame } = renderWithProviders(
          <ToolConfirmationMessage
            callId="test-call-id"
            confirmationDetails={details}
            config={mockConfig}
            availableTerminalHeight={30}
            terminalWidth={80}
          />,
        );

        expect(lastFrame()).toMatchSnapshot();
      });
    });
  });

  describe('enablePermanentToolApproval setting', () => {
    const editConfirmationDetails: ToolCallConfirmationDetails = {
      type: 'edit',
      title: 'Confirm Edit',
      fileName: 'test.txt',
      filePath: '/test.txt',
      fileDiff: '...diff...',
      originalContent: 'a',
      newContent: 'b',
      onConfirm: vi.fn(),
    };

    it('should NOT show "Allow for all future sessions" when setting is false (default)', () => {
      const mockConfig = {
        isTrustedFolder: () => true,
        getIdeMode: () => false,
      } as unknown as Config;

      const { lastFrame } = renderWithProviders(
        <ToolConfirmationMessage
          callId="test-call-id"
          confirmationDetails={editConfirmationDetails}
          config={mockConfig}
          availableTerminalHeight={30}
          terminalWidth={80}
        />,
        {
          settings: createMockSettings({
            security: { enablePermanentToolApproval: false },
          }),
        },
      );

      expect(lastFrame()).not.toContain('Allow for all future sessions');
    });

    it('should show "Allow for all future sessions" when setting is true', () => {
      const mockConfig = {
        isTrustedFolder: () => true,
        getIdeMode: () => false,
      } as unknown as Config;

      const { lastFrame } = renderWithProviders(
        <ToolConfirmationMessage
          callId="test-call-id"
          confirmationDetails={editConfirmationDetails}
          config={mockConfig}
          availableTerminalHeight={30}
          terminalWidth={80}
        />,
        {
          settings: createMockSettings({
            security: { enablePermanentToolApproval: true },
          }),
        },
      );

      expect(lastFrame()).toContain('Allow for all future sessions');
    });
  });

  describe('Modify with external editor option', () => {
    const editConfirmationDetails: ToolCallConfirmationDetails = {
      type: 'edit',
      title: 'Confirm Edit',
      fileName: 'test.txt',
      filePath: '/test.txt',
      fileDiff: '...diff...',
      originalContent: 'a',
      newContent: 'b',
      onConfirm: vi.fn(),
    };

    it('should show "Modify with external editor" when NOT in IDE mode', () => {
      const mockConfig = {
        isTrustedFolder: () => true,
        getIdeMode: () => false,
      } as unknown as Config;

      vi.mocked(useToolActions).mockReturnValue({
        confirm: vi.fn(),
        cancel: vi.fn(),
        isDiffingEnabled: false,
      });

      const { lastFrame } = renderWithProviders(
        <ToolConfirmationMessage
          callId="test-call-id"
          confirmationDetails={editConfirmationDetails}
          config={mockConfig}
          availableTerminalHeight={30}
          terminalWidth={80}
        />,
      );

      expect(lastFrame()).toContain('Modify with external editor');
    });

    it('should show "Modify with external editor" when in IDE mode but diffing is NOT enabled', () => {
      const mockConfig = {
        isTrustedFolder: () => true,
        getIdeMode: () => true,
      } as unknown as Config;

      vi.mocked(useToolActions).mockReturnValue({
        confirm: vi.fn(),
        cancel: vi.fn(),
        isDiffingEnabled: false,
      });

      const { lastFrame } = renderWithProviders(
        <ToolConfirmationMessage
          callId="test-call-id"
          confirmationDetails={editConfirmationDetails}
          config={mockConfig}
          availableTerminalHeight={30}
          terminalWidth={80}
        />,
      );

      expect(lastFrame()).toContain('Modify with external editor');
    });

    it('should NOT show "Modify with external editor" when in IDE mode AND diffing is enabled', () => {
      const mockConfig = {
        isTrustedFolder: () => true,
        getIdeMode: () => true,
      } as unknown as Config;

      vi.mocked(useToolActions).mockReturnValue({
        confirm: vi.fn(),
        cancel: vi.fn(),
        isDiffingEnabled: true,
      });

      const { lastFrame } = renderWithProviders(
        <ToolConfirmationMessage
          callId="test-call-id"
          confirmationDetails={editConfirmationDetails}
          config={mockConfig}
          availableTerminalHeight={30}
          terminalWidth={80}
        />,
      );

      expect(lastFrame()).not.toContain('Modify with external editor');
    });
  });

  describe('exit_plan_mode confirmation', () => {
    const writeKey = (
      stdin: { write: (data: string) => void },
      key: string,
    ) => {
      act(() => {
        stdin.write(key);
      });
    };

    const waitForContentLoad = async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    };

    beforeEach(() => {
      vi.mocked(fs.promises.readFile).mockResolvedValue(
        '## Test Plan\n\n1. Do something',
      );
      mockConfirm.mockClear();
      mockConfirm.mockResolvedValue(undefined);
      vi.mocked(useToolActions).mockReturnValue({
        confirm: mockConfirm,
        cancel: vi.fn(),
        isDiffingEnabled: false,
      });
    });

    afterEach(() => {
      vi.mocked(fs.promises.readFile).mockReset();
    });

    const exitPlanModeDetails: SerializableConfirmationDetails = {
      type: 'exit_plan_mode',
      title: 'Exit Plan Mode',
      planPath: '/mock/plan.md',
    };

    it('passes approvalMode payload when first option is selected', async () => {
      const { stdin } = renderWithProviders(
        <ToolConfirmationMessage
          callId="test-call-id"
          confirmationDetails={exitPlanModeDetails}
          config={mockConfig}
          availableTerminalHeight={30}
          terminalWidth={80}
        />,
      );

      await waitForContentLoad();
      writeKey(stdin, '\r');

      await waitFor(() => {
        expect(mockConfirm).toHaveBeenCalledWith(
          'test-call-id',
          ToolConfirmationOutcome.ProceedOnce,
          { approvalMode: ApprovalMode.AUTO_EDIT },
        );
      });
    });

    it('passes approvalMode payload when second option is selected', async () => {
      const { stdin } = renderWithProviders(
        <ToolConfirmationMessage
          callId="test-call-id"
          confirmationDetails={exitPlanModeDetails}
          config={mockConfig}
          availableTerminalHeight={30}
          terminalWidth={80}
        />,
      );

      await waitForContentLoad();
      writeKey(stdin, '\x1b[B'); // Down arrow
      writeKey(stdin, '\r');

      await waitFor(() => {
        expect(mockConfirm).toHaveBeenCalledWith(
          'test-call-id',
          ToolConfirmationOutcome.ProceedOnce,
          { approvalMode: ApprovalMode.DEFAULT },
        );
      });
    });

    it('passes feedback payload when feedback is submitted', async () => {
      const { stdin } = renderWithProviders(
        <ToolConfirmationMessage
          callId="test-call-id"
          confirmationDetails={exitPlanModeDetails}
          config={mockConfig}
          availableTerminalHeight={30}
          terminalWidth={80}
        />,
      );

      await waitForContentLoad();
      writeKey(stdin, '\x1b[B'); // Down arrow
      writeKey(stdin, '\x1b[B'); // Down arrow
      for (const char of 'Add tests') {
        writeKey(stdin, char);
      }
      writeKey(stdin, '\r');

      await waitFor(() => {
        expect(mockConfirm).toHaveBeenCalledWith(
          'test-call-id',
          ToolConfirmationOutcome.Cancel,
          { feedback: 'Add tests' },
        );
      });
    });

    it('passes no payload when cancelled', async () => {
      const { stdin } = renderWithProviders(
        <ToolConfirmationMessage
          callId="test-call-id"
          confirmationDetails={exitPlanModeDetails}
          config={mockConfig}
          availableTerminalHeight={30}
          terminalWidth={80}
        />,
      );

      await waitForContentLoad();
      writeKey(stdin, '\x1b'); // Escape

      await waitFor(() => {
        expect(mockConfirm).toHaveBeenCalledWith(
          'test-call-id',
          ToolConfirmationOutcome.Cancel,
          undefined,
        );
      });
    });
  });
});
