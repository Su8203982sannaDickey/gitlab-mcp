#!/usr/bin/env node

/**
 * GitLab MCP Server - Main Entry Point
 *
 * Implements the Model Context Protocol (MCP) server for GitLab integration,
 * exposing GitLab API capabilities as MCP tools for AI assistants.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";
import { GitLabClient } from "./gitlab/client.js";
import { toolDefinitions } from "./tools/definitions.js";
import { toolHandlers } from "./tools/handlers.js";

// Load environment variables from .env file if present
dotenv.config();

const GITLAB_PERSONAL_ACCESS_TOKEN = process.env.GITLAB_PERSONAL_ACCESS_TOKEN;
const GITLAB_API_URL =
  process.env.GITLAB_API_URL ?? "https://gitlab.com/api/v4";
const GITLAB_READ_ONLY_MODE =
  process.env.GITLAB_READ_ONLY_MODE === "true" ?? false;

if (!GITLAB_PERSONAL_ACCESS_TOKEN) {
  console.error(
    "Error: GITLAB_PERSONAL_ACCESS_TOKEN environment variable is required."
  );
  process.exit(1);
}

/**
 * Initialise the GitLab API client shared across all tool handlers.
 */
const gitlabClient = new GitLabClient({
  token: GITLAB_PERSONAL_ACCESS_TOKEN,
  apiUrl: GITLAB_API_URL,
  readOnly: GITLAB_READ_ONLY_MODE,
});

/**
 * Create and configure the MCP server instance.
 */
const server = new Server(
  {
    name: "gitlab-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * Register the list-tools handler — returns all available GitLab tools.
 * When read-only mode is enabled, mutating tools are filtered out.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = GITLAB_READ_ONLY_MODE
    ? toolDefinitions.filter((t) => t.readOnly === true)
    : toolDefinitions;

  return { tools: tools.map(({ readOnly: _readOnly, ...rest }) => rest) };
});

/**
 * Register the call-tool handler — dispatches incoming tool calls to the
 * appropriate handler function, passing the shared GitLab client.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const handler = toolHandlers[name];
  if (!handler) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    return await handler(gitlabClient, args ?? {});
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred";
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

/**
 * Start the server using stdio transport so it can be driven by an MCP host
 * (e.g. Claude Desktop, Cursor, or any MCP-compatible client).
 */
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("GitLab MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
