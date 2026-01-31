/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Content, Part } from '@google/genai';
import path from 'node:path';
import * as fsPromises from 'node:fs/promises';
import { estimateTokenCountSync } from '../utils/tokenCalculation.js';
import { debugLogger } from '../utils/debugLogger.js';
import type { Config } from '../config/config.js';

export const TOOL_PROTECTION_THRESHOLD = 50_000;
export const HYSTERESIS_THRESHOLD = 30_000;

export const SMART_TRUNCATION_TOKENS = 5_000;

export const OBSERVATION_DIR = 'observations';

export interface MaskingResult {
  newHistory: Content[];
  maskedCount: number;
  tokensSaved: number;
}

/**
 * Service to manage context window by masking bulky tool outputs (Observation Masking).
 * Follows the Backward FIFO algorithm:
 * 1. Protect newest 50k tool tokens.
 * 2. Identify prunable tool tokens beyond 50k.
 * 3. Trigger masking if prunable tokens > 30k.
 */
export class ObservationMaskingService {
  async mask(history: Content[], config: Config): Promise<MaskingResult> {
    if (history.length === 0) {
      return { newHistory: history, maskedCount: 0, tokensSaved: 0 };
    }

    let cumulativeToolTokens = 0;
    let protectionBoundaryReached = false;
    let totalPrunableTokens = 0;

    const prunableParts: Array<{
      contentIndex: number;
      partIndex: number;
      tokens: number;
      content: string;
    }> = [];

    // Step 1: Backward scan to identify prunable tool outputs
    for (let i = history.length - 1; i >= 0; i--) {
      const content = history[i];
      const parts = content.parts || [];

      for (let j = parts.length - 1; j >= 0; j--) {
        const part = parts[j];

        // We only care about tool responses (observations)
        if (!part.functionResponse) continue;

        const observationContent = this.getObservationContent(part);
        if (!observationContent || this.isAlreadyMasked(observationContent)) {
          continue;
        }

        const partTokens = estimateTokenCountSync([part]);

        if (!protectionBoundaryReached) {
          cumulativeToolTokens += partTokens;
          if (cumulativeToolTokens > TOOL_PROTECTION_THRESHOLD) {
            protectionBoundaryReached = true;
            // The part that crossed the boundary is prunable.
            totalPrunableTokens += partTokens;
            prunableParts.push({
              contentIndex: i,
              partIndex: j,
              tokens: partTokens,
              content: observationContent,
            });
          }
        } else {
          totalPrunableTokens += partTokens;
          prunableParts.push({
            contentIndex: i,
            partIndex: j,
            tokens: partTokens,
            content: observationContent,
          });
        }
      }
    }

    // Step 2: Hysteresis trigger
    if (totalPrunableTokens < HYSTERESIS_THRESHOLD) {
      return { newHistory: history, maskedCount: 0, tokensSaved: 0 };
    }

    debugLogger.log(
      `[ObservationMasking] Triggering masking. Prunable tool tokens: ${totalPrunableTokens.toLocaleString()} (> ${HYSTERESIS_THRESHOLD.toLocaleString()})`,
    );

    // Step 3: Perform masking and offloading
    const newHistory = [...history]; // Shallow copy of history
    let actualTokensSaved = 0;
    const observationDir = path.join(
      config.storage.getHistoryDir(),
      OBSERVATION_DIR,
    );
    await fsPromises.mkdir(observationDir, { recursive: true });

    for (const item of prunableParts) {
      const { contentIndex, partIndex, content, tokens } = item;
      const contentRecord = newHistory[contentIndex];
      const part = contentRecord.parts![partIndex];

      if (!part.functionResponse) continue;

      const toolName = part.functionResponse.name;
      // Use callId to avoid collisions if possible
      const response =
        (part.functionResponse.response as Record<string, unknown>) || {};
      const callId = response['callId']?.toString() || Date.now().toString();
      const fileName = `${toolName}_${callId}_${Math.random()
        .toString(36)
        .substring(7)}.txt`;
      const filePath = path.join(observationDir, fileName);

      await fsPromises.writeFile(filePath, content, 'utf-8');

      const maskedSnippet = this.formatMaskedSnippet(
        content,
        filePath,
        toolName ?? 'unknown_tool',
        tokens,
      );

      // Create new part with masked content
      const newParts = [...contentRecord.parts!];
      const originalResponse =
        (part.functionResponse.response as Record<string, unknown>) || {};

      // Determine which key to replace (output, result, stdout, or the string itself)
      let newResponse: Record<string, unknown> | string;
      if (typeof originalResponse === 'string') {
        newResponse = maskedSnippet;
      } else {
        newResponse = { ...originalResponse };
        if ('output' in originalResponse) newResponse['output'] = maskedSnippet;
        else if ('result' in originalResponse)
          newResponse['result'] = maskedSnippet;
        else if ('stdout' in originalResponse)
          newResponse['stdout'] = maskedSnippet;
        else if ('content' in originalResponse)
          newResponse['content'] = maskedSnippet;
        else {
          // Default to string if we can't find a key, though getObservationContent usually finds one
          newResponse['output'] = maskedSnippet;
        }
      }

      newParts[partIndex] = {
        ...part,
        functionResponse: {
          ...part.functionResponse,
          response: newResponse as unknown as Record<string, unknown>,
        },
      };

      newHistory[contentIndex] = { ...contentRecord, parts: newParts };
      const newTaskTokens = estimateTokenCountSync([newParts[partIndex]]);
      actualTokensSaved += tokens - newTaskTokens;
    }

    debugLogger.log(
      `[ObservationMasking] Masked ${prunableParts.length} tool outputs. Saved ~${actualTokensSaved.toLocaleString()} tokens.`,
    );

    return {
      newHistory,
      maskedCount: prunableParts.length,
      tokensSaved: actualTokensSaved,
    };
  }

