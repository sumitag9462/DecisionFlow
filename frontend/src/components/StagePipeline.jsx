import React from 'react';

export default function StagePipeline({ stages = [], trace = [], status }) {
  if (!stages.length) return null;

  // Find if any stage terminated the execution early
  let executionHalted = false;

  return (
    <div className="stage-pipeline">
      {stages.map((stage, idx) => {
        const stageTrace = trace.filter(t => t.stageId === stage.id);
        const hasExecuted = stageTrace.length > 0;
        const matchedRule = stageTrace.find(t => t.matched);
        const depCheck = stageTrace.find(t => t.kind === 'dependency');
        const depFailed = depCheck && depCheck.outcome !== 'OK';

        let stateClass = 'not-executed';
        let stateLabel = 'Not Executed';

        if (hasExecuted && !executionHalted) {
          if (depFailed) {
            stateClass = 'error';
            stateLabel = 'Dependency Failure (503)';
            executionHalted = true;
          } else if (matchedRule) {
            if (matchedRule.outcome === 'REJECTED') {
              stateClass = 'rejected';
              stateLabel = `Rejected (${matchedRule.ruleId})`;
              executionHalted = true;
            } else if (matchedRule.outcome === 'MANUAL_REVIEW') {
              stateClass = 'flagged';
              stateLabel = `Review Flag (${matchedRule.ruleId})`;
              executionHalted = true;
            } else {
              stateClass = 'passed';
              stateLabel = 'Completed';
            }
          } else {
            stateClass = 'passed';
            stateLabel = 'Passed';
          }
        } else if (executionHalted) {
          stateClass = 'not-executed';
          stateLabel = 'Skipped (Halted)';
        }

        return (
          <div key={stage.id} className={`stage-pipeline-step ${stateClass}`}>
            <div className="stage-step-header">
              <span className="stage-step-num">Stage {idx + 1}</span>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{stage.type.toUpperCase()}</span>
            </div>
            <div className="stage-step-name">{stage.name}</div>
            <div className="stage-step-status">{stateLabel}</div>
          </div>
        );
      })}
    </div>
  );
}

