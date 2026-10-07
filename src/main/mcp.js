'use strict';
// The office as an MCP server. Each worker's Claude session connects to
// http://127.0.0.1:<port>/mcp/<worker token> and gets tools for the task board,
// reports, memory and messaging. The token tells us which worker is calling.
const http = require('http');

const MCP_TOOLS = (z) => ({
  team_list: { description: 'Takımdaki çalışanlar, rolleri ve şu anki durumları.', input: {} },
  board_list: { description: 'Görev panosu. status verilirse yalnızca o durumdaki görevler.', input: { status: z.enum(['backlog', 'todo', 'doing', 'review', 'done']).optional() } },
  task_create: {
    description: 'Panoya görev ekler. assignee bir çalışanın adıysa görev ona iletilir; boşsa backlog\'da bekler. parent ile bir üst görevin alt görevi olur.',
    input: { title: z.string().min(1), details: z.string().optional(), assignee: z.string().optional(), parent: z.string().optional() },
  },
  task_update: {
    description: 'Görevin durumunu/atananını değiştirir ya da not düşer. Bir göreve başlarken status=doing yap.',
    input: { id: z.string(), status: z.enum(['backlog', 'todo', 'doing', 'review', 'done']).optional(), assignee: z.string().optional(), note: z.string().optional() },
  },
  task_done: {
    description: 'Görevi kanıtıyla kapatır. evidence: çalıştırdığın doğrulamalar (ör. typecheck, build, test) ve sonuçları. files: değişen dosyalar.',
    input: {
      id: z.string(), summary: z.string().min(1),
      evidence: z.array(z.object({ label: z.string(), ok: z.boolean(), detail: z.string().optional() })).default([]),
      files: z.array(z.string()).default([]),
    },
  },
  message: { description: 'Bir takım arkadaşına mesaj gönderir (adıyla). Yalnızca bilgi gerekince ya da o kişi bir şey yapmalıysa.', input: { to: z.string(), text: z.string().min(1) } },
  memory_note: { description: 'Kendi hafızana kalıcı bir not ekler: karar, tercih, öğrenilen şey. tags ile bağlantı kur (ör. ["auth","db"]).', input: { text: z.string().min(1), tags: z.array(z.string()).default([]) } },
  memory_search: { description: 'Takımın hafızasında arar (kendi notların + takım arkadaşlarınınki).', input: { query: z.string().min(1) } },
});

async function startMcp({ resolveCaller, handlers, log = () => {} }) {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
  const { z } = await import('zod');
  const defs = MCP_TOOLS(z);

  const text = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });

  function makeServer(caller) {
    const server = new McpServer({ name: 'office', version: '1.0.0' });
    for (const [name, def] of Object.entries(defs)) {
      server.registerTool(name, { description: def.description, inputSchema: def.input }, async (args) => {
        try {
          log(`${caller.name}: ${name} ${JSON.stringify(args).slice(0, 160)}`);
          return text(await handlers[name](caller, args || {}));
        } catch (e) {
          return { content: [{ type: 'text', text: `Hata: ${e.message}` }], isError: true };
        }
      });
    }
    return server;
  }

  const srv = http.createServer(async (req, res) => {
    const m = req.url.match(/^\/mcp\/([a-z0-9]+)/);
    const caller = m && resolveCaller(m[1]);
    if (!caller) { res.statusCode = 404; return res.end('unknown worker'); }
    let body = '';
    for await (const c of req) body += c;
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => transport.close());
      await makeServer(caller).connect(transport);
      await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
    } catch (e) {
      log(`mcp error: ${e.message}`);
      if (!res.headersSent) { res.statusCode = 500; res.end(e.message); }
    }
  });
  await new Promise((resolve, reject) => { srv.on('error', reject); srv.listen(0, '127.0.0.1', resolve); });
  const port = srv.address().port;
  return {
    port,
    urlFor: (token) => `http://127.0.0.1:${port}/mcp/${token}`,
    toolNames: Object.keys(defs).map((n) => `mcp__office__${n}`),
    close: () => srv.close(),
  };
}

module.exports = { startMcp, MCP_TOOLS };
