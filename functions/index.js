/* ===== Directors Assistant backend =====
   Real Claude AI + live business data (Firestore + MIDAP), replacing the static web app's
   keyword-only answerQuestion(). Kept as a single HTTPS function so the whole thing can be
   turned on/off from the app's own "Real AI" toggle without any other app being touched -
   this function is never called by anything except that one toggle.

   Secrets (MIDAP_LICENSE_KEY, ANTHROPIC_API_KEY) are read via Firebase Functions'
   defineSecret - set with `firebase functions:secrets:set <NAME>`, never hardcoded here and
   never committed to the repo. */
const {onRequest} = require('firebase-functions/v2/https');
const {defineSecret} = require('firebase-functions/params');
const admin = require('firebase-admin');
const Anthropic = require('@anthropic-ai/sdk');

admin.initializeApp();
const db = admin.firestore();

const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY');
const midapLicenseKey = defineSecret('MIDAP_LICENSE_KEY');

const MIDAP_BASE = 'https://blissgems.midap.in/api';
const fmtAmt = n => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

/* ===== Firestore-backed tools (same data/logic as the old client-side answerQuestion) ===== */
async function getOpenTrips() {
  const snap = await db.collection('te_trips').get();
  const rows = snap.docs.map(d => d.data()).filter(x => !x.deletedAt && x.status !== 'closed');
  if (!rows.length) return 'Koi trip abhi open nahi hai - sab close ho chuke hain.';
  return rows.length + ' trip(s) abhi open hain:\n' +
    rows.map(t => `- ${t.salesName || '-'} - ${t.location || 'Trip'} (status: ${t.status})`).join('\n');
}
async function getLowStockItems() {
  const snap = await db.collection('si_items').get();
  const rows = snap.docs.map(d => d.data()).filter(x => Number(x.stock || 0) < Number(x.min || 0));
  if (!rows.length) return 'Koi item low-stock mein nahi hai.';
  return rows.length + ' item(s) low-stock mein hain:\n' +
    rows.map(x => `- ${x.name} - ${x.stock || 0} ${x.unit || ''} bache (reorder level ${x.min || 0})`).join('\n');
}
async function getPettyCashBalance() {
  const snap = await db.collection('pc_ledger').get();
  const rows = snap.docs.map(d => d.data()).filter(x => !x.deletedAt);
  const totalIn = rows.filter(x => x.type === 'in').reduce((s, x) => s + (x.amount || 0), 0);
  const totalOut = rows.filter(x => x.type === 'out').reduce((s, x) => s + (x.amount || 0), 0);
  return `Petty Cash current balance: ${fmtAmt(totalIn - totalOut)}\n(Total Received: ${fmtAmt(totalIn)} - Total Issued: ${fmtAmt(totalOut)})`;
}
async function getTodayFuelExpense() {
  const snap = await db.collection('fuel_log').get();
  const today = new Date().toISOString().slice(0, 10);
  const rows = snap.docs.map(d => d.data()).filter(x => !x.deletedAt && x.date === today);
  if (!rows.length) return `Aaj (${today}) koi fuel entry nahi hui hai.`;
  const total = rows.reduce((s, x) => s + (x.amount || 0), 0);
  return `Aaj ka total petrol/fuel expense: ${fmtAmt(total)}\n` +
    rows.map(x => `- ${x.vehicle || '-'} - ${fmtAmt(x.amount)}${x.liters ? ' (' + x.liters + ' L)' : ''}`).join('\n');
}

/* ===== MIDAP-backed tools - see MIDAP's own API docs for the full field list; only the
   fields this assistant actually uses are filled in here, everything else sent empty/"all"
   exactly as MIDAP's docs require (an omitted field is not the same as an accepted default
   on this API). ===== */
async function callMidap(path, data) {
  const resp = await fetch(MIDAP_BASE + path, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({licenseKey: midapLicenseKey.value(), data}),
  });
  const json = await resp.json();
  if (json.status !== 'success') throw new Error(json.message || 'MIDAP API error');
  return json;
}
async function getMidapPendingTasks({doer_name, type}) {
  const json = await callMidap('/api_checklist_delegation/checklist_delegation_fetched_api_data.php', {
    task_title: '', status: 'P', type: type || '', priority: '',
    doer_name: doer_name || 'all', assigned_by: '', branch_name: '', department_name: '',
    pc: '', auditor: '', group: '', start_date: '', end_date: '', mode_filter: '', verified_status: '',
  });
  if (!json.total) return 'Koi pending task nahi hai' + (doer_name ? ` ${doer_name} ke liye` : '') + '.';
  const rows = json.data.slice(0, 20);
  return `${json.total} pending task(s)${json.total > 20 ? ', pehle 20 dikha raha hoon' : ''}:\n` +
    rows.map(t => `- [${t.task_type}] ${t.task_title} - ${t.doer_name} - planned ${t.planned_date} - ${t.delay}`).join('\n');
}
async function getMidapFmsStatus({fms_name, doer_name}) {
  const json = await callMidap('/api_fms_data/fms_filter_data_fetch.php', {
    fms_name, doer_name: doer_name || 'all', steps: 'all', field_name: '', field_value: '',
    status: 'Pending', department_name: 'all', start_date: '', end_date: '', pc: '',
  });
  if (!json.total) return `"${fms_name}" mein koi pending step nahi hai.`;
  const rows = json.data.slice(0, 20);
  return `${json.total} pending step(s) in "${fms_name}"${json.total > 20 ? ', pehle 20 dikha raha hoon' : ''}:\n` +
    rows.map(r => `- ${r.step_name} - ${r.doer_name} - ${r.delay}`).join('\n');
}

