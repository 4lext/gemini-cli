/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @fileoverview Temporal Hook Interceptor
 *
 * Wraps the gemini-cli-core HookSystem to inject Temporal signaling for
 * tool call observability. This implements Option 1b: Programmatic Hook
 * Injection, providing zero-latency in-process signaling.
 *
 * @see ADR-003: Session Supervisor Observability Pattern
 */

import { logger } from '../utils/logger.js';

/**
 * Callback interface for tool lifecycle events.
 * Consumers implement this to receive tool call notifications.
 */
export interface ToolLifecycleCallbacks {
  /**
   * Called before a tool begins execution.
   *
   * @param toolName - The name of the tool being invoked
   * @param toolInput - The input parameters for the tool
   * @param callId - A unique identifier for this tool invocation
   */
  onBeforeTool?: (
    toolName: string,
    toolInput: unknown,
    callId: string,
  ) => void | Promise<void>;

  /**
   * Called after a tool completes execution.
   *
   * @param toolName - The name of the tool that was invoked
   * @param toolInput - The input parameters that were used
   * @param toolResponse - The response from the tool
   * @param callId - The unique identifier for this tool invocation
   * @param success - Whether the tool execution succeeded
   */
  onAfterTool?: (
    toolName: string,
    toolInput: unknown,
    toolResponse: unknown,
    callId: string,
    success: boolean,
  ) => void | Promise<void>;
}

/**
 * Minimal interface for HookSystem to avoid tight coupling to gemini-cli-core.
 * This allows the interceptor to work with any object that has these methods.
 */
interface HookSystemLike {
  fireBeforeToolEvent(
    toolName: string,
    toolInput: unknown,
    mcpContext?: unknown,
  ): Promise<unknown>;
  fireAfterToolEvent(
    toolName: string,
    toolInput: unknown,
    toolResponse: unknown,
    mcpContext?: unknown,
  ): Promise<unknown>;
}

/**
 * Counter for generating unique call IDs within this process.
 * Combined with timestamp for global uniqueness.
 */
let callIdCounter = 0;

/**
 * Generates a unique call ID for tool invocations.
 *
 * @param toolName - The name of the tool being invoked
 * @returns A unique string identifier
 */
function generateCallId(toolName: string): string {
  return `${toolName}-${Date.now()}-${++callIdCounter}`;
}

/**
 * Map to track call IDs across before/after events.
 * Key: `${toolName}:${JSON.stringify(toolInput)}`
 * Value: callId
 *
 * Note: This is a simple approach that may have edge cases with
 * concurrent identical tool calls. For production, consider using
 * a more robust correlation mechanism.
 */
const activeToolCalls = new Map<string, string>();

/**
 * Creates a correlation key for matching before/after tool events.
 */
function createCorrelationKey(toolName: string, toolInput: unknown): string {
  try {
    return `${toolName}:${JSON.stringify(toolInput)}`;
  } catch {
    // Fall back to just tool name if input is not serializable
    return `${toolName}:${Date.now()}`;
  }
}

/**
 * Installs the Temporal hook interceptor on a HookSystem instance.
 *
 * This wraps the `fireBeforeToolEvent` and `fireAfterToolEvent` methods
 * to inject callbacks that can signal Temporal about tool lifecycle events.
 *
 * @param hookSystem - The HookSystem instance to wrap
 * @param callbacks - The callbacks to invoke for tool lifecycle events
 *
 * @example
 * ```typescript
 * const hookSystem = config.getHookSystem();
 * installTemporalHookInterceptor(hookSystem, {
 *   onBeforeTool: (toolName, input, callId) => {
 *     signaler.signalToolCallStarted({ callId, toolName });
 *   },
 *   onAfterTool: (toolName, input, response, callId, success) => {
 *     signaler.signalToolCallCompleted({ callId, success });
 *   },
 * });
 * ```
 */
export function installTemporalHookInterceptor(
  hookSystem: HookSystemLike | null | undefined,
  callbacks: ToolLifecycleCallbacks,
): void {
  if (!hookSystem) {
    logger.warn(
      '[TemporalHookInterceptor] No HookSystem provided, skipping installation',
    );
    return;
  }

  logger.info(
    '[TemporalHookInterceptor] Installing tool lifecycle interceptor',
  );

  // Store original methods
  const originalFireBeforeTool =
    hookSystem.fireBeforeToolEvent.bind(hookSystem);
  const originalFireAfterTool = hookSystem.fireAfterToolEvent.bind(hookSystem);

  // Wrap fireBeforeToolEvent
  hookSystem.fireBeforeToolEvent = async (
    toolName: string,
    toolInput: unknown,
    mcpContext?: unknown,
  ): Promise<unknown> => {
    const callId = generateCallId(toolName);
    const correlationKey = createCorrelationKey(toolName, toolInput);

    // Store call ID for correlation with afterTool
    activeToolCalls.set(correlationKey, callId);

    // Fire callback (fire-and-forget, don't block tool execution)
    if (callbacks.onBeforeTool) {
      try {
        // Use Promise.resolve to handle both sync and async callbacks
        Promise.resolve(
          callbacks.onBeforeTool(toolName, toolInput, callId),
        ).catch((err) => {
          logger.warn(
            `[TemporalHookInterceptor] onBeforeTool callback failed for ${toolName}:`,
            err,
          );
        });
      } catch (err) {
        logger.warn(
          `[TemporalHookInterceptor] onBeforeTool callback threw for ${toolName}:`,
          err,
        );
      }
    }

    // Call original method
    return originalFireBeforeTool(toolName, toolInput, mcpContext);
  };

  // Wrap fireAfterToolEvent
  hookSystem.fireAfterToolEvent = async (
    toolName: string,
    toolInput: unknown,
    toolResponse: unknown,
    mcpContext?: unknown,
  ): Promise<unknown> => {
    const correlationKey = createCorrelationKey(toolName, toolInput);
    const callId =
      activeToolCalls.get(correlationKey) ?? generateCallId(toolName);

    // Clean up correlation map
    activeToolCalls.delete(correlationKey);

    // Determine success (heuristic: check if response indicates error)
    const success = !isErrorResponse(toolResponse);

    // Fire callback (fire-and-forget, don't block)
    if (callbacks.onAfterTool) {
      try {
        Promise.resolve(
          callbacks.onAfterTool(
            toolName,
            toolInput,
            toolResponse,
            callId,
            success,
          ),
        ).catch((err) => {
          logger.warn(
            `[TemporalHookInterceptor] onAfterTool callback failed for ${toolName}:`,
            err,
          );
        });
      } catch (err) {
        logger.warn(
          `[TemporalHookInterceptor] onAfterTool callback threw for ${toolName}:`,
          err,
        );
      }
    }

    // Call original method
    return originalFireAfterTool(toolName, toolInput, toolResponse, mcpContext);
  };

  logger.info(
    '[TemporalHookInterceptor] Tool lifecycle interceptor installed successfully',
  );
}

/**
 * Heuristic to determine if a tool response indicates an error.
 */
function isErrorResponse(response: unknown): boolean {
  if (response === null || response === undefined) {
    return false;
  }

  if (typeof response === 'object') {
    const obj = response as Record<string, unknown>;
    // Check for common error indicators
    if (obj['error'] !== undefined && obj['error'] !== null) return true;
    if (obj['isError'] === true) return true;
    if (obj['success'] === false) return true;
    if (
      typeof obj['message'] === 'string' &&
      (obj['message']).toLowerCase().includes('error')
    ) {
      return true;
    }
  }

  return false;
}
