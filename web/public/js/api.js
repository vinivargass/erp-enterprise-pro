// Cliente HTTP da API REST da demonstração. Envia o token CSRF em mutações e uma
// Idempotency-Key em operações sensíveis a repetição (duplo clique, reenvio após timeout).
let csrf = '';
try { csrf = sessionStorage.getItem('csrf') || ''; } catch { /* armazenamento indisponível: exige novo login */ }
export function definirCsrf(t) { csrf = t || ''; try { sessionStorage.setItem('csrf', csrf); } catch { /* armazenamento indisponível */ } }

export class ErroApi extends Error {
  constructor(status, corpo) {
    super(corpo?.erro?.mensagem || `Falha na comunicação (HTTP ${status}).`);
    this.status = status;
    this.codigo = corpo?.erro?.codigo;
    this.detalhes = corpo?.erro?.detalhes || null;
  }
}

let aoExpirar = () => {};
export function quandoSessaoExpirar(fn) { aoExpirar = fn; }

export async function api(metodo, caminho, corpo, { idempotente = false, chave } = {}) {
  const headers = { Accept: 'application/json' };
  if (corpo !== undefined) headers['Content-Type'] = 'application/json';
  if (metodo !== 'GET') headers['X-CSRF-Token'] = csrf;
  if (idempotente) headers['Idempotency-Key'] = chave || crypto.randomUUID();
  let resp;
  try {
    resp = await fetch(caminho, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo), credentials: 'same-origin' });
  } catch {
    throw new ErroApi(0, { erro: { mensagem: 'Servidor indisponível. Verifique se a aplicação está em execução.' } });
  }
  const tipo = resp.headers.get('content-type') || '';
  const dados = tipo.includes('application/json') ? await resp.json() : null;
  if (resp.status === 401 && !caminho.endsWith('/auth/login')) aoExpirar();
  if (!resp.ok) throw new ErroApi(resp.status, dados);
  return dados;
}

export const get = (c, q) => api('GET', q ? `${c}?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== '' && v != null))}` : c);
export const post = (c, b, o) => api('POST', c, b ?? {}, o);
export const put = (c, b) => api('PUT', c, b);
export const del = (c) => api('DELETE', c);
