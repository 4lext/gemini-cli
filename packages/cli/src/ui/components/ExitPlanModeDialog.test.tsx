/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act } from 'react';
import { renderWithProviders } from '../../test-utils/render.js';
import { waitFor } from '../../test-utils/async.js';
import { ExitPlanModeDialog } from './ExitPlanModeDialog.js';
import { ApprovalMode } from '@google/gemini-cli-core';
import * as fs from 'node:fs';

// Mock only the fs.promises.readFile method, keeping the rest of the module
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

const writeKey = (stdin: { write: (data: string) => void }, key: string) => {
  act(() => {
    stdin.write(key);
  });
};

const waitForContentLoad = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe('ExitPlanModeDialog', () => {
  const samplePlanContent = `## Overview

Add user authentication to the CLI application.

## Implementation Steps

1. Create \`src/auth/AuthService.ts\` with login/logout methods
2. Add session storage in \`src/storage/SessionStore.ts\`
3. Update \`src/commands/index.ts\` to check auth status
4. Add tests in \`src/auth/__tests__/\`

## Files to Modify

- \`src/index.ts\` - Add auth middleware
- \`src/config.ts\` - Add auth configuration options`;

  let onApprove: ReturnType<typeof vi.fn>;
  let onFeedback: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.mocked(fs.promises.readFile).mockResolvedValue(samplePlanContent);
    onApprove = vi.fn();
    onFeedback = vi.fn();
    onCancel = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const renderDialog = () =>
    renderWithProviders(
      <ExitPlanModeDialog
        planPath="/mock/plans/test-plan.md"
        onApprove={onApprove}
        onFeedback={onFeedback}
        onCancel={onCancel}
        width={80}
        availableHeight={20}
      />,
    );

  it('renders correctly with plan content', async () => {
    const { lastFrame } = renderDialog();

    await waitForContentLoad();

    await waitFor(() => {
      expect(fs.promises.readFile).toHaveBeenCalledWith(
        '/mock/plans/test-plan.md',
        'utf8',
      );
    });

    expect(lastFrame()).toMatchSnapshot();
  });

  it('calls onApprove with AUTO_EDIT when first option is selected', async () => {
    const { stdin } = renderDialog();

    await waitForContentLoad();

    await waitFor(() => {
      expect(fs.promises.readFile).toHaveBeenCalled();
    });

    writeKey(stdin, '\r');

    await waitFor(() => {
      expect(onApprove).toHaveBeenCalledWith(ApprovalMode.AUTO_EDIT);
    });
  });

  it('calls onApprove with DEFAULT when second option is selected', async () => {
    const { stdin } = renderDialog();

    await waitForContentLoad();

    await waitFor(() => {
      expect(fs.promises.readFile).toHaveBeenCalled();
    });

    writeKey(stdin, '\x1b[B'); // Down arrow
    writeKey(stdin, '\r');

    await waitFor(() => {
      expect(onApprove).toHaveBeenCalledWith(ApprovalMode.DEFAULT);
    });
  });

  it('calls onFeedback when feedback is typed and submitted', async () => {
    const { stdin, lastFrame } = renderDialog();

    await waitForContentLoad();

    await waitFor(() => {
      expect(fs.promises.readFile).toHaveBeenCalled();
    });

    // Navigate to feedback input
    writeKey(stdin, '\x1b[B'); // Down arrow
    writeKey(stdin, '\x1b[B'); // Down arrow

    for (const char of 'Add tests') {
      writeKey(stdin, char);
    }

    await waitFor(() => {
      expect(lastFrame()).toMatchSnapshot();
    });

    writeKey(stdin, '\r');

    await waitFor(() => {
      expect(onFeedback).toHaveBeenCalledWith('Add tests');
    });
  });

  it('calls onCancel when Esc is pressed', async () => {
    const { stdin } = renderDialog();

    await waitForContentLoad();

    await waitFor(() => {
      expect(fs.promises.readFile).toHaveBeenCalled();
    });

    writeKey(stdin, '\x1b'); // Escape

    await waitFor(() => {
      expect(onCancel).toHaveBeenCalled();
    });
  });

  it('displays error state when file read fails', async () => {
    vi.mocked(fs.promises.readFile).mockRejectedValue(
      new Error('File not found'),
    );

    const { lastFrame } = renderDialog();

    await waitForContentLoad();

    expect(lastFrame()).toMatchSnapshot();
  });

  it('truncates very long plan content', async () => {
    const longPlanContent = `## Overview

Implement a comprehensive authentication system with multiple providers.

## Implementation Steps

1. Create \`src/auth/AuthService.ts\` with login/logout methods
2. Add session storage in \`src/storage/SessionStore.ts\`
3. Update \`src/commands/index.ts\` to check auth status
4. Add OAuth2 provider support in \`src/auth/providers/OAuth2Provider.ts\`
5. Add SAML provider support in \`src/auth/providers/SAMLProvider.ts\`
6. Add LDAP provider support in \`src/auth/providers/LDAPProvider.ts\`
7. Create token refresh mechanism in \`src/auth/TokenManager.ts\`
8. Add multi-factor authentication in \`src/auth/MFAService.ts\`
9. Implement session timeout handling in \`src/auth/SessionManager.ts\`
10. Add audit logging for auth events in \`src/auth/AuditLogger.ts\`
11. Create user profile management in \`src/auth/UserProfile.ts\`
12. Add role-based access control in \`src/auth/RBACService.ts\`
13. Implement password policy enforcement in \`src/auth/PasswordPolicy.ts\`
14. Add brute force protection in \`src/auth/BruteForceGuard.ts\`
15. Create secure cookie handling in \`src/auth/CookieManager.ts\`

## Files to Modify

- \`src/index.ts\` - Add auth middleware
- \`src/config.ts\` - Add auth configuration options
- \`src/routes/api.ts\` - Add auth endpoints
- \`src/middleware/cors.ts\` - Update CORS for auth headers
- \`src/utils/crypto.ts\` - Add encryption utilities

## Testing Strategy

- Unit tests for each auth provider
- Integration tests for full auth flows
- Security penetration testing
- Load testing for session management`;

    vi.mocked(fs.promises.readFile).mockResolvedValue(longPlanContent);

    const { lastFrame } = renderDialog();

    await waitForContentLoad();

    expect(lastFrame()).toMatchSnapshot();
  });
});
