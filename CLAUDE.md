# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
- `pnpm dev:client` - Build the server and run the client in development mode
- `pnpm build:server` - Build the MCP server TypeScript to JavaScript
- `pnpm inspect` - Build and run the server in MCP Inspector mode for testing and debugging

### Code Quality
- `pnpm lint` - Run ESLint on all packages
- `pnpm lint:fix` - Run ESLint with automatic fixes
- `pnpm format` - Format all files with Prettier
- `pnpm format:check` - Check formatting without making changes

### Package-specific
- `pnpm --filter @pokedex/server build` - Build only the server package
- `pnpm --filter @pokedex/client dev` - Run only the client in dev mode
- `pnpm --filter @pokedex/server inspect` - Run the server in MCP Inspector mode (or `npm run inspect` from server directory)

## Architecture

This is a Model Context Protocol (MCP) monorepo implementing a Pokédex system with:

### MCP Server (`packages/server/`)
- Implements MCP server using `@modelcontextprotocol/sdk`
- Exposes resources (pokemon-list, pokemon-entry templates)
- Provides tools:
  - `catch-pokemon` - Add a new Pokémon to the Pokédex
  - `discover-wild-pokemon` - AI-generated Pokémon discovery
  - `inspect-server` - Run MCP Inspector CLI to check server capabilities
  - `list-pokedex` - List all Pokémon in the Pokédex
- Uses AI sampling for discovering new Pokémon
- Data persistence in `src/data/pokedex.json`
- Structured logging:
  - Supports standard syslog severity levels (debug, info, notice, warning, error, critical, alert, emergency)
  - Logs to console with timestamps, level, logger name, and structured data
  - MCP logging capability declared but SDK limitations prevent full implementation

### MCP Client (`packages/client/`)
- Interactive CLI client using Inquirer prompts
- Connects to server via StdioClientTransport
- Integrates OpenAI for handling server sampling requests
- Requires `OPENAI_API_KEY` environment variable
- Enhanced logging features:
  - Client-side logging with color coding by severity
  - Commands: `/logs on|off` to toggle display
  - Timestamps and structured formatting for all log messages
  - Logs client operations like tool execution and model responses

### Key Patterns
- The client spawns the server process automatically via pnpm
- Communication happens through stdio transport
- Server can request AI assistance from client via sampling API
- All packages use ES modules (`"type": "module"`)

## Environment Setup
The client requires a `.env` file with:
```
OPENAI_API_KEY=your_api_key_here
```