  private getObservationContent(part: Part): string | null {
    if (!part.functionResponse) return null;
    const response = part.functionResponse.response as Record<string, unknown>;
    if (!response) return null;

    if (typeof response === 'string') return response;
    if (typeof response === 'object') {
      if ('output' in response && typeof response['output'] === 'string')
        return response['output'];
      if ('result' in response && typeof response['result'] === 'string')
        return response['result'];
      if ('stdout' in response && typeof response['stdout'] === 'string')
        return response['stdout'];
      if ('content' in response && typeof response['content'] === 'string')
        return response['content'];
    }
    return null;
  }

  private isAlreadyMasked(content: string): boolean {
    return content.includes('[Observation Masked]');
  }

  private formatMaskedSnippet(
    content: string,
    filePath: string,
    toolName: string,
    totalTokens: number,
  ): string {
    const lines = content.split('\n');
    const totalLines = lines.length;
    const fileSizeMB = (
      Buffer.byteLength(content, 'utf8') /
      1024 /
      1024
    ).toFixed(2);

    // Smart Truncation: keep first and last SMART_TRUNCATION_TOKENS tokens.
    // We use a safe character proxy (4 chars per token) to slice.
    const charLimit = SMART_TRUNCATION_TOKENS * 4;

    if (content.length <= charLimit * 2.5) {
      return content; // Too small to mask meaningfully
    }

    const head = content.slice(0, charLimit);
    const tail = content.slice(-charLimit);

    return `[Observation Masked]
${head}
... [TRUNCATED ${totalLines.toLocaleString()} LINES | ${fileSizeMB}MB | ~${totalTokens.toLocaleString()} TOKENS] ...
${tail}

<observation_masked_guidance tool_name="${toolName}">
  <summary>
    Data from tool "${toolName}" was offloaded to save context space.
  </summary>
  <details>
    <file_path>${filePath}</file_path>
    <line_count>${totalLines.toLocaleString()}</line_count>
    <file_size>${fileSizeMB}MB</file_size>
    <estimated_total_tokens>${totalTokens.toLocaleString()}</estimated_total_tokens>
  </details>
  <instructions>
    The full output is available at the path above. 
    You can inspect it using tools like 'search_file_content' or 'read_file'.
    Note: Reading the full file will use approximately ${totalTokens.toLocaleString()} tokens.
  </instructions>
</observation_masked_guidance>`;
  }
}
