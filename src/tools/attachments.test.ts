import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FreeAgentClient } from "../client.js";

// Mock fs/promises before importing the module under test
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  stat: vi.fn(),
}));

import { readFile, stat } from "node:fs/promises";
import { registerAttachmentTools } from "./attachments.js";

type ToolHandler = (...args: any[]) => any;

function createMockServer() {
  const tools = new Map<string, ToolHandler>();
  return {
    server: {
      registerTool: vi.fn(
        (name: string, _config: unknown, cb: ToolHandler) => {
          tools.set(name, cb);
        }
      ),
      tool: vi.fn((...args: any[]) => {
        const name = args[0] as string;
        const cb = typeof args[2] === "function" ? args[2] : args[3];
        tools.set(name, cb);
      }),
    } as any,
    tools,
  };
}

function createMockClient() {
  return {
    get: vi.fn().mockResolvedValue({ data: "mock" }),
    postJson: vi.fn().mockResolvedValue({ data: "mock" }),
    putJson: vi.fn().mockResolvedValue({ data: "mock" }),
    postForm: vi.fn().mockResolvedValue({ data: "mock" }),
    putForm: vi.fn().mockResolvedValue({ data: "mock" }),
    patchJson: vi.fn().mockResolvedValue({ data: "mock" }),
    deleteReq: vi.fn().mockResolvedValue({ data: "mock" }),
  } as unknown as FreeAgentClient;
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(stat).mockResolvedValue({ size: 1024 } as any);
  vi.mocked(readFile).mockResolvedValue(Buffer.from("fake-file-content"));
});

afterEach(() => {
  errorSpy.mockRestore();
  vi.restoreAllMocks();
});

describe("registerAttachmentTools", () => {
  it("registers 3 tools", () => {
    const { server, tools } = createMockServer();
    const client = createMockClient();
    registerAttachmentTools(server, client);
    expect(tools.size).toBe(3);
  });
});

