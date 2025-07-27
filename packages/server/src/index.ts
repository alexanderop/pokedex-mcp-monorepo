import {
  McpServer,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CreateMessageResultSchema } from '@modelcontextprotocol/sdk/types.js';
import fs from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';

const execAsync = promisify(exec);

// Log level management
let currentLogLevel = 'info';
const logLevels = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'];
const logLevelPriority = Object.fromEntries(logLevels.map((level, index) => [level, index]));

const server = new McpServer({
  name: 'pokedex-server',
  version: '1.0.0',
  capabilities: { resources: {}, tools: {}, prompts: {}, logging: {} },
});

// Track if we have an active connection
let isConnected = false;

// Logging helper - only sends notifications if connected
function log(level: string, logger: string, data: any) {
  // Always log to console for debugging
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level.toUpperCase()}] [${logger}]`, JSON.stringify(data));
  
  // Don't attempt to send MCP notifications - the SDK doesn't support it properly
  // The logging capability is declared but notifications fail with "Server does not support logging"
}

// Note: The MCP SDK doesn't expose a way to handle logging/setLevel requests 
// directly on the server object. This would need to be implemented differently
// based on the SDK's internal structure.

// RESOURCE: Get all Pokémon
server.resource(
  'pokemon-list',
  'pokedex://all',
  {
    description: 'Get all Pokémon data from the Pokédex',
    title: 'All Pokémon',
    mimeType: 'application/json',
  },
  async (uri) => {
    log('debug', 'resources', { action: 'fetch', resource: 'pokemon-list' });
    const allPokemon = await import('./data/pokedex.json', {
      with: { type: 'json' },
    }).then((m) => m.default);
    log('info', 'resources', { message: `Retrieved ${allPokemon.length} Pokémon` });
    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(allPokemon),
          mimeType: 'application/json',
        },
      ],
    };
  }
);

// RESOURCE TEMPLATE: Get a single Pokémon by its ID
server.resource(
  'pokedex-entry',
  new ResourceTemplate('pokedex://{pokemonId}/entry', { list: undefined }),
  {
    description: "Get a specific Pokémon's details from the Pokédex",
    title: 'Pokédex Entry',
    mimeType: 'application/json',
  },
  async (uri, { pokemonId }) => {
    log('debug', 'resources', { action: 'fetch', resource: 'pokemon-entry', pokemonId });
    const allPokemon = await import('./data/pokedex.json', {
      with: { type: 'json' },
    }).then((m) => m.default);
    const pokemonEntry = allPokemon.find(
      (p) => p.id === parseInt(pokemonId as string)
    );
    if (pokemonEntry == null) {
      log('warning', 'resources', { message: `Pokémon not found: ${pokemonId}` });
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify({ error: 'Pokémon not found' }),
          },
        ],
      };
    }
    log('info', 'resources', { message: `Retrieved Pokémon: ${pokemonEntry.name}` });
    return {
      contents: [{ uri: uri.href, text: JSON.stringify(pokemonEntry) }],
    };
  }
);

// TOOL: Add a new Pokémon to the Pokédex
server.tool(
  'catch-pokemon',
  'Add a new, caught Pokémon to the Pokédex.',
  {
    name: z.string(),
    type: z.string(),
    region: z.string(),
    abilities: z.string(),
  },
  { title: 'Catch Pokémon' },
  async (params) => {
    log('info', 'tools', { action: 'catch-pokemon', pokemon: params.name });
    try {
      const id = await catchPokemon(params);
      log('info', 'tools', { message: `Successfully caught ${params.name} with ID ${id}` });
      return {
        content: [
          { type: 'text', text: `Pokémon with ID ${id} caught successfully!` },
        ],
      };
    } catch (error) {
      log('error', 'tools', { action: 'catch-pokemon', error: error instanceof Error ? error.message : String(error) });
      return {
        content: [{ type: 'text', text: 'Failed to add Pokémon to Pokédex' }],
      };
    }
  }
);

// TOOL: Inspect server capabilities
server.tool(
  'inspect-server',
  'Run MCP Inspector CLI to check server capabilities',
  {
    method: z
      .enum(['tools/list', 'resources/list', 'prompts/list'])
      .default('tools/list')
      .describe('The MCP method to call'),
    serverCommand: z
      .string()
      .optional()
      .describe('Command to run the MCP server (defaults to current server)'),
  },
  { title: 'Inspect MCP Server' },
  async (params) => {
    log('debug', 'tools', { action: 'inspect-server', method: params.method });
    try {
      const serverCmd = params.serverCommand || 'node build/index.js';
      const { stdout, stderr } = await execAsync(
        `npx @modelcontextprotocol/inspector --cli ${serverCmd} --method ${params.method}`
      );
      
      if (stderr) {
        log('warning', 'tools', { action: 'inspect-server', stderr });
        return {
          content: [
            { type: 'text', text: `Inspector error: ${stderr}` },
          ],
        };
      }
      
      let result;
      try {
        result = JSON.parse(stdout);
      } catch {
        result = stdout;
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Inspector results for ${params.method}:\n${
              typeof result === 'string' ? result : JSON.stringify(result, null, 2)
            }`,
          },
        ],
      };
    } catch (error) {
      log('error', 'tools', { action: 'inspect-server', error: error instanceof Error ? error.message : String(error) });
      return {
        content: [
          { type: 'text', text: `Failed to run inspector: ${error instanceof Error ? error.message : String(error)}` },
        ],
      };
    }
  }
);

