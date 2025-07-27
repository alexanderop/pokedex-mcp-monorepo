import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  StdioServerParameters,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { CreateMessageRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { openai } from '@ai-sdk/openai';
import { generateText, CoreTool } from 'ai';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

export class MCPClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private tools: Record<string, CoreTool> = {};
  private logLevel: string = 'info';
  private showLogs: boolean = true;

  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
  }

  async connectToServer(serverScriptPath: string) {
    let command: string;
    let args: string[];

    if (serverScriptPath === 'pnpm-server') {
      // Special case for running the local server with pnpm
      command = 'pnpm';
      args = ['--filter', '@pokedex/server', 'start'];
    } else if (
      serverScriptPath.endsWith('.js') ||
      serverScriptPath.endsWith('.ts')
    ) {
      command = 'node';
      args = [serverScriptPath];
    } else {
      throw new Error('Server script must be a .js or .ts file');
    }

    const serverParams: StdioServerParameters = {
      command,
      args,
      env: process.env as Record<string, string>,
    };

    this.transport = new StdioClientTransport(serverParams);
    this.client = new Client(
      {
        name: 'mcp-client',
        version: '1.0.0',
      },
      {
        capabilities: {
          sampling: {},
        },
      }
    );

    console.log('\n--- Connecting to MCP Server ---');
    console.log('Command:', command, args.join(' '));

    await this.client.connect(this.transport);
    console.log('✓ Connected successfully');

    // Note: The client SDK doesn't expose getServerInfo directly
    // Logging capability is declared by the server

    // Set up sampling request handler
    this.client.setRequestHandler(
      CreateMessageRequestSchema,
      async (request) => {
        console.log('\n--- Received sampling request from server ---');
        console.log('Request:', JSON.stringify(request, null, 2));

        const { messages, maxTokens } = request.params;

        try {
          // Convert MCP messages to AI SDK format
          const aiMessages = messages.map((msg) => {
            // Handle different content types from MCP
            let textContent = '';
            if (typeof msg.content === 'string') {
              textContent = msg.content;
            } else if (Array.isArray(msg.content)) {
              // Extract text from content array
              const textPart = msg.content.find((c) => c.type === 'text');
              textContent = textPart?.text || '';
            } else if (
              msg.content &&
              typeof msg.content === 'object' &&
              'text' in msg.content
            ) {
              textContent = msg.content.text as string;
            }

            return {
              role: msg.role as 'user' | 'assistant',
              content: textContent,
            };
          });

          const response = await generateText({
            model: openai('gpt-4o-mini'),
            messages: aiMessages,
            maxTokens: maxTokens,
          });

          this.logMessage('debug', 'client', {
            action: 'sampling-response',
            textLength: response.text.length,
          });

          return {
            role: 'assistant' as const,
            content: {
              type: 'text' as const,
              text: response.text,
            },
            model: 'gpt-4o-mini',
          };
        } catch (error) {
          console.error('Error handling sampling request:', error);
          throw error;
        }
      }
    );

    // List available tools and convert them to AI SDK format
    console.log('\n--- Fetching Server Tools ---');
    const response = await this.client.listTools();
    console.log(`Found ${response.tools.length} tools from server`);

    this.tools = {};
    for (const mcpTool of response.tools) {
      console.log(`\n  Tool: ${mcpTool.name}`);
      console.log(`  Description: ${mcpTool.description || 'No description'}`);

      // Create a Zod schema from the JSON schema
      const parameters = this.createZodSchema(mcpTool.inputSchema);

      this.tools[mcpTool.name] = {
        description: mcpTool.description || '',
        parameters,
        execute: async (args: unknown) => {
          console.log(`\n>>> Executing tool: ${mcpTool.name}`);
          console.log('>>> Arguments:', JSON.stringify(args, null, 2));

          const result = await this.client!.callTool({
            name: mcpTool.name,
            arguments: args as Record<string, unknown>,
          });

          console.log('>>> Raw tool result:', JSON.stringify(result, null, 2));

          // Extract text from the result
          if (Array.isArray(result.content) && result.content.length > 0) {
            const firstContent = result.content[0];
            if ('text' in firstContent) {
              console.log('>>> Returning text content:', firstContent.text);
              return firstContent.text;
            }
          }
          const stringified = JSON.stringify(result.content);
          console.log('>>> Returning stringified content:', stringified);
          return stringified;
        },
      };
    }

    console.log('\nConnected to server with tools:', Object.keys(this.tools));
    console.log(
      'Tool details:',
      Object.entries(this.tools).map(([name, tool]) => ({
        name,
        description: tool.description,
        parameters: tool.parameters._def, // Zod schema definition
      }))
    );
  }

  private createZodSchema(jsonSchema: {
    properties?: Record<string, unknown>;
    required?: string[];
  }): z.ZodType<unknown> {
    // Simple conversion from JSON Schema to Zod schema
    // This handles basic cases - you might need to extend this for complex schemas
    if (!jsonSchema || !jsonSchema.properties) {
      console.log('    Schema: No properties defined, using empty object');
      return z.object({});
    }

    console.log(
      '    Schema properties:',
      Object.keys(jsonSchema.properties).join(', ')
    );
    console.log(
      '    Required fields:',
      jsonSchema.required?.join(', ') || 'none'
    );

    const shape: Record<string, z.ZodType<unknown>> = {};

    for (const [key, value] of Object.entries(jsonSchema.properties)) {
      const prop = value as { type?: string; items?: unknown };
      let zodType: z.ZodType<unknown>;

      switch (prop.type) {
        case 'string':
          zodType = z.string();
          break;
        case 'number':
          zodType = z.number();
          break;
        case 'boolean':
          zodType = z.boolean();
          break;
        case 'array':
          zodType = z.array(z.any());
          break;
        case 'object':
          zodType = z.object({});
          break;
        default:
          zodType = z.any();
      }

      // Check if the field is required
      if (jsonSchema.required && jsonSchema.required.includes(key)) {
        shape[key] = zodType;
      } else {
        shape[key] = zodType.optional();
      }
    }

    return z.object(shape);
  }

  async processQuery(query: string): Promise<string> {
    if (!this.client) {
      console.log('client not connected');
      throw new Error('Client not connected. Call connectToServer first.');
    }

    try {
      console.log('\n--- Processing Query ---');
      console.log('User query:', query);
      console.log('Available tools:', Object.keys(this.tools).join(', '));

      // Use generateText with tools
      const response = await generateText({
        model: openai('gpt-4o-mini'),
        messages: [
          {
            role: 'system',
            content:
              'You are a helpful Pokédex assistant. When users ask questions or make requests about Pokémon, help them accomplish their goals. Always provide a user-friendly response based on the tool results.',
          },
          {
            role: 'user',
            content: query,
          },
        ],
        tools: this.tools,
        toolChoice: 'auto', // Enable automatic tool calling
        maxSteps: 6, // Allow the model to continue after tool calls
        maxRetries: 3,
      });

      console.log('\n--- Model Response ---');
      console.log(
        'Tool calls:',
        response.toolCalls?.map((tc) => ({
          name: tc.toolName,
          args: tc.args,
        })) || 'None'
      );
      console.log('Response text length:', response.text.length);
      console.log('Response usage:', {
        promptTokens: response.usage?.promptTokens,
        completionTokens: response.usage?.completionTokens,
        totalTokens: response.usage?.totalTokens,
      });

      // If there were tool calls but no text response, generate a summary
      if (
        response.toolCalls &&
        response.toolCalls.length > 0 &&
        !response.text
      ) {
        // The generateText response includes tool results in the text when maxSteps > 1
        // So this fallback should rarely be needed
        return 'Tool was called but no text response was generated.';
      }

      return response.text || 'No response generated.';
    } catch (error) {
      console.error('Error processing query:', error);
      throw error;
    }
  }

  async setLogLevel(level: string) {
    if (!this.client) {
      throw new Error('Client not connected');
    }

    try {
      await this.client.request(
        {
          method: 'logging/setLevel',
          params: { level },
        },
        z.object({
          level: z.string(),
        })
      );
      this.logLevel = level;
      console.log(`✓ Log level set to: ${level}`);
    } catch (error) {
      console.error('Failed to set log level:', error);
    }
  }

  private logMessage(level: string, logger: string, data: unknown) {
    if (!this.showLogs) return;

    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${logger}]`;

    // Color code based on level
    const colors: Record<string, string> = {
      debug: '\x1b[36m', // Cyan
      info: '\x1b[32m', // Green
      notice: '\x1b[34m', // Blue
      warning: '\x1b[33m', // Yellow
      error: '\x1b[31m', // Red
      critical: '\x1b[35m', // Magenta
      alert: '\x1b[91m', // Bright Red
      emergency: '\x1b[41m\x1b[37m', // Red background, white text
    };
    const reset = '\x1b[0m';
    const color = colors[level] || '';

    console.log(`${color}${prefix}${reset}`, JSON.stringify(data));
  }

  toggleLogs(show?: boolean) {
    this.showLogs = show !== undefined ? show : !this.showLogs;
    console.log(`Log display: ${this.showLogs ? 'enabled' : 'disabled'}`);
  }

  async chatLoop() {
    console.log('\nMCP Client Started!');
    console.log("Type your queries or 'quit' to exit.");
    console.log('Commands: /logs on|off\n');

    const readline = await import('readline/promises');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      while (true) {
        const query = await rl.question('Query: ');

        if (query.toLowerCase() === 'quit') {
          console.log('\nGoodbye!');
          break;
        }

        // Handle special commands
        if (query.startsWith('/')) {
          const parts = query.split(' ');
          const command = parts[0].toLowerCase();

          if (command === '/logs') {
            if (parts[1] === 'on') {
              this.toggleLogs(true);
            } else if (parts[1] === 'off') {
              this.toggleLogs(false);
            } else {
              this.toggleLogs();
            }
            continue;
          } else {
            console.log('Unknown command. Available commands: /logs on|off');
            continue;
          }
        }

        console.log(`\n[Received query: "${query}"]`);

        try {
          const response = await this.processQuery(query);
          console.log('\n--- Final Response ---');
          console.log(response);
          console.log('--- End Response ---\n');
        } catch (error) {
          console.error('\nError:', error);
        }
      }
    } finally {
      rl.close();
    }
  }

  async cleanup() {
    if (this.client) {
      await this.client.close();
    }
  }
}
