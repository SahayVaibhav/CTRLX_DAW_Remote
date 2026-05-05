import {
  buildImportAutomationPlanFromReviewedItems,
  CtrlxCommand,
  type ImportAutomationExecutionReport,
  type ImportAutomationItem,
  type ImportAutomationPlan
} from "@ctrlx/protocol";
import type { CtrlxWsClient } from "./ws";

type ImportExecutionCommandClient = Pick<CtrlxWsClient, "sendCommandMessageForResult">;

const DEBUG_IMPORT_AUTOMATION =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  window.localStorage.getItem("ctrlx.debugImportAutomation") === "1";

function debugImportAutomation(event: string, payload: Record<string, unknown>): void {
  if (!DEBUG_IMPORT_AUTOMATION) {
    return;
  }

  console.debug(`[CTRLX import] ${event}`, payload);
}

export type ImportAutomationBatchExecutionOutcome = {
  preparedPlan: null;
  report: ImportAutomationExecutionReport;
};

export type ReviewedImportExecutionRequest = {
  reviewedItems: ImportAutomationItem[];
  importSessionId: string | null;
  isPaired: boolean;
};

export type ReviewedImportExecutionOutcome =
  | {
      ok: false;
      userMessage: string;
    }
  | {
      ok: true;
      plan: ImportAutomationPlan;
      preparedPlan: null;
      report: ImportAutomationExecutionReport;
      logMessages: string[];
    };

export async function executeImportAutomationPlanWithHostCommands(
  plan: ImportAutomationPlan,
  importSessionId: string,
  commandClient: ImportExecutionCommandClient
): Promise<ImportAutomationBatchExecutionOutcome> {
  debugImportAutomation("host_plan_dispatch", {
    itemCount: plan.items.length,
    executableItemCount: plan.executableItems.length,
    suggestionActionCount: plan.suggestionActions.length
  });

  const result = await commandClient.sendCommandMessageForResult({
    command: CtrlxCommand.ExecuteImportPlan,
    input: {
      importSessionId,
      plan
    }
  });
  const reportCandidate = result.data?.report;
  if (!reportCandidate || typeof reportCandidate !== "object") {
    throw new Error("Host import execution did not return a valid execution report.");
  }
  const report = reportCandidate as ImportAutomationExecutionReport;

  debugImportAutomation("host_plan_result", {
    totalItems: report.totalItems,
    successfulItems: report.successfulItems,
    failedItems: report.failedItems,
    totalActions: report.totalActions,
    successfulActions: report.successfulActions,
    failedActions: report.failedActions
  });

  return {
    preparedPlan: null,
    report
  };
}

export async function runReviewedImportExecution(
  request: ReviewedImportExecutionRequest,
  commandClient: ImportExecutionCommandClient
): Promise<ReviewedImportExecutionOutcome> {
  debugImportAutomation("reviewed_execution_requested", {
    reviewedItemCount: request.reviewedItems.length,
    isPaired: request.isPaired
  });

  if (request.reviewedItems.length === 0) {
    return {
      ok: false,
      userMessage: "No reviewed import items are available to execute."
    };
  }

  if (!request.isPaired) {
    return {
      ok: false,
      userMessage: "Connect and pair with the host before applying the import plan."
    };
  }

  if (!request.importSessionId) {
    return {
      ok: false,
      userMessage: "No host import session is available yet. Select files on the host first."
    };
  }

  const plan: ImportAutomationPlan = buildImportAutomationPlanFromReviewedItems(request.reviewedItems);
  debugImportAutomation("reviewed_plan_built", {
    itemCount: plan.items.length,
    executableItemCount: plan.executableItems.length,
    suggestionActionCount: plan.suggestionActions.length
  });

  const { preparedPlan, report } = await executeImportAutomationPlanWithHostCommands(
    plan,
    request.importSessionId,
    commandClient
  );

  return {
    ok: true,
    plan,
    preparedPlan,
    report,
    logMessages: [
      plan.suggestionActions.length > 0
        ? `Sent ${plan.items.length} reviewed import item(s) to the host; ${plan.suggestionActions.length} suggestion-only post-import action(s) remained non-executable.`
        : `Sent ${plan.items.length} reviewed import item(s) to the host.`,
      plan.suggestionActions.length > 0
        ? "Ordering, grouping, routing, and stacking remain visible in review but stay suggestion-only until dedicated Logic host actions are added."
        : "All currently supported host actions are live for this review.",
      report.summary
    ]
  };
}
