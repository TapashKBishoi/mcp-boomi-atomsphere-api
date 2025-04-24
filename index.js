import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import axios from "axios";
import { z } from "zod";
import fs from "fs";

// Static authentication details
const BOOMI_USER = "";
const BOOMI_TOKEN = "";
const ACCOUNT_ID = "";
const ENVIRONMENT_ID = "";

// Validate static authentication details
function validateStaticValues() {
  const missingVars = [];
  
  if (!BOOMI_USER) missingVars.push("BOOMI_USER");
  if (!BOOMI_TOKEN) missingVars.push("BOOMI_TOKEN");
  if (!ACCOUNT_ID) missingVars.push("ACCOUNT_ID");
  if (!ENVIRONMENT_ID) missingVars.push("ENVIRONMENT_ID");
  
  if (missingVars.length > 0) {
    const message = `Missing required static authentication values: ${missingVars.join(", ")}`;
    console.error(message);
    
    // Log missing variables for debugging purposes
    try {
      fs.writeFileSync("env_missing.txt", `${message}\nPlease verify these static values.`);
    } catch (err) {
      console.error("Could not write warning file:", err.message);
    }
    
    return false;
  }
  
  console.error("Static authentication values validated successfully.");
  return true;
}

// Function to call Boomi API with better error handling
const callBoomiApi = async (endpoint, method, data) => {
  if (!validateStaticValues()) {
    return { error: "Missing static values. Check env_missing.txt for details." };
  }
  
  const url = `https://api.boomi.com/api/rest/v1/${endpoint}`;
  const auth = {
    username: BOOMI_USER,
    password: BOOMI_TOKEN,
  };
  
  try {
    const response = await axios({
      url,
      method,
      auth,
      data,
      timeout: 10000,
    });
    return response.data;
  } catch (error) {
    const errorDetails = {
      message: "Error calling Boomi API",
      endpoint,
      status: error.response?.status,
      statusText: error.response?.statusText,
      error: error.message
    };
    
    console.error("Boomi API Error:", JSON.stringify(errorDetails, null, 2));
    return { error: "Failed to communicate with Boomi API.", details: errorDetails };
  }
};

// Create MCP server
const server = new McpServer({
  name: "Demo",
  version: "1.0.0",
});

// Register a tool for querying deployment status
server.tool("queryDeploymentStatus", { 
  context: z.object({ environmentId: z.string() }) 
}, async ({ context }) => {
  // Determine the environmentId to use
  const clientEnvironmentId = context.environmentId;
  let environmentId;

  if (clientEnvironmentId === "test") {
    console.error(`Client passed 'test' as environmentId. Using static value: ${ENVIRONMENT_ID}`);
    environmentId = ENVIRONMENT_ID;
  } else {
    environmentId = clientEnvironmentId;
    console.error(`Client passed valid environmentId: ${environmentId}.`);
  }

  const endpoint = `${ACCOUNT_ID}/Deployment/query`;
  const data = {
    QueryFilter: {
      expression: {
        operator: "and",
        nestedExpression: [
          {
            argument: [environmentId],
            operator: "EQUALS",
            property: "environmentId",
          },
          {
            argument: [false],
            operator: "EQUALS",
            property: "current",
          },
        ],
      },
    },
  };

  const result = await callBoomiApi(endpoint, "POST", data);

  if (result.error) {
    return { 
      content: [{ 
        type: "text", 
        text: `Error: ${result.error}\n${JSON.stringify(result.details || {}, null, 2)}` 
      }] 
    };
  }
  
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

// Define a dynamic greeting resource
server.resource(
  "greeting",
  new ResourceTemplate("greeting://{name}", { list: undefined }),
  async (uri, variables) => {
    const name = Array.isArray(variables.name) ? variables.name[0] : variables.name;
    if (typeof name !== "string") {
      throw new Error("Invalid 'name' type in variables");
    }
    return {
      contents: [{ uri: uri.href, text: `Hello, ${name}!` }],
    };
  }
);

// Start the server using Stdio transport
const transport = new StdioServerTransport();

// Improved server startup function
async function startServer() {
  try {
    validateStaticValues();
    
    // Connect the server to the transport
    await server.connect(transport);
    
    console.error("MCP server is running");
    
    // Keep process alive indefinitely
    setInterval(() => {}, 1000);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Failed to start MCP server: ${error.message}`);
    } else {
      console.error("An unknown error occurred:", error);
    }
    process.exit(1); // Exit with error code
  }
}

// Handle unexpected shutdowns and errors
process.on("exit", (code) => {
  console.error(`Server exited with code: ${code}.`);
});

process.on("uncaughtException", (err) => {
  console.error(`Uncaught Exception: ${err.message}`, err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on("SIGINT", () => {
  console.error("Process interrupted (SIGINT). Shutting down...");
  process.exit(0);
});

// Start the server
startServer();