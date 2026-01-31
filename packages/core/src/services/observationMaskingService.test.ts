/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObservationMaskingService } from './observationMaskingService.js';
import { estimateTokenCountSync } from '../utils/tokenCalculation.js';
import type { Config } from '../config/config.js';
import type { Content, Part } from '@google/genai';
import * as fsPromises from 'node:fs/promises';

vi.mock('../utils/tokenCalculation.js', () => ({
  estimateTokenCountSync: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

describe('ObservationMaskingService', () => {
  let service: ObservationMaskingService;
  let mockConfig: Config;

  const mockedEstimateTokenCountSync = vi.mocked(estimateTokenCountSync);

  beforeEach(() => {
    service = new ObservationMaskingService();
    mockConfig = {
      storage: {
        getHistoryDir: () => '/mock/history',
      },
    } as unknown as Config;
    vi.clearAllMocks();
  });

  it('should not mask if total tool tokens are below protection threshold', async () => {
    const history: Content[] = [
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'test_tool',
              response: { output: 'small output' },
            },
          },
        ],
      },
    ];

    mockedEstimateTokenCountSync.mockReturnValue(100);

    const result = await service.mask(history, mockConfig);

    expect(result.maskedCount).toBe(0);
    expect(result.newHistory).toEqual(history);
  });

  const getToolResponse = (part: Part | undefined): string => {
    const resp = part?.functionResponse?.response as
      | { output: string }
      | undefined;
    return resp?.output ?? (resp as unknown as string) ?? '';
  };

  it('should mask tool outputs beyond the 50k protection window if prunable > 30k', async () => {
    const history: Content[] = [
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'tool1',
              response: { output: 'A\n'.repeat(30000) }, // 60k
            },
          },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'tool2',
              response: { output: 'B\n'.repeat(30000) }, // 60k
            },
          },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'tool3',
              response: { output: 'C\n'.repeat(10000) }, // 20k
            },
          },
        ],
      },
    ];

    mockedEstimateTokenCountSync.mockImplementation((parts: Part[]) => {
      const resp = parts[0].functionResponse?.response as
        | { output: string }
        | string;
      const content = typeof resp === 'string' ? resp : resp.output;
      return content.length; // 1 token per char for simple mock
    });

    const result = await service.mask(history, mockConfig);

    expect(result.maskedCount).toBe(2); // tool1 and tool2 masked
    expect(result.tokensSaved).toBeGreaterThan(0);
    expect(fsPromises.writeFile).toHaveBeenCalledTimes(2);

    expect(getToolResponse(result.newHistory[0].parts?.[0])).toContain(
      '<observation_masked_guidance',
    );
    expect(getToolResponse(result.newHistory[0].parts?.[0])).toContain(
      '<estimated_total_tokens>60,000</estimated_total_tokens',
    );
    expect(getToolResponse(result.newHistory[0].parts?.[0])).toContain(
      'search_file_content',
    );

    expect(getToolResponse(result.newHistory[1].parts?.[0])).toContain(
      '<observation_masked_guidance',
    );

    expect(getToolResponse(result.newHistory[2].parts?.[0])).toEqual(
      'C\n'.repeat(10000),
    );
  });

  it('should not mask if prunable tokens are below hysteresis', async () => {
    // Newest 50k protected. Next 20k prunable. 20k < 30k (hysteresis) -> No masking.
    const history: Content[] = [
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'tool1',
              response: { output: 'A'.repeat(20000) },
            },
          },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'tool2',
              response: { output: 'B'.repeat(50000) },
            },
          },
        ],
      },
    ];

    mockedEstimateTokenCountSync.mockImplementation((parts: Part[]) => {
      const resp = parts[0].functionResponse?.response as
        | { output: string }
        | string;
      const content = typeof resp === 'string' ? resp : resp.output;
      return content.length;
    });

    const result = await service.mask(history, mockConfig);

    expect(result.maskedCount).toBe(0);
  });
});