// TOOL: List all Pokémon in the Pokédex
server.tool(
  'list-pokedex',
  'List all Pokémon currently in the Pokédex',
  {}, // Empty parameters schema since this tool takes no arguments
  { title: 'List Pokédex' },
  async () => {
    log('debug', 'tools', { action: 'list-pokedex' });
    try {
      const allPokemon = await import('./data/pokedex.json', {
        with: { type: 'json' },
      }).then((m) => m.default);
      
      if (allPokemon.length === 0) {
        log('info', 'tools', { message: 'Pokédex is empty' });
        return {
          content: [
            { type: 'text', text: 'The Pokédex is empty. Go catch some Pokémon!' },
          ],
        };
      }
      
      const pokemonList = allPokemon
        .sort((a, b) => a.id - b.id)
        .map((p) => `#${p.id} ${p.name} (${p.type}) - ${p.region}`)
        .join('\n');
      
      log('info', 'tools', { message: `Listed ${allPokemon.length} Pokémon` });
      return {
        content: [
          {
            type: 'text',
            text: `Pokédex entries (${allPokemon.length} total):\n${pokemonList}`,
          },
        ],
      };
    } catch (error) {
      log('error', 'tools', { action: 'list-pokedex', error: error instanceof Error ? error.message : String(error) });
      return {
        content: [
          { type: 'text', text: `Failed to read Pokédex: ${error instanceof Error ? error.message : String(error)}` },
        ],
      };
    }
  }
);

// TOOL WITH SAMPLING: Discover and catch a new, AI-generated Pokémon
server.tool(
  'discover-wild-pokemon',
  'Discover and catch a wild Pokémon with AI-generated data',
  {}, // Empty parameters schema since this tool takes no arguments
  { title: 'Discover Wild Pokémon' },
  async () => {
    log('info', 'tools', { action: 'discover-wild-pokemon', message: 'Requesting AI-generated Pokémon' });
    const res = await server.server.request(
      {
        method: 'sampling/createMessage',
        params: {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Please generate a new, unique, and creative Pokémon. Be creative and avoid duplicates. Random seed: ${Math.random()}. The Pokémon should be inspired by different concepts like: animals, plants, objects, myths, elements, or abstract ideas. Mix different type combinations creatively. Use various regions including Kanto, Johto, Hoenn, Sinnoh, Unova, Kalos, Alola, Galar, Paldea, or invent new regions. Return it in JSON format with exactly these keys: "name" (string, must be unique and creative), "type" (string, one or two types separated by /), "region" (string), and "abilities" (string, comma-separated list of 2-3 abilities). Example: {"name": "Crystafern", "type": "Rock/Grass", "region": "Mystara", "abilities": "Crystal Guard, Photosynthesis, Rock Polish"}. Return ONLY the JSON object, no markdown, no code blocks, no additional text.`,
              },
            },
          ],
          maxTokens: 1024,
        },
      },
      CreateMessageResultSchema
    );

    if (res.content.type !== 'text') {
      log('error', 'tools', { action: 'discover-wild-pokemon', error: 'Invalid response from AI' });
      return {
        content: [{ type: 'text', text: 'Failed to discover a wild Pokémon' }],
      };
    }

    let wildPokemon: any;
    try {
      wildPokemon = JSON.parse(
        res.content.text
          .trim()
          .replace(/^```json/, '')
          .replace(/```$/, '')
          .trim()
      );
    } catch (parseError) {
      log('error', 'tools', { action: 'discover-wild-pokemon', error: 'Failed to parse AI response' });
      return {
        content: [{ type: 'text', text: 'The wild Pokémon data was corrupted and it escaped!' }],
      };
    }

    try {
      const id = await catchPokemon(wildPokemon);
      log('info', 'tools', { message: `Discovered and caught wild ${wildPokemon.name}`, pokemonData: wildPokemon });
      return {
        content: [
          {
            type: 'text',
            text: `A wild ${wildPokemon.name} appeared and was caught! ID: ${id}`,
          },
        ],
      };
    } catch (error) {
      log('error', 'tools', { action: 'discover-wild-pokemon', error: error instanceof Error ? error.message : String(error) });
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('already exists')) {
        return {
          content: [{ type: 'text', text: `The wild ${wildPokemon.name} fled because another one is already in your Pokédex!` }],
        };
      }
      return {
        content: [{ type: 'text', text: 'The wild Pokémon got away...' }],
      };
    }
  }
);

async function catchPokemon(pokemon: {
  name: string;
  type: string;
  region: string;
  abilities: string;
}) {
  log('debug', 'database', { action: 'catch', pokemon: pokemon.name });
  const allPokemon = await import('./data/pokedex.json', {
    with: { type: 'json' },
  }).then((m) => m.default);
  
  // Check if a Pokémon with the same name already exists
  const existing = allPokemon.find(p => p.name.toLowerCase() === pokemon.name.toLowerCase());
  if (existing) {
    log('warning', 'database', { message: `Pokémon ${pokemon.name} already exists with ID ${existing.id}` });
    throw new Error(`A Pokémon named ${pokemon.name} already exists in the Pokédex!`);
  }
  
  const maxId = allPokemon.reduce((max, p) => (p.id > max ? p.id : max), 0);
  const id = maxId + 1;
  allPokemon.push({ id, ...pokemon });
  await fs.writeFile(
    './src/data/pokedex.json',
    JSON.stringify(allPokemon, null, 2)
  );
  log('info', 'database', { message: `Saved ${pokemon.name} to Pokédex with ID ${id}` });
  return id;
}

async function main() {
  const transport = new StdioServerTransport();
  
  // Set up connection event handlers
  transport.onclose = () => {
    isConnected = false;
    console.log('Server connection closed');
  };
  
  await server.connect(transport);
  isConnected = true;
  console.log('Server connected and ready');
}

main();
