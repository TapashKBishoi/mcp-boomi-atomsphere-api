import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import axios from "axios";
import { z } from "zod";
import fs from "fs";
import { XMLParser } from "fast-xml-parser"; // XML parsing library

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
  const auth = { username: BOOMI_USER, password: BOOMI_TOKEN };
  
  try {
    const response = await axios({ url, method, auth, data, timeout: 10000 });
    return response.data;
  } catch (error) {
    console.error("Boomi API Error:", error.message);
    return { error: "Failed to communicate with Boomi API.", details: error.message };
  }
};

// Create MCP server
const server = new McpServer({ name: "Demo", version: "1.0.0" });

// Register `queryDeploymentStatus` tool (Fix: Ensure it is defined before server starts)
server.tool("queryDeploymentStatus", { 
  context: z.object({ environmentId: z.string() }) 
}, async ({ context }) => {
  let environmentId = context.environmentId;
  if (environmentId === "test") {
    console.error(`Client passed 'test' as environmentId. Using static value: ${ENVIRONMENT_ID}`);
    environmentId = ENVIRONMENT_ID;
  }

  const endpoint = `${ACCOUNT_ID}/Deployment/query`;
  const data = {
    QueryFilter: {
      expression: {
        operator: "and",
        nestedExpression: [
          { argument: [environmentId], operator: "EQUALS", property: "environmentId" },
          { argument: [false], operator: "EQUALS", property: "current" },
        ],
      },
    },
  };
  
  const result = await callBoomiApi(endpoint, "POST", data);
  if (result.error) {
    return { content: [{ type: "text", text: `Error: ${result.error}` }] };
  }
  
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
});

// Register `getComponentDetails` tool
server.tool("getComponentDetails", { 
  context: z.object({ componentId: z.string() }) 
}, async ({ context }) => {
  const { componentId } = context;

  if (!validateStaticValues()) {
    return { content: [{ type: "text", text: "Error: Missing required static authentication values." }] };
  }

  const endpoint = `${ACCOUNT_ID}/Component/${componentId}`;

  try {
    const url = `https://api.boomi.com/api/rest/v1/${endpoint}`;
    const auth = { username: BOOMI_USER, password: BOOMI_TOKEN };

    // Fetch the XML response from Boomi API
    const response = await axios.get(url, { auth });
    const rawXML = response.data;
    console.error("Raw XML Response:", rawXML);

    // Save full XML response to disk
    const filePath = `C:\\boomi_devlopments\\${componentId}.xml`;
    fs.writeFileSync(filePath, rawXML, { encoding: "utf8" });
    console.error(`Full XML file saved to disk: ${filePath}`);

    // Parse XML to JSON
    const parser = new XMLParser({ ignoreAttributes: false });
    const jsonResponse = parser.parse(rawXML);

    // Extract component details
    const component = jsonResponse["bns:Component"];
    const componentType = component?.type || "unknown";

    // Handle response based on component type
    if (componentType.includes("process") || componentType.includes("profile")) {
      const summary = {
        id: component.componentId,
        name: component.name,
        type: component.type,
        version: component.version,
        createdBy: component.createdBy,
        createdDate: component.createdDate,
        modifiedBy: component.modifiedBy,
        modifiedDate: component.modifiedDate,
        currentVersion: component.currentVersion,
        description: component.description || "No description available.",
      };

      return {
        content: [{ 
          type: "text", 
          text: `Summary response for ${componentType}:\n${JSON.stringify(summary, null, 2).replace(/\n/g, "\\n")}\nFull XML saved at: ${filePath}`
        }]
      };
    } else {
      return {
        content: [{ type: "text", text: `Full XML response for ${componentType}:\n${rawXML}\nFile saved at: ${filePath}` }]
      };
    }
  } catch (error) {
    console.error("Error:", error.message);
    return { content: [{ type: "text", text: `Error: ${error.message}` }] };
  }
});

// Define a dynamic greeting resource
server.resource("greeting", new ResourceTemplate("greeting://{name}", { list: undefined }), async (uri, variables) => {
  const name = Array.isArray(variables.name) ? variables.name[0] : variables.name;
  if (typeof name !== "string") {
    throw new Error("Invalid 'name' type in variables");
  }
  return { contents: [{ uri: uri.href, text: `Hello, ${name}!` }] };
});

// Start the server using Stdio transport
const transport = new StdioServerTransport();

async function startServer() {
  try {
    validateStaticValues();
    await server.connect(transport);
    console.error("MCP server is running");
    setInterval(() => {}, 1000);
  } catch (error) {
    console.error("Failed to start MCP server:", error.message);
    process.exit(1);
  }
}

// Handle unexpected shutdowns
process.on("exit", (code) => console.error(`Server exited with code: ${code}.`));
process.on("uncaughtException", (err) => { console.error(`Uncaught Exception: ${err.message}`); process.exit(1); });
process.on("unhandledRejection", (reason, promise) => { console.error('Unhandled Rejection:', reason); process.exit(1); });
process.on("SIGINT", () => { console.error("Process interrupted. Shutting down..."); process.exit(0); });

// Start the server
startServer();
