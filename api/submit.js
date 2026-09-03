// Vercel serverless proxy → Google Apps Script
//
// Por que existe: o Apps Script responde 302 para script.googleusercontent.com.
// O doPost JÁ EXECUTOU nesse ponto; o redirect só serve o resultado, e aquele
// endereço final aceita apenas GET (POST retorna 405).
// O fetch padrão (redirect: 'follow') faz exatamente isso: converte 302+POST
// em GET automaticamente. Por isso NÃO usamos redirect: 'manual' aqui.

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // fotos em base64 podem ser grandes
    },
  },
};

// URL da implantação ativa do Apps Script (termina em /exec)
const APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbxWkx5Naw7OZPTtVG06thdWrge9kLCw-N2drMCU4aqx3B-YR9Ku2P15bzD9tN_2xYPM/exec';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const body = JSON.stringify(req.body);

    const resposta = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
      // redirect: 'follow' é o padrão — necessário para o Apps Script
    });

    const text = await resposta.text();

    // O Apps Script deve responder JSON. HTML = implantação inválida ou sem permissão.
    let json;
    try {
      json = JSON.parse(text);
    } catch {
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
        debug: { httpStatus: resposta.status, titulo, preview: text.slice(0, 300) },
      });
    }

    // Repassa a resposta real do Apps Script (inclusive success:false)
    return res.status(json.success === false ? 502 : 200).json(json);
  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
