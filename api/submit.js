// Vercel serverless proxy — contorna o redirect 302 do Google Apps Script
// O browser perde o body ao seguir o redirect; aqui fazemos isso no servidor.

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // fotos em base64 podem ser grandes
    },
  },
};

// ⚠️ COLE AQUI A URL DA IMPLANTAÇÃO ATIVA DO APPS SCRIPT (termina em /exec)
const APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbxWkx5Naw7OZPTtVG06thdWrge9kLCw-N2drMCU4aqx3B-YR9Ku2P15bzD9tN_2xYPM/exec';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const body = JSON.stringify(req.body);

  try {
    // 1ª requisição: recebe o 302 sem seguir automaticamente
    const r1 = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
      redirect: 'manual',
    });

    let finalResponse = r1;

    if (r1.status === 302 || r1.status === 301) {
      const location = r1.headers.get('location');
      if (!location) throw new Error('Redirect sem Location header');

      finalResponse = await fetch(location, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body,
      });
    }

    const text = await finalResponse.text();

    // O Apps Script DEVE responder JSON. Se veio HTML, a implantação está
    // inválida/arquivada ou sem permissão pública — nunca mascarar como sucesso.
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      const isHtml = /^\s*<(!doctype|html)/i.test(text);
      const titulo = (text.match(/<title>(.*?)<\/title>/i) || [])[1] || '';

      let motivo = 'O Apps Script respondeu algo que não é JSON.';
      if (/not found/i.test(titulo)) {
        motivo =
          'A URL do Apps Script não existe (Page Not Found). Reimplante o Web App e atualize a URL em api/submit.js.';
      } else if (/sign in|login|autoriza/i.test(text)) {
        motivo =
          'O Apps Script está pedindo login. Reimplante com "Quem pode acessar: Qualquer pessoa".';
      }

      return res.status(502).json({
        success: false,
        error: motivo,
        debug: { httpStatus: finalResponse.status, isHtml, titulo, preview: text.slice(0, 300) },
      });
    }

    // Repassa a resposta real do Apps Script (inclusive success:false)
    return res.status(json.success === false ? 502 : 200).json(json);
  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