describe("freeagent_upload_attachment", () => {
  function getHandler() {
    const { server, tools } = createMockServer();
    const client = createMockClient();
    registerAttachmentTools(server, client);
    return { handler: tools.get("freeagent_upload_attachment")!, client };
  }

  it("uploads to expense with correct URL and wrapper key", async () => {
    const { handler, client } = getHandler();

    await handler({
      resource_type: "expense",
      resource_id: "123",
      file_path: "/tmp/receipt.png",
      description: "Receipt",
    });

    expect(client.putJson).toHaveBeenCalledWith(
      "/expenses/123",
      expect.objectContaining({
        expense: expect.objectContaining({
          attachment: expect.objectContaining({
            file_name: "receipt.png",
            content_type: "image/png",
            description: "Receipt",
          }),
        }),
      })
    );
  });

  it("uploads to bill with correct URL and wrapper key", async () => {
    const { handler, client } = getHandler();

    await handler({
      resource_type: "bill",
      resource_id: "456",
      file_path: "/tmp/invoice.pdf",
      description: "Supplier invoice",
    });

    expect(client.putJson).toHaveBeenCalledWith(
      "/bills/456",
      expect.objectContaining({
        bill: expect.objectContaining({
          attachment: expect.objectContaining({
            file_name: "invoice.pdf",
            content_type: "application/x-pdf",
          }),
        }),
      })
    );
  });

  it("uploads to bank_transaction_explanation with correct URL and wrapper key", async () => {
    const { handler, client } = getHandler();

    await handler({
      resource_type: "bank_transaction_explanation",
      resource_id: "789",
      file_path: "/tmp/receipt.jpg",
      description: "Bank receipt",
    });

    expect(client.putJson).toHaveBeenCalledWith(
      "/bank_transaction_explanations/789",
      expect.objectContaining({
        bank_transaction_explanation: expect.objectContaining({
          attachment: expect.objectContaining({
            file_name: "receipt.jpg",
            content_type: "image/jpeg",
          }),
        }),
      })
    );
  });

  it("base64 encodes the file content", async () => {
    const fileContent = Buffer.from("hello world");
    vi.mocked(readFile).mockResolvedValue(fileContent);
    const { handler, client } = getHandler();

    await handler({
      resource_type: "expense",
      resource_id: "123",
      file_path: "/tmp/receipt.png",
      description: "Receipt",
    });

    expect(client.putJson).toHaveBeenCalledWith(
      "/expenses/123",
      expect.objectContaining({
        expense: expect.objectContaining({
          attachment: expect.objectContaining({
            data: fileContent.toString("base64"),
          }),
        }),
      })
    );
  });

  it("infers content type from .jpeg extension", async () => {
    const { handler, client } = getHandler();

    await handler({
      resource_type: "expense",
      resource_id: "123",
      file_path: "/tmp/photo.jpeg",
      description: "Photo",
    });

    expect(client.putJson).toHaveBeenCalledWith(
      "/expenses/123",
      expect.objectContaining({
        expense: expect.objectContaining({
          attachment: expect.objectContaining({
            content_type: "image/jpeg",
          }),
        }),
      })
    );
  });

  it("infers content type from .gif extension", async () => {
    const { handler, client } = getHandler();

    await handler({
      resource_type: "expense",
      resource_id: "123",
      file_path: "/tmp/anim.gif",
      description: "Animation",
    });

    expect(client.putJson).toHaveBeenCalledWith(
      "/expenses/123",
      expect.objectContaining({
        expense: expect.objectContaining({
          attachment: expect.objectContaining({
            content_type: "image/gif",
          }),
        }),
      })
    );
  });

  it("applies content_type override", async () => {
    const { handler, client } = getHandler();

    await handler({
      resource_type: "expense",
      resource_id: "123",
      file_path: "/tmp/receipt.pdf",
      description: "Receipt",
      content_type: "image/png",
    });

    expect(client.putJson).toHaveBeenCalledWith(
      "/expenses/123",
      expect.objectContaining({
        expense: expect.objectContaining({
          attachment: expect.objectContaining({
            content_type: "image/png",
          }),
        }),
      })
    );
  });

  it("applies file_name override", async () => {
    const { handler, client } = getHandler();

    await handler({
      resource_type: "expense",
      resource_id: "123",
      file_path: "/tmp/tmpdownload_abc123.pdf",
      description: "Receipt",
      file_name: "receipt-2026-04.pdf",
    });

    expect(client.putJson).toHaveBeenCalledWith(
      "/expenses/123",
      expect.objectContaining({
        expense: expect.objectContaining({
          attachment: expect.objectContaining({
            file_name: "receipt-2026-04.pdf",
          }),
        }),
      })
    );
  });

  it("rejects files over 5MB", async () => {
    vi.mocked(stat).mockResolvedValue({ size: 6 * 1024 * 1024 } as any);
    const { handler } = getHandler();

    const result = await handler({
      resource_type: "expense",
      resource_id: "123",
      file_path: "/tmp/huge.png",
      description: "Too big",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/5.*MB/i);
  });

  it("rejects unrecognised file extension with no content_type override", async () => {
    const { handler } = getHandler();

    const result = await handler({
      resource_type: "expense",
      resource_id: "123",
      file_path: "/tmp/document.docx",
      description: "Word doc",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/content.type/i);
  });

  it("rejects invalid content_type override", async () => {
    const { handler } = getHandler();

    const result = await handler({
      resource_type: "expense",
      resource_id: "123",
      file_path: "/tmp/receipt.pdf",
      description: "Receipt",
      content_type: "text/plain",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/content.type/i);
  });

  it("returns error when file read fails", async () => {
    vi.mocked(readFile).mockRejectedValue(new Error("ENOENT: no such file"));
    const { handler } = getHandler();

    const result = await handler({
      resource_type: "expense",
      resource_id: "123",
      file_path: "/tmp/missing.png",
      description: "Gone",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/ENOENT/);
  });

  it("returns error when API call fails", async () => {
    const { handler, client } = getHandler();
    (client.putJson as any).mockRejectedValue(new Error("Unauthorized"));

    const result = await handler({
      resource_type: "expense",
      resource_id: "123",
      file_path: "/tmp/receipt.png",
      description: "Receipt",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: Unauthorized");
  });
});

describe("freeagent_get_attachment", () => {
  function getHandler() {
    const { server, tools } = createMockServer();
    const client = createMockClient();
    registerAttachmentTools(server, client);
    return { handler: tools.get("freeagent_get_attachment")!, client };
  }

  it("calls client.get with correct path", async () => {
    const { handler, client } = getHandler();

    await handler({ attachment_id: "42" });

    expect(client.get).toHaveBeenCalledWith("/attachments/42");
  });

  it("returns jsonResponse with API data", async () => {
    const { handler } = getHandler();

    const result = await handler({ attachment_id: "42" });

    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text)).toEqual({ data: "mock" });
  });

  it("returns error when API call fails", async () => {
    const { handler, client } = getHandler();
    (client.get as any).mockRejectedValue(new Error("Not found"));

    const result = await handler({ attachment_id: "999" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: Not found");
  });
});

describe("freeagent_delete_attachment", () => {
  function getHandler() {
    const { server, tools } = createMockServer();
    const client = createMockClient();
    registerAttachmentTools(server, client);
    return { handler: tools.get("freeagent_delete_attachment")!, client };
  }

  it("calls client.deleteReq with correct path", async () => {
    const { handler, client } = getHandler();

    await handler({ attachment_id: "42" });

    expect(client.deleteReq).toHaveBeenCalledWith("/attachments/42");
  });

  it("returns jsonResponse on success", async () => {
    const { handler } = getHandler();

    const result = await handler({ attachment_id: "42" });

    expect(result.content[0].type).toBe("text");
  });

  it("returns error when API call fails", async () => {
    const { handler, client } = getHandler();
    (client.deleteReq as any).mockRejectedValue(new Error("Forbidden"));

    const result = await handler({ attachment_id: "42" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: Forbidden");
  });
});
