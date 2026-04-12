import path from "node:path";
import { readFile, stat, writeFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FreeAgentClient } from "../client.js";
import { jsonResponse, errorResponse, logToolCall } from "../utils.js";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const CONTENT_TYPE_MAP: Record<string, string> = {
  ".pdf": "application/x-pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
};

const ACCEPTED_CONTENT_TYPES = new Set([
  "image/png",
  "image/x-png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "application/x-pdf",
]);

const PRESIGNED_FIELDS = [
  "content_src",
  "content_src_medium",
  "content_src_small",
  "expires_at",
] as const;

function stripPresignedFields(
  attachment: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attachment)) {
    if (!(PRESIGNED_FIELDS as readonly string[]).includes(k)) {
      result[k] = v;
    }
  }
  return result;
}

const RESOURCE_CONFIG: Record<string, { urlPath: string; wrapperKey: string }> =
  {
    expense: { urlPath: "expenses", wrapperKey: "expense" },
    bill: { urlPath: "bills", wrapperKey: "bill" },
    bank_transaction_explanation: {
      urlPath: "bank_transaction_explanations",
      wrapperKey: "bank_transaction_explanation",
    },
  };

export function registerAttachmentTools(
  server: McpServer,
  client: FreeAgentClient
): void {
  server.tool(
    "freeagent_upload_attachment",
    "Upload a file attachment to an existing FreeAgent expense, bill, or bank transaction explanation",
    {
      resource_type: z
        .enum(["expense", "bill", "bank_transaction_explanation"])
        .describe("The type of resource to attach the file to"),
      resource_id: z
        .string()
        .describe("The ID of the parent resource"),
      file_path: z
        .string()
        .describe("Absolute path to the file on disk"),
      description: z
        .string()
        .describe("Description of the attachment"),
      content_type: z
        .string()
        .optional()
        .describe(
          "Override inferred content type (e.g. application/x-pdf). Accepted: image/png, image/x-png, image/jpeg, image/jpg, image/gif, application/x-pdf"
        ),
      file_name: z
        .string()
        .optional()
        .describe("Override the filename (defaults to basename of file_path)"),
    },
    async ({ resource_type, resource_id, file_path, description, content_type, file_name }) => {
      logToolCall("freeagent_upload_attachment", {
        resource_type,
        resource_id,
        file_path,
        description,
      });
      try {
        const fileStat = await stat(file_path);
        if (fileStat.size > MAX_FILE_SIZE) {
          return errorResponse(
            new Error(
              `File is ${(fileStat.size / (1024 * 1024)).toFixed(1)} MB — exceeds 5 MB limit`
            )
          );
        }

        const resolvedContentType =
          content_type ?? CONTENT_TYPE_MAP[path.extname(file_path).toLowerCase()];
        if (!resolvedContentType) {
          return errorResponse(
            new Error(
              `Cannot infer content type from extension "${path.extname(file_path)}". ` +
                "Provide a content_type override. " +
                `Accepted: ${[...ACCEPTED_CONTENT_TYPES].join(", ")}`
            )
          );
        }
        if (!ACCEPTED_CONTENT_TYPES.has(resolvedContentType)) {
          return errorResponse(
            new Error(
              `Content type "${resolvedContentType}" is not accepted by FreeAgent. ` +
                `Accepted: ${[...ACCEPTED_CONTENT_TYPES].join(", ")}`
            )
          );
        }

        const fileData = await readFile(file_path);
        const data = Buffer.from(fileData).toString("base64");

        const config = RESOURCE_CONFIG[resource_type];
        const attachment = {
          data,
          file_name: file_name ?? path.basename(file_path),
          content_type: resolvedContentType,
          description,
        };

        const result = await client.putJson(
          `/${config.urlPath}/${resource_id}`,
          { [config.wrapperKey]: { attachment } }
        );
        return jsonResponse(result);
      } catch (error) {
        return errorResponse(error);
      }
    }
  );

  server.tool(
    "freeagent_get_attachment",
    "Retrieve attachment metadata (file_name, content_type, file_size, description) from FreeAgent. Use freeagent_download_attachment to fetch the file contents.",
    {
      attachment_id: z
        .string()
        .describe("The ID of the attachment to retrieve"),
    },
    async ({ attachment_id }) => {
      logToolCall("freeagent_get_attachment", { attachment_id });
      try {
        const data = (await client.get(
          `/attachments/${attachment_id}`
        )) as { attachment?: Record<string, unknown> };
        return jsonResponse({
          attachment: stripPresignedFields(data.attachment ?? {}),
        });
      } catch (error) {
        return errorResponse(error);
      }
    }
  );

  server.tool(
    "freeagent_download_attachment",
    "Download a FreeAgent attachment to disk. Writes the file bytes to save_path (must be an absolute path — ~ is not expanded). Returns file metadata including where it was saved.",
    {
      attachment_id: z
        .string()
        .describe("The ID of the attachment to download"),
      save_path: z
        .string()
        .describe(
          "Absolute path where the file will be written (e.g. /tmp/invoice.pdf). Tilde (~) is not expanded."
        ),
    },
    async ({ attachment_id, save_path }) => {
      logToolCall("freeagent_download_attachment", {
        attachment_id,
        save_path,
      });
      try {
        if (!path.isAbsolute(save_path)) {
          return errorResponse(
            new Error(
              `save_path must be absolute, got "${save_path}" — tilde (~) is not expanded`
            )
          );
        }

        const data = (await client.get(
          `/attachments/${attachment_id}`
        )) as { attachment?: Record<string, unknown> };
        const attachment = data.attachment ?? {};
        const contentSrc = attachment.content_src as string | undefined;
        if (!contentSrc) {
          return errorResponse(
            new Error("Attachment response missing content_src")
          );
        }

        const response = await fetch(contentSrc);
        if (!response.ok) {
          return errorResponse(
            new Error(
              `Failed to fetch attachment: ${response.status} ${response.statusText ?? ""}`.trim()
            )
          );
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        await writeFile(save_path, buffer);

        return jsonResponse({
          file_path: save_path,
          file_name: attachment.file_name,
          content_type: attachment.content_type,
          file_size: attachment.file_size,
          description: attachment.description,
        });
      } catch (error) {
        return errorResponse(error);
      }
    }
  );

  server.tool(
    "freeagent_delete_attachment",
    "Delete an attachment from FreeAgent",
    {
      attachment_id: z
        .string()
        .describe("The ID of the attachment to delete"),
    },
    async ({ attachment_id }) => {
      logToolCall("freeagent_delete_attachment", { attachment_id });
      try {
        const data = await client.deleteReq(`/attachments/${attachment_id}`);
        return jsonResponse(data);
      } catch (error) {
        return errorResponse(error);
      }
    }
  );
}
