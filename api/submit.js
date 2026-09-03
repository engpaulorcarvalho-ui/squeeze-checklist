// Vercel serverless proxy — contorna o redirect 302 do Google Apps Script
// O browser perde o body ao seguir o redirect; aqui fazemos isso no servidor.

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // fotos em base64 podem ser grandes
    },
  },
};

const APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbwq7KhJXK3_yM-EMd0yLMiZByT2uL13b34Z0TJbV9D8QeDUQE3kHD75EsDK49AIVbDp/exec';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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

    let finalResponse;

    if (r1.status === 302 || r1.status === 301) {
      // Segue o redirect manualmente preservando o POST e o body
      const location = r1.headers.get('location');
      if (!location) throw new Error('Redirect sem Location header');

      const r2 = await fetch(location, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body,
      });
      finalResponse = r2;
    } else {
      finalResponse = r1;
    }

    const text = await finalResponse.text();

    // Tenta parsear como JSON; se falhar, retorna sucesso genérico
    try {
      const json = JSON.parse(text);
      return res.status(200).json(json);
    } catch {
      return res.status(200).json({ success: true, raw: text });
    }
  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
