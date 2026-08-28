import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import type { FreeAgentClient } from "../client.js";
import { registerAccountingTools } from "./accounting.js";
import { registerAttachmentTools } from "./attachments.js";
import { registerBankingTools } from "./banking.js";
import { registerBillTools } from "./bills.js";
import { registerCategoryTools } from "./categories.js";
import { registerCompanyTools } from "./company.js";
import { registerContactTools } from "./contacts.js";
import { registerCreditNoteTools } from "./credit-notes.js";
import { registerEstimateTools } from "./estimates.js";
import { registerExpenseTools } from "./expenses.js";
import { registerInvoiceTools } from "./invoices.js";
import { registerProjectTools } from "./projects.js";
import { registerTaskTools } from "./tasks.js";
import { registerTimeslipTools } from "./timeslips.js";
import { registerUserTools } from "./users.js";

const REGISTRARS = [
  registerAccountingTools,
  registerAttachmentTools,
  registerBankingTools,
  registerBillTools,
  registerCategoryTools,
  registerCompanyTools,
  registerContactTools,
  registerCreditNoteTools,
  registerEstimateTools,
  registerExpenseTools,
  registerInvoiceTools,
  registerProjectTools,
  registerTaskTools,
  registerTimeslipTools,
  registerUserTools,
];

/**
 * An id that is interpolated into a request path. Anything that reaches
 * `/resource/${id}` unvalidated can walk out of the resource namespace, so
 * every one of these must be rejected by the tool's own input schema.
 */
const PATH_ESCAPES = ["../../users/me", "123/456", "123?admin=true", "https://evil.com"];

function collectIdParams(): Array<[string, string, z.ZodTypeAny]> {
  const found: Array<[string, string, z.ZodTypeAny]> = [];
  const server = {
    registerTool: vi.fn((name: string, config: any) => record(name, config?.inputSchema)),
    tool: vi.fn((...args: any[]) => {
      const schema = args.find(
        (a, i) => i > 0 && typeof a === "object" && a !== null && !Array.isArray(a)
      );
      record(args[0] as string, schema);
    }),
  } as any;

  function record(toolName: string, schema: unknown) {
    if (!schema || typeof schema !== "object") return;
    for (const [param, def] of Object.entries(schema as Record<string, unknown>)) {
      if (param.endsWith("_id")) found.push([toolName, param, def as z.ZodTypeAny]);
    }
  }

  const client = {} as FreeAgentClient;
  for (const register of REGISTRARS) register(server, client);
  return found;
}

describe("id parameters that reach a request path", () => {
  const idParams = collectIdParams();

  it("finds id parameters to check", () => {
    expect(idParams.length).toBeGreaterThan(0);
  });

  it.each(idParams)("%s rejects a path escape in %s", (_tool, _param, schema) => {
    expect(schema.safeParse("12345").success).toBe(true);
    for (const escape of PATH_ESCAPES) {
      expect(schema.safeParse(escape).success).toBe(false);
    }
  });
});