const TOOLS = [
  {name: 'get_open_trips', description: 'Trip Expense app ke saare open (not yet closed) trips ki list.', input_schema: {type: 'object', properties: {}}},
  {name: 'get_low_stock_items', description: 'Stationery Inventory ke items jo reorder level se neeche hain.', input_schema: {type: 'object', properties: {}}},
  {name: 'get_petty_cash_balance', description: 'Petty Cash ka current balance (total received - total issued).', input_schema: {type: 'object', properties: {}}},
  {name: 'get_today_fuel_expense', description: 'Aaj ka total fuel/petrol expense, vehicle-wise breakdown ke saath.', input_schema: {type: 'object', properties: {}}},
  {
    name: 'get_midap_pending_tasks',
    description: 'MIDAP se pending Checklist/Delegation tasks (optionally ek specific doer ya type ke liye).',
    input_schema: {
      type: 'object',
      properties: {
        doer_name: {type: 'string', description: 'Exact username jaisa MIDAP mein hai. Khaali chhodein sab doers ke liye.'},
        type: {type: 'string', enum: ['CHK', 'DEL', ''], description: 'CHK=Checklist, DEL=Delegation, khaali=dono.'},
      },
    },
  },
  {
    name: 'get_midap_fms_status',
    description: 'MIDAP ke ek business process (FMS) ke pending steps.',
    input_schema: {
      type: 'object',
      properties: {
        fms_name: {type: 'string', description: 'Exact FMS naam jaisa MIDAP mein hai.'},
        doer_name: {type: 'string', description: 'Optional - ek specific doer tak filter.'},
      },
      required: ['fms_name'],
    },
  },
];

async function runTool(name, input) {
  try {
    switch (name) {
      case 'get_open_trips': return await getOpenTrips();
      case 'get_low_stock_items': return await getLowStockItems();
      case 'get_petty_cash_balance': return await getPettyCashBalance();
      case 'get_today_fuel_expense': return await getTodayFuelExpense();
      case 'get_midap_pending_tasks': return await getMidapPendingTasks(input || {});
      case 'get_midap_fms_status': return await getMidapFmsStatus(input || {});
      default: return 'Unknown tool: ' + name;
    }
  } catch (e) {
    console.error('tool ' + name + ' failed:', e);
    return 'Error fetching this data: ' + e.message;
  }
}

const SYSTEM_PROMPT = `Aap Bliss One ke Directors Assistant hain - ek gems/minerals trading business ka
internal tool. Aapke paas Firestore (Trip Expense, Stationery, Petty Cash, Fuel Tracker) aur MIDAP
(Tasks, FMS) ka live data padhne ke tools hain. Sawaal ka jawab seedha, Hindi/Hinglish mein, bina
zaroorat ke lamba kiye dein. Agar koi tool error de, use user ko saaf bata dein (chhupayein nahi).
Agar sawaal in tools se answer nahi ho sakta, saaf kahein ki abhi ye data available nahi hai.`;

exports.directorsAssistantChat = onRequest(
  {secrets: [anthropicApiKey, midapLicenseKey], cors: true, region: 'us-central1'},
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({error: 'POST only'}); return; }
    const question = String((req.body && req.body.question) || '').trim();
    if (!question) { res.status(400).json({error: 'question is required'}); return; }

    const client = new Anthropic({apiKey: anthropicApiKey.value()});
    let messages = [{role: 'user', content: question}];

    try {
      for (let turn = 0; turn < 5; turn++) {
        const response = await client.messages.create({
          model: 'claude-haiku-5-5',
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          output_config: {effort: 'low'},
          tools: TOOLS,
          messages,
        });
        messages.push({role: 'assistant', content: response.content});
        if (response.stop_reason !== 'tool_use') {
          const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
          res.status(200).json({answer: text});
          return;
        }
        const toolResults = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;
          const result = await runTool(block.name, block.input);
          toolResults.push({type: 'tool_result', tool_use_id: block.id, content: result});
        }
        messages.push({role: 'user', content: toolResults});
      }
      res.status(200).json({answer: 'Sawaal bahut complex tha, kripya simpler tarike se poochein.'});
    } catch (e) {
      console.error('directorsAssistantChat failed:', e);
      res.status(500).json({error: 'Internal error: ' + e.message});
    }
  }
);
