/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useCallback, useMemo, useState, useEffect } from 'react';
import {
  type Question,
  QuestionType,
  ApprovalMode,
} from '@google/gemini-cli-core';
import { AskUserDialog } from './AskUserDialog.js';
import * as fs from 'node:fs';

interface ExitPlanModeDialogProps {
  planPath: string;
  onApprove: (approvalMode: ApprovalMode) => void;
  onFeedback: (feedback: string) => void;
  onCancel: () => void;
  width: number;
  availableHeight: number;
}

const APPROVE_AUTO_EDIT = 'Yes, automatically accept edits';
const APPROVE_DEFAULT = 'Yes, manually accept edits';

interface PlanContentState {
  status: 'loading' | 'loaded' | 'error';
  content?: string;
  error?: string;
}

export const ExitPlanModeDialog: React.FC<ExitPlanModeDialogProps> = ({
  planPath,
  onApprove,
  onFeedback,
  onCancel,
  width,
  availableHeight,
}) => {
  const [planState, setPlanState] = useState<PlanContentState>({
    status: 'loading',
  });

  useEffect(() => {
    let ignore = false;

    fs.promises
      .readFile(planPath, 'utf8')
      .then((content) => {
        if (ignore) return;
        setPlanState({ status: 'loaded', content });
      })
      .catch((err) => {
        if (ignore) return;
        setPlanState({ status: 'error', error: err.message });
      });

    return () => {
      ignore = true;
    };
  }, [planPath]);

  const questions = useMemo((): Question[] => {
    const context =
      planState.status === 'error'
        ? `**Error reading plan:** ${planState.error}`
        : planState.content;

    return [
      {
        question: 'Ready to start implementation?',
        header: 'Plan',
        type: QuestionType.CHOICE,
        options: [{ label: APPROVE_AUTO_EDIT }, { label: APPROVE_DEFAULT }],
        context,
        customOptionPlaceholder: 'Provide feedback...',
      },
    ];
  }, [planState]);

  const handleSubmit = useCallback(
    (answers: { [questionIndex: string]: string }) => {
      const answer = answers['0'];
      if (answer === APPROVE_AUTO_EDIT) {
        onApprove(ApprovalMode.AUTO_EDIT);
      } else if (answer === APPROVE_DEFAULT) {
        onApprove(ApprovalMode.DEFAULT);
      } else if (answer) {
        onFeedback(answer);
      }
    },
    [onApprove, onFeedback],
  );

  return (
    <AskUserDialog
      questions={questions}
      onSubmit={handleSubmit}
      onCancel={onCancel}
      width={width}
      availableHeight={availableHeight}
    />
  );
};
