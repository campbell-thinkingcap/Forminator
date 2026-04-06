const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

async function callTool(name, args) {
  const transport = new StreamableHTTPClientTransport(
    new URL(process.env.CAPGPT_URL),
    { requestInit: { headers: { 'X-API-Key': process.env.CAPGPT_API_KEY } } }
  );
  const client = new Client({ name: 'forminator', version: '1.0.0' });
  try {
    await client.connect(transport);
  } catch (err) {
    console.error(`[capgpt] connect failed: ${err.message}`);
    throw err;
  }
  try {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content?.[0]?.text ?? null;
    if (!text) {
      console.warn(`[capgpt] ${name} returned empty content`);
      return null;
    }
    try { return JSON.parse(text); } catch { return text; }
  } catch (err) {
    console.error(`[capgpt] ${name} failed: ${err.message}`);
    throw err;
  } finally {
    await client.close();
  }
}

module.exports = { callTool };
