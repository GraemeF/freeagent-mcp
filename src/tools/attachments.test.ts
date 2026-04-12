import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FreeAgentClient } from "../client.js";

// Mock fs/promises before importing the module under test
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  stat: vi.fn(),
  writeFile: vi.fn(),
}));

import { readFile, stat, writeFile } from "node:fs/promises";
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
  vi.clearAllMocks();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(stat).mockResolvedValue({ size: 1024 } as any);
  vi.mocked(readFile).mockResolvedValue(Buffer.from("fake-file-content"));
  vi.mocked(writeFile).mockResolvedValue(undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
  vi.restoreAllMocks();
});

describe("registerAttachmentTools", () => {
  it("registers 4 tools", () => {
    const { server, tools } = createMockServer();
    const client = createMockClient();
    registerAttachmentTools(server, client);
    expect(tools.size).toBe(4);
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

  const API_RESPONSE = {
    attachment: {
      url: "https://api.freeagent.com/v2/attachments/42",
      content_src: "https://s3.example.com/presigned?expires=30",
      content_src_medium: "https://s3.example.com/medium?expires=30",
      content_src_small: "https://s3.example.com/small?expires=30",
      expires_at: "2026-04-12T11:12:22.000Z",
      content_type: "application/pdf",
      file_name: "invoice.pdf",
      file_size: 92886,
      description: "invoice",
    },
  };

  it("calls client.get with correct path", async () => {
    const { handler, client } = getHandler();
    (client.get as any).mockResolvedValue(API_RESPONSE);

    await handler({ attachment_id: "42" });

    expect(client.get).toHaveBeenCalledWith("/attachments/42");
  });

  it("strips presigned content_src fields and expires_at from response", async () => {
    const { handler, client } = getHandler();
    (client.get as any).mockResolvedValue(API_RESPONSE);

    const result = await handler({ attachment_id: "42" });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.attachment).not.toHaveProperty("content_src");
    expect(parsed.attachment).not.toHaveProperty("content_src_medium");
    expect(parsed.attachment).not.toHaveProperty("content_src_small");
    expect(parsed.attachment).not.toHaveProperty("expires_at");
  });

  it("preserves non-URL metadata fields", async () => {
    const { handler, client } = getHandler();
    (client.get as any).mockResolvedValue(API_RESPONSE);

    const result = await handler({ attachment_id: "42" });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.attachment).toMatchObject({
      url: "https://api.freeagent.com/v2/attachments/42",
      content_type: "application/pdf",
      file_name: "invoice.pdf",
      file_size: 92886,
      description: "invoice",
    });
  });

  it("returns error when API call fails", async () => {
    const { handler, client } = getHandler();
    (client.get as any).mockRejectedValue(new Error("Not found"));

    const result = await handler({ attachment_id: "999" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: Not found");
  });
});

describe("freeagent_download_attachment", () => {
  function getHandler() {
    const { server, tools } = createMockServer();
    const client = createMockClient();
    registerAttachmentTools(server, client);
    return { handler: tools.get("freeagent_download_attachment")!, client };
  }

  const API_RESPONSE = {
    attachment: {
      url: "https://api.freeagent.com/v2/attachments/42",
      content_src: "https://s3.example.com/presigned",
      content_type: "application/pdf",
      file_name: "invoice.pdf",
      file_size: 92886,
      description: "invoice",
    },
  };

  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer,
    });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches attachment metadata from API", async () => {
    const { handler, client } = getHandler();
    (client.get as any).mockResolvedValue(API_RESPONSE);

    await handler({ attachment_id: "42", save_path: "/tmp/out.pdf" });

    expect(client.get).toHaveBeenCalledWith("/attachments/42");
  });

  it("fetches the presigned content_src URL", async () => {
    const { handler, client } = getHandler();
    (client.get as any).mockResolvedValue(API_RESPONSE);

    await handler({ attachment_id: "42", save_path: "/tmp/out.pdf" });

    expect(fetchSpy).toHaveBeenCalledWith("https://s3.example.com/presigned");
  });

  it("writes fetched bytes to save_path", async () => {
    const { handler, client } = getHandler();
    (client.get as any).mockResolvedValue(API_RESPONSE);

    await handler({ attachment_id: "42", save_path: "/tmp/out.pdf" });

    expect(writeFile).toHaveBeenCalledWith(
      "/tmp/out.pdf",
      expect.any(Buffer)
    );
    const writtenBuffer = vi.mocked(writeFile).mock.calls[0][1] as Buffer;
    expect(Array.from(writtenBuffer)).toEqual([0x25, 0x50, 0x44, 0x46]);
  });

  it("returns metadata without presigned URL", async () => {
    const { handler, client } = getHandler();
    (client.get as any).mockResolvedValue(API_RESPONSE);

    const result = await handler({ attachment_id: "42", save_path: "/tmp/out.pdf" });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed).toMatchObject({
      file_path: "/tmp/out.pdf",
      file_name: "invoice.pdf",
      content_type: "application/pdf",
      file_size: 92886,
    });
    expect(parsed).not.toHaveProperty("content_src");
  });

  it("rejects relative save_path", async () => {
    const { handler, client } = getHandler();
    (client.get as any).mockResolvedValue(API_RESPONSE);

    const result = await handler({ attachment_id: "42", save_path: "out.pdf" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/absolute/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns error when API call fails", async () => {
    const { handler, client } = getHandler();
    (client.get as any).mockRejectedValue(new Error("Not found"));

    const result = await handler({ attachment_id: "999", save_path: "/tmp/out.pdf" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error: Not found");
  });

  it("returns error when presigned fetch fails", async () => {
    const { handler, client } = getHandler();
    (client.get as any).mockResolvedValue(API_RESPONSE);
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      arrayBuffer: async () => new ArrayBuffer(0),
    });

    const result = await handler({ attachment_id: "42", save_path: "/tmp/out.pdf" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/403/);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("returns error when writeFile fails", async () => {
    const { handler, client } = getHandler();
    (client.get as any).mockResolvedValue(API_RESPONSE);
    vi.mocked(writeFile).mockRejectedValue(new Error("EACCES"));

    const result = await handler({ attachment_id: "42", save_path: "/tmp/out.pdf" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/EACCES/);
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
