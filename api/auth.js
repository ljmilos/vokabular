export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { path } = req.query;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  const url = `${supabaseUrl}/auth/v1/${path}${req.url.includes('?') ? '&' : '?'}`;
  
  const response = await fetch(`${supabaseUrl}/auth/v1/${path}`, {
    method: req.method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseKey,
      ...(req.headers.authorization ? { 'Authorization': req.headers.authorization } : {})
    },
    ...(req.method !== 'GET' ? { body: JSON.stringify(req.body) } : {})
  });

  const data = await response.json();
  res.status(response.status).json(data);
}
