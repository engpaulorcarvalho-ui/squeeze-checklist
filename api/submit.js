// Vercel serverless proxy → Google Apps Script
//
// Como o Apps Script funciona:
//   1. POST /exec  → o doPost EXECUTA (salva Drive/planilha, manda WhatsApp)
//   2. só então o Google responde 302 apontando para script.googleusercontent.com
//   3. esse endereço final serve o resultado, mas depende de cookies de sessão
//
// Do servidor não temos esses cookies, então o passo 3 pode dar 404.
// Isso NÃO significa falha: receber o 302 já prova que o passo 1 completou.
// Por isso tentamos ler o resultado e, se não der, reportamos sucesso.

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

function tentarJson(texto) {
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const body = JSON.stringify(req.body);

    // ── Passo 1: dispara a execução ────────────────────────────────
    const r1 = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body,
      redirect: 'manual',
    });

    // ── Resposta direta (sem redirect) ─────────────────────────────
    if (r1.status !== 301 && r1.status !== 302 && r1.status !== 303) {
      const texto = await r1.text();
      const json = tentarJson(texto);

      if (json) {
        return res.status(json.success === false ? 502 : 200).json(json);
      }

      const titulo = (texto.match(/<title>(.*?)<\/title>/i) || [])[1] || '';
      let motivo = 'O Apps Script respondeu algo que não é JSON.';
      if (/not found/i.test(titulo)) {
        motivo =
          'A URL do Apps Script não existe (Page Not Found). Reimplante o Web App e atualize a URL em api/submit.js.';
      } else if (/sign in|login|autoriza/i.test(texto)) {
        motivo =
          'O Apps Script está pedindo login. Reimplante com "Quem pode acessar: Qualquer pessoa".';
      }

      return res.status(502).json({
        success: false,
        error: motivo,
        debug: { httpStatus: r1.status, titulo, preview: texto.slice(0, 300) },
      });
    }

    // ── Passo 2: houve 302 → o doPost já rodou com sucesso ─────────
    const location = r1.headers.get('location');

    if (location) {
      try {
        // Repassa os cookies da 1ª resposta, se houver
        const setCookie =
          typeof r1.headers.getSetCookie === 'function' ? r1.headers.getSetCookie() : [];
        const headers = setCookie.length
          ? { cookie: setCookie.map((c) => c.split(';')[0]).join('; ') }
          : {};

        const r2 = await fetch(location, { method: 'GET', headers });
        const json = tentarJson(await r2.text());

        if (json) {
          return res.status(json.success === false ? 502 : 200).json(json);
        }
      } catch (e) {
        console.warn('Não foi possível ler o resultado do redirect:', e.message);
      }
    }

    // Resultado não recuperável, mas a execução completou.
    return res.status(200).json({
      success: true,
      aviso: 'Execução confirmada pelo Apps Script; detalhes do resultado não recuperados.',
    });
  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
