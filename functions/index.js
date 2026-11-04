const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');

// Allowed origins for the Sales Call Log app (and any other Bliss One app that may call
// this later). Kept as an explicit list rather than '*' so the key's quota can't be
// burned through by some unrelated site embedding this URL.
const ALLOWED_ORIGINS = [
  'https://bliss-gems-one.web.app',
  'https://bliss-gems-one.firebaseapp.com',
];

function setCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) res.set('Access-Control-Allow-Origin', origin);
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
}

// Max upload accepted here (OpenAI's own Whisper limit is 25MB) - kept comfortably under
// that, and well above what a short sales call recording from a phone needs.
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

async function transcribeAudio(apiKey, audioBuffer, mimeType, fileName) {
  const form = new FormData();
  form.append('file', new Blob([audioBuffer], { type: mimeType || 'audio/mpeg' }), fileName || 'recording.mp3');
  form.append('model', 'whisper-1');
  const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Whisper transcription failed (${resp.status}): ${errText.slice(0, 300)}`);
  }
  const data = await resp.json();
  return data.text || '';
}

async function analyzeTranscript(apiKey, transcript, clientName) {
  // Scoped tightly to summarizing THIS sales call transcript - never asked anything about
  // the app's own code, Firebase setup, or anything outside the transcript's content,
  // matching the standing rule that this assistant only answers business-data questions.
  const systemPrompt = 'You are a sales call analyst for a gems and minerals trading company in India. ' +
    'You are given the transcript of ONE sales call. Reply with ONLY a JSON object (no markdown, no extra text) ' +
    'with these exact keys: "summary" (2-3 sentences, in Hinglish, what the call was about), ' +
    '"sentiment" (one of: "Positive", "Neutral", "Negative"), ' +
    '"outcome" (one of: "Deal Closed", "Follow-up Needed", "Not Interested", "Information Only", "Unclear"), ' +
    '"followUpNeeded" (true or false).';
  const userPrompt = `Client/Party: ${clientName || 'Unknown'}\n\nTranscript:\n${transcript}`;
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Analysis failed (${resp.status}): ${errText.slice(0, 300)}`);
  }
  const data = await resp.json();
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  try {
    return JSON.parse(content);
  } catch (e) {
    throw new Error('Analysis response was not valid JSON: ' + String(content).slice(0, 200));
  }
}

exports.analyzeCall = onRequest({ secrets: [OPENAI_API_KEY], cors: false, memory: '512MiB', timeoutSeconds: 120, region: 'asia-south1' }, async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  try {
    const { audioBase64, mimeType, fileName, clientName } = req.body || {};
    if (!audioBase64) { res.status(400).json({ error: 'audioBase64 is required' }); return; }

    // audioBase64 may come as a data: URL (e.g. "data:audio/webm;base64,AAAA...") from the
    // browser's FileReader - strip that prefix if present before decoding.
    const commaIdx = audioBase64.indexOf(',');
    const rawBase64 = audioBase64.startsWith('data:') && commaIdx !== -1 ? audioBase64.slice(commaIdx + 1) : audioBase64;
    const audioBuffer = Buffer.from(rawBase64, 'base64');
    if (audioBuffer.length > MAX_AUDIO_BYTES) {
      res.status(413).json({ error: 'Recording too large (max 20MB).' });
      return;
    }

    const apiKey = OPENAI_API_KEY.value();
    const transcript = await transcribeAudio(apiKey, audioBuffer, mimeType, fileName);
    if (!transcript.trim()) {
      res.status(200).json({ transcript: '', summary: 'Recording mein koi samajh aane wali speech nahi mili.', sentiment: 'Neutral', outcome: 'Unclear', followUpNeeded: false });
      return;
    }
    const analysis = await analyzeTranscript(apiKey, transcript, clientName);
    res.status(200).json({ transcript, ...analysis });
  } catch (e) {
    console.error('analyzeCall failed:', e);
    res.status(500).json({ error: e.message || String(e) });
  }
});
