import "dotenv/config";
import { createOpenAI } from "@ai-sdk/openai";
import { confirm, input, select } from "@inquirer/prompts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CreateMessageRequestSchema, Prompt, PromptMessage, Tool } from "@modelcontextprotocol/sdk/types.js";
import { generateText, jsonSchema, ToolSet } from "ai";

const mcp = new Client({
  name: "poke-trainer-client",
  version: "1.0.0",
});

const transport = new StdioClientTransport({
  command: "pnpm",
  args: ["--filter", "@pokedex/server", "start"],
});

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function main() {
  await mcp.connect(transport);

  const [{ tools: items }, { resources }, { resourceTemplates }] = await Promise.all([
    mcp.listTools(),
    mcp.listResources(),
    mcp.listResourceTemplates(),
  ]);

  mcp.setRequestHandler(CreateMessageRequestSchema, async (request) => {
    console.log("\nServer is asking for help from the AI...");
    const { text } = await generateText({
      model: openai("gpt-4o-mini"),
      prompt: request.params.messages[0].content.text,
    });
    return {
      role: "user",
      stopReason: "endTurn",
      content: { type: "text", text },
    };
  });

  console.log("Pokédex connection established!");
  while (true) {
    const option = await select({
      message: "What would you like to do?",
      choices: [
        { name: "🎒 Use Item", value: "Items" },
        { name: "📖 Check Pokédex Data", value: "Resources" },
        { name: "exit", value: "exit" },
      ],
    });
    
    if (option === 'exit') process.exit(0);

    switch (option) {
      case "Items":
        const itemName = await select({
          message: "Select an item to use",
          choices: items.map((item) => ({
            name: item.annotations?.title || item.name,
            value: item.name,
            description: item.description,
          })),
        });
        const item = items.find((i) => i.name === itemName);
        if (item) await handleItem(item);
        break;
      case "Resources":
        const allResources = [
          ...resources.map((r) => ({ ...r, isTemplate: false })),
          ...resourceTemplates.map((t) => ({ ...t, isTemplate: true })),
        ];
        const resourceIdentifier = await select({
          message: "Select a Pokédex resource",
          choices: allResources.map((r) => ({
            name: r.name,
            value: r.isTemplate ? r.uriTemplate : r.uri,
            description: r.description,
          })),
        });
        await handleResource(resourceIdentifier);
        break;
    }
    console.log("\n-----------------------------------\n");
  }
}

async function handleItem(item: Tool) {
  const args: Record<string, any> = {};
  if (item.inputSchema.properties) {
    for (const [key, value] of Object.entries(item.inputSchema.properties)) {
      args[key] = await input({ message: `Enter value for ${key} (${(value as any).type}):` });
    }
  }
  const res = await mcp.callTool({ name: item.name, arguments: args });
  console.log((res.content as [{ text: string }])[0].text);
}

async function handleResource(uri: string) {
  let finalUri = uri;
  const paramMatches = uri.match(/{([^}]+)}/g);

  if (paramMatches != null) {
    for (const paramMatch of paramMatches) {
      const paramName = paramMatch.slice(1, -1);
      const paramValue = await input({ message: `Enter value for Pokédex parameter ${paramName}:` });
      finalUri = finalUri.replace(paramMatch, paramValue);
    }
  }

  const res = await mcp.readResource({ uri: finalUri });
  console.log(JSON.stringify(JSON.parse(res.contents[0].text as string), null, 2));
}

main();