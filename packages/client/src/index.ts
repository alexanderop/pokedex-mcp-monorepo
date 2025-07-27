import { MCPClient } from './client.js';

async function main() {
  const args = process.argv.slice(2);
  
  // Default to connecting to the local pnpm server if no argument provided
  const serverPath = args[0] || 'pnpm-server';
  
  const client = new MCPClient();
  
  try {
    await client.connectToServer(serverPath);
    await client.chatLoop();
  } finally {
    await client.cleanup();
  }
}

main().catch(console.error);