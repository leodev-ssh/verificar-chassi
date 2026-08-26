import crypto from 'node:crypto';

const CHAVE_IPS_BLOQUEADOS = 'ips-bloqueados.json';
const CHAVE_LOG_ACESSOS = 'log-acessos.json';
const CHAVE_NOMES_IPS = 'nomes-ips.json';
const CHAVE_WHITELIST = 'whitelist-ips.json';
const CHAVE_WHITELIST_ATIVA = 'whitelist-ativa.json';
const MAX_LOG_ACESSOS = 500;
const NOME_COOKIE_SESSAO = 'vc_admin';
const DURACAO_SESSAO_MS = 12 * 60 * 60 * 1000; // 12 horas

function segredoSessao() {
  const senha = process.env.ADMIN_PASSWORD;
  if (!senha) throw new Error('ADMIN_PASSWORD não configurada.');
  return senha;
}

// Cookie de sessão assinado (HMAC), sem estado no servidor: "expiraEmMs.assinatura"
export function criarTokenSessao() {
  const expiraEm = Date.now() + DURACAO_SESSAO_MS;
  const assinatura = crypto
    .createHmac('sha256', segredoSessao())
    .update(String(expiraEm))
    .digest('hex');
  return `${expiraEm}.${assinatura}`;
}

export function tokenSessaoValido(token) {
  if (!token) return false;
  const [expiraEmStr, assinatura] = token.split('.');
  if (!expiraEmStr || !assinatura) return false;
  const expiraEm = Number(expiraEmStr);
  if (!Number.isFinite(expiraEm) || expiraEm < Date.now()) return false;

  const esperado = crypto.createHmac('sha256', segredoSessao()).update(expiraEmStr).digest('hex');
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function senhaCorreta(senhaInformada) {
  const esperada = process.env.ADMIN_PASSWORD;
  if (!esperada || !senhaInformada) return false;
  const a = Buffer.from(String(senhaInformada));
  const b = Buffer.from(String(esperada));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function lerCookie(cabecalhoCookie, nome) {
  if (!cabecalhoCookie) return null;
  const partes = cabecalhoCookie.split(';').map((p) => p.trim());
  for (const parte of partes) {
    const [chave, ...resto] = parte.split('=');
    if (chave === nome) return decodeURIComponent(resto.join('='));
  }
  return null;
}

export {
  NOME_COOKIE_SESSAO,
  CHAVE_IPS_BLOQUEADOS,
  CHAVE_LOG_ACESSOS,
  CHAVE_NOMES_IPS,
  CHAVE_WHITELIST,
  CHAVE_WHITELIST_ATIVA,
  MAX_LOG_ACESSOS,
};

// --- IPs bloqueados ---
export async function carregarIpsBloqueados(store) {
  const lista = await store.get(CHAVE_IPS_BLOQUEADOS, { type: 'json' });
  return Array.isArray(lista) ? lista : [];
}

export async function salvarIpsBloqueados(store, lista) {
  await store.setJSON(CHAVE_IPS_BLOQUEADOS, lista);
}

// --- Whitelist (desativada por padrão; só passa a valer quando ligada) ---
export async function carregarWhitelist(store) {
  const lista = await store.get(CHAVE_WHITELIST, { type: 'json' });
  return Array.isArray(lista) ? lista : [];
}

export async function salvarWhitelist(store, lista) {
  await store.setJSON(CHAVE_WHITELIST, lista);
}

export async function whitelistAtiva(store) {
  const valor = await store.get(CHAVE_WHITELIST_ATIVA, { type: 'json' });
  return valor === true;
}

export async function definirWhitelistAtiva(store, ativa) {
  await store.setJSON(CHAVE_WHITELIST_ATIVA, Boolean(ativa));
}

// --- Apelidos de IP (nomear quem é quem) ---
export async function carregarNomesIps(store) {
  const mapa = await store.get(CHAVE_NOMES_IPS, { type: 'json' });
  return mapa && typeof mapa === 'object' ? mapa : {};
}

export async function salvarNomeIp(store, ip, nome) {
  const mapa = await carregarNomesIps(store);
  if (nome) {
    mapa[ip] = nome;
  } else {
    delete mapa[ip];
  }
  await store.setJSON(CHAVE_NOMES_IPS, mapa);
  return mapa;
}

// --- Log de acessos (IP + data/hora), tamanho limitado ---
export async function registrarAcesso(store, ip) {
  if (!ip) return;
  try {
    const log = (await store.get(CHAVE_LOG_ACESSOS, { type: 'json' })) || [];
    log.unshift({ ip, em: new Date().toISOString() });
    await store.setJSON(CHAVE_LOG_ACESSOS, log.slice(0, MAX_LOG_ACESSOS));
  } catch {
    // Log de acessos é best-effort: nunca deve quebrar a busca principal.
  }
}

export async function carregarLogAcessos(store) {
  const log = await store.get(CHAVE_LOG_ACESSOS, { type: 'json' });
  return Array.isArray(log) ? log : [];
}

// Resumo por IP: quantidade de acessos, apelido e o mais recente, ordenado por mais recente
export function resumoIps(log, nomesIps = {}) {
  const porIp = new Map();
  for (const item of log) {
    if (!porIp.has(item.ip)) {
      porIp.set(item.ip, { ip: item.ip, nome: nomesIps[item.ip] || '', total: 0, ultimoAcesso: item.em });
    }
    porIp.get(item.ip).total += 1;
  }
  return Array.from(porIp.values()).sort((a, b) => b.ultimoAcesso.localeCompare(a.ultimoAcesso));
}
