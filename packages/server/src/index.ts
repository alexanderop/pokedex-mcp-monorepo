import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CreateMessageResultSchema } from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import { z } from "zod";

const server = new McpServer({
  name: "pokedex-server",
  version: "1.0.0",
  capabilities: { resources: {}, tools: {}, prompts: {} },
});

// RESOURCE: Get all Pokémon
server.resource(
  "pokemon-list",
  "pokedex://all",
  {
    description: "Get all Pokémon data from the Pokédex",
    title: "All Pokémon",
    mimeType: "application/json",
  },
  async (uri) => {
    const allPokemon = await import("./data/pokedex.json", {
      with: { type: "json" },
    }).then((m) => m.default);
    return {
      contents: [{
        uri: uri.href,
        text: JSON.stringify(allPokemon),
        mimeType: "application/json",
      }],
    };
  }
);

// RESOURCE TEMPLATE: Get a single Pokémon by its ID
server.resource(
  "pokedex-entry",
  new ResourceTemplate("pokedex://{pokemonId}/entry", { list: undefined }),
  {
    description: "Get a specific Pokémon's details from the Pokédex",
    title: "Pokédex Entry",
    mimeType: "application/json",
  },
  async (uri, { pokemonId }) => {
    const allPokemon = await import("./data/pokedex.json", {
      with: { type: "json" },
    }).then((m) => m.default);
    const pokemonEntry = allPokemon.find((p) => p.id === parseInt(pokemonId as string));
    if (pokemonEntry == null) {
      return { contents: [{ uri: uri.href, text: JSON.stringify({ error: "Pokémon not found" }) }] };
    }
    return { contents: [{ uri: uri.href, text: JSON.stringify(pokemonEntry) }] };
  }
);

// TOOL: Add a new Pokémon to the Pokédex
server.tool(
  "catch-pokemon",
  "Add a new, caught Pokémon to the Pokédex.",
  {
    name: z.string(),
    type: z.string(),
    region: z.string(),
    abilities: z.string(),
  },
  { title: "Catch Pokémon" },
  async (params) => {
    try {
      const id = await catchPokemon(params);
      return { content: [{ type: "text", text: `Pokémon with ID ${id} caught successfully!` }] };
    } catch {
      return { content: [{ type: "text", text: "Failed to add Pokémon to Pokédex" }] };
    }
  }
);

// TOOL WITH SAMPLING: Discover and catch a new, AI-generated Pokémon
server.tool(
  "discover-wild-pokemon",
  "Discover and catch a wild Pokémon with AI-generated data",
  { title: "Discover Wild Pokémon" },
  async () => {
    const res = await server.server.request(
      {
        method: "sampling/createMessage",
        params: {
          messages: [{
            role: "user",
            content: {
              type: "text",
              text: "Generate a new, plausible Pokémon. It should have a creative name, one or two types (from standard Pokémon types), a region of origin, and a list of abilities. Return this data as a JSON object with keys `name`, `type`, `region`, and `abilities`. Provide only the raw JSON, no other text or markdown.",
            },
          }],
          maxTokens: 1024,
        },
      },
      CreateMessageResultSchema
    );

    if (res.content.type !== "text") {
      return { content: [{ type: "text", text: "Failed to discover a wild Pokémon" }] };
    }

    try {
      const wildPokemon = JSON.parse(res.content.text.trim().replace(/^```json/, "").replace(/```$/, "").trim());
      const id = await catchPokemon(wildPokemon);
      return { content: [{ type: "text", text: `A wild ${wildPokemon.name} appeared and was caught! ID: ${id}` }] };
    } catch {
      return { content: [{ type: "text", text: "The wild Pokémon got away..." }] };
    }
  }
);

async function catchPokemon(pokemon: { name: string; type: string; region: string; abilities: string }) {
  const allPokemon = await import("./data/pokedex.json", {
    with: { type: "json" },
  }).then((m) => m.default);
  const maxId = allPokemon.reduce((max, p) => (p.id > max ? p.id : max), 0);
  const id = maxId + 1;
  allPokemon.push({ id, ...pokemon } as any);
  await fs.writeFile("./src/data/pokedex.json", JSON.stringify(allPokemon, null, 2));
  return id;
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main();