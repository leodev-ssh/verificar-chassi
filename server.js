require('dotenv').config({ quiet: true });
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');

const PORT = process.env.PORT || 3300;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'fila_completa.xlsx');
const FILA_ESPERA_FILE = path.join(DATA_DIR, 'lista_de_espera.xlsx');
const FATURAMENTO_FILE = path.join(DATA_DIR, 'faturamento.xlsx');
const IPS_BLOQUEADOS_FILE = path.join(DATA_DIR, 'ips_bloqueados.json');
const LOG_ACESSOS_FILE = path.join(DATA_DIR, 'log_acessos.json');
const NOMES_IPS_FILE = path.join(DATA_DIR, 'nomes_ips.json');
const WHITELIST_FILE = path.join(DATA_DIR, 'whitelist_ips.json');
const WHITELIST_ATIVA_FILE = path.join(DATA_DIR, 'whitelist_ativa.json');
const MAX_LOG_ACESSOS = 500;
const NOME_COOKIE_SESSAO = 'vc_admin';
const DURACAO_SESSAO_MS = 12 * 60 * 60 * 1000; // 12 horas

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.xlsx$/i.test(file.originalname);
    cb(ok ? null : new Error('Apenas arquivos .xlsx são aceitos'), ok);
  },
});

// --- Normalização de texto (remove nbsp, espaços extras, uppercase) ---
function limpar(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor)
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function limparUpper(valor) {
  return limpar(valor).toUpperCase();
}

// Converte "M/D/YY" (formato de origem da planilha) para "DD/MM/YYYY"
function formatarData(valor) {
  const texto = limpar(valor);
  if (!texto) return '';
  const m = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return texto;
  const [, mes, dia, anoRaw] = m;
  const ano = anoRaw.length === 2 ? `20${anoRaw}` : anoRaw;
  return `${dia.padStart(2, '0')}/${mes.padStart(2, '0')}/${ano}`;
}

// Extrai data ISO (YYYY-MM-DD) de "M/D/YY" para comparação, sem depender de fuso horário
function paraIso(valor) {
  const texto = limpar(valor);
  if (!texto) return null;
  const m = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const [, mes, dia, anoRaw] = m;
  const ano = anoRaw.length === 2 ? `20${anoRaw}` : anoRaw;
  return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
}

// Converte "DD/MM/YY" (formato da planilha de fila de espera) para ISO e exibição
function paraIsoDiaMesAno(valor) {
  const texto = limpar(valor);
  if (!texto) return null;
  const m = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const [, dia, mes, anoRaw] = m;
  const ano = anoRaw.length === 2 ? `20${anoRaw}` : anoRaw;
  return `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
}

function isoParaBr(iso) {
  if (!iso) return '';
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

// --- Base em memória ---
let registros = [];
let ultimaAtualizacao = null;
let ultimoErro = null;

let filaEspera = [];
let filaEsperaAtualizadaEm = null;
let filaEsperaErro = null;

function normalizarLinhaFila(linha) {
  const modelo = limparUpper(linha['MODELO']);
  if (!modelo) return null;
  const inclusaoIso = paraIsoDiaMesAno(linha['INCLUSÃO']);
  return {
    modelo,
    cor: limpar(linha['CORPRIMARIA']),
    cliente: limpar(linha['CLIENTE']),
    gestor: limpar(linha['GESTOR']),
    vendedor: limpar(linha['Coluna1']),
    processo: limpar(linha['PROCESSO']),
    inclusao: isoParaBr(inclusaoIso),
    inclusaoIso,
  };
}

function carregarFilaEspera(caminhoArquivo) {
  const workbook = XLSX.readFile(caminhoArquivo);
  const aba = workbook.Sheets['GERAL'];
  if (!aba) {
    throw new Error('Aba "GERAL" não encontrada na planilha de fila de espera.');
  }

  // A aba GERAL tem cabeçalho na linha 3 e um range interno inflado por
  // formatação herdada (!ref pode chegar a 1 milhão+ de linhas vazias),
  // então usamos a tabela nomeada real (A3:I<última linha com dado>).
  const refCompleto = XLSX.utils.decode_range(aba['!ref']);
  const linhasBrutas = XLSX.utils.sheet_to_json(aba, {
    defval: '',
    raw: false,
    range: XLSX.utils.encode_range({ s: { r: 2, c: 0 }, e: { r: Math.min(refCompleto.e.r, 2000), c: 8 } }),
  });

  const novaFila = [];
  for (const linha of linhasBrutas) {
    const registro = normalizarLinhaFila(linha);
    if (!registro) continue;
    novaFila.push(registro);
  }

  // Ordena por modelo e data de inclusão (mais antigo primeiro = posição 1 na fila)
  novaFila.sort((a, b) => {
    if (a.modelo !== b.modelo) return a.modelo.localeCompare(b.modelo);
    return (a.inclusaoIso || '').localeCompare(b.inclusaoIso || '');
  });

  filaEspera = novaFila;
  filaEsperaAtualizadaEm = new Date();
  filaEsperaErro = null;
  console.log(`[fila-espera] Carregados ${filaEspera.length} registros de ${caminhoArquivo}`);
}

function carregarFilaEsperaInicial() {
  try {
    if (fs.existsSync(FILA_ESPERA_FILE)) {
      carregarFilaEspera(FILA_ESPERA_FILE);
    } else {
      console.log('[fila-espera] Nenhuma planilha encontrada em data/. Aguardando upload.');
    }
  } catch (err) {
    filaEsperaErro = err.message;
    console.error('[fila-espera] Erro ao carregar planilha inicial:', err.message);
  }
}

// --- Faturamento (base de vendas, cruzada por chassi com a distribuição) ---
let faturamentoPorChassi = new Map();
let faturamentoAtualizadoEm = null;
let faturamentoErro = null;

function normalizarLinhaFaturamento(linha) {
  const chassi = limparUpper(linha['Chassi']);
  if (!chassi) return null;
  return {
    chassi,
    cliente: limpar(linha['Cliente']),
    vendedor: limpar(linha['Vendedor']),
    // "Data Venda" vem como DD/MM/YYYY, diferente do M/D/YY da distribuição
    dataVenda: isoParaBr(paraIsoDiaMesAno(linha['Data Venda'])),
  };
}

function carregarFaturamento(caminhoArquivo) {
  const workbook = XLSX.readFile(caminhoArquivo);
  const aba = workbook.Sheets[workbook.SheetNames[0]];
  const linhas = XLSX.utils.sheet_to_json(aba, { defval: '', raw: false });

  const mapa = new Map();
  for (const linha of linhas) {
    // A última linha do export é um rodapé de totais, sem chassi real
    const registro = normalizarLinhaFaturamento(linha);
    if (!registro) continue;
    mapa.set(registro.chassi, registro);
  }

  faturamentoPorChassi = mapa;
  faturamentoAtualizadoEm = new Date();
  faturamentoErro = null;
  console.log(`[faturamento] Carregados ${faturamentoPorChassi.size} registros de ${caminhoArquivo}`);
}

function carregarFaturamentoInicial() {
  try {
    if (fs.existsSync(FATURAMENTO_FILE)) {
      carregarFaturamento(FATURAMENTO_FILE);
    } else {
      console.log('[faturamento] Nenhuma planilha encontrada em data/. Aguardando upload.');
    }
  } catch (err) {
    faturamentoErro = err.message;
    console.error('[faturamento] Erro ao carregar planilha inicial:', err.message);
  }
}

// Datas de ENVIO (YYYY-MM-DD) distintas na base de distribuição, mais recentes primeiro
function diasDeEnvioDisponiveis() {
  const dias = new Set(registros.map((r) => r.envioIso).filter(Boolean));
  return Array.from(dias).sort((a, b) => b.localeCompare(a));
}

// Relatório "Guerrero": chassis distribuídos num dia, cruzados com faturamento
function relatorioGuerrero(envioIso) {
  return registros
    .filter((r) => r.envioIso === envioIso)
    .map((r) => {
      const faturado = faturamentoPorChassi.get(r.chassi);
      return {
        moto: r.moto,
        chassi: r.chassi,
        vendedorDistribuicao: r.vendedor,
        clienteDistribuicao: r.cliente,
        faturado: Boolean(faturado),
        vendedorFaturamento: faturado ? faturado.vendedor : '',
        clienteFaturamento: faturado ? faturado.cliente : '',
        dataVenda: faturado ? faturado.dataVenda : '',
      };
    });
}

// Associa o MOTO do chassi (nome técnico/completo) ao MODELO da fila de
// espera (nome comercial/curto). Os vocabulários das duas planilhas são
// diferentes (ex.: "CG160 TITAN" no chassi vs "TITAN" na fila), então o
// mapeamento é uma tabela fixa validada manualmente em vez de heurística de
// texto. Modelos do chassi sem entrada aqui não têm fila (retornam []).
const MAPA_MOTO_PARA_MODELO_FILA = {
  'BIZ 125': 'BIZ 125 ES',
  'BIZ 125 ES': 'BIZ 125 ES',
  'BIZ 125 EX': 'BIZ 125 EX',
  'BIZ 125 EX KUROMI': 'BIZ 125 EX',
  'BIZ EX': 'BIZ 125 EX',
  'CB 500 HORNET': 'CB 500 HORNET',
  'CB 650R': 'CB 650R',
  'CB1000 HORNET': 'CB 1000',
  'CB300F TWISTER ABS': 'CB 300 ABS',
  'CB300F TWISTER ABS S': 'CB 300 ABS',
  'CG160 TITAN': 'TITAN',
  'CRF 1100L': 'CRF 1100L',
  'CRF 1100L  AS DCT': 'CRF 1100L',
  'CRF 1100L DCT': 'CRF 1100L',
  'CRF 300F': 'CRF 300F',
  'NX 500': 'NX 500',
  'POP110I ES': 'POP',
  'TRX420 FM': 'TRX',
  'XR300L TORNADO': 'TORNADO',
  'XR300L TORNADO SE': 'TORNADO',
  'XRE 190': 'XRE 190 STD',
  'XRE 190 ADV': 'XRE 190 STD',
  'XRE 300 SAHARA': 'SAHARA',
  'XRE 300 SAHARA ADV': 'SAHARA',
  'XRE 300 SAHARA RALLY': 'SAHARA',
};

// Reduz a cor à sua "cor base" (primeira palavra), já que o chassi usa
// nomes granulares (ex.: "CINZA PER", "PRETA MET.", "VERM.FOSCA") e a fila
// usa nomes simples (ex.: "CINZA", "PRETA", "VERMELHA").
const CORINGAS_COR = new Set(['QLQ COR', 'QUALQUER COR']);

function corBase(cor) {
  const upper = limparUpper(cor);
  if (!upper) return '';
  if (CORINGAS_COR.has(upper)) return '*';
  // "VERM.MET" -> "VERM" (aproxima de VERMELHA pelo prefixo comum)
  const primeiraPalavra = upper.split(/[\s.]+/)[0];
  return primeiraPalavra;
}

function coresCompativeis(corChassi, corFila) {
  const baseFila = corBase(corFila);
  if (baseFila === '*') return true; // fila aceita qualquer cor
  const baseChassi = corBase(corChassi);
  if (!baseChassi || !baseFila) return false;
  // "VERM" (do chassi) deve bater com "VERMELHA" (da fila) e vice-versa
  return baseChassi.startsWith(baseFila) || baseFila.startsWith(baseChassi);
}

function filaDoModelo(moto, cor) {
  const motoUpper = limparUpper(moto);
  const modeloFila = MAPA_MOTO_PARA_MODELO_FILA[motoUpper];
  if (!modeloFila) return [];

  return filaEspera
    .filter((f) => f.modelo === modeloFila)
    .filter((f) => (cor ? coresCompativeis(cor, f.cor) : true))
    .map((f, i) => ({ posicao: i + 1, ...f }));
}

function normalizarLinha(linha) {
  const chassi = limparUpper(linha['CHASSI']);
  if (!chassi) return null;
  return {
    chassi,
    ultimos4: chassi.slice(-4),
    moto: limpar(linha['MOTO']),
    cor: limpar(linha['COR']),
    cliente: limpar(linha['CLIENTE']),
    gestor: limpar(linha['GESTOR']),
    vendedor: limpar(linha['VENDEDOR']),
    status: limpar(linha['Coluna1'] ?? linha['MODALIDADE']),
    cod: limpar(linha['CÓD.']),
    envio: formatarData(linha['ENVIO']),
    envioIso: paraIso(linha['ENVIO']),
    vence: formatarData(linha['VENCE']),
    venceIso: paraIso(linha['VENCE']),
  };
}

function carregarPlanilha(caminhoArquivo) {
  const workbook = XLSX.readFile(caminhoArquivo);

  // Usa a primeira aba não vazia com coluna CHASSI
  let linhas = [];
  for (const nomeAba of workbook.SheetNames) {
    const aba = workbook.Sheets[nomeAba];
    const json = XLSX.utils.sheet_to_json(aba, { defval: '', raw: false });
    if (json.length > 0 && 'CHASSI' in json[0]) {
      linhas = linhas.concat(json);
    }
  }

  const novosRegistros = [];
  for (const linha of linhas) {
    const registro = normalizarLinha(linha);
    if (!registro) continue;
    // Mantém todas as ocorrências do mesmo chassi (ex.: distribuição original
    // + redistribuição após vencimento para outro cliente)
    novosRegistros.push(registro);
  }

  registros = novosRegistros;
  ultimaAtualizacao = new Date();
  ultimoErro = null;
  console.log(`[base] Carregados ${registros.length} registros de ${caminhoArquivo}`);
}

function carregarInicial() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      carregarPlanilha(DATA_FILE);
    } else {
      console.log('[base] Nenhuma planilha encontrada em data/. Aguardando upload.');
    }
  } catch (err) {
    ultimoErro = err.message;
    console.error('[base] Erro ao carregar planilha inicial:', err.message);
  }
}

// --- Admin: sessão, IPs bloqueados, log de acessos (persistidos em data/) ---
function segredoSessao() {
  const senha = process.env.ADMIN_PASSWORD;
  if (!senha) throw new Error('ADMIN_PASSWORD não configurada.');
  return senha;
}

function criarTokenSessao() {
  const expiraEm = Date.now() + DURACAO_SESSAO_MS;
  const assinatura = crypto.createHmac('sha256', segredoSessao()).update(String(expiraEm)).digest('hex');
  return `${expiraEm}.${assinatura}`;
}

function tokenSessaoValido(token) {
  if (!token) return false;
  const [expiraEmStr, assinatura] = String(token).split('.');
  if (!expiraEmStr || !assinatura) return false;
  const expiraEm = Number(expiraEmStr);
  if (!Number.isFinite(expiraEm) || expiraEm < Date.now()) return false;
  const esperado = crypto.createHmac('sha256', segredoSessao()).update(expiraEmStr).digest('hex');
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function senhaCorreta(senhaInformada) {
  const esperada = process.env.ADMIN_PASSWORD;
  if (!esperada || !senhaInformada) return false;
  const a = Buffer.from(String(senhaInformada));
  const b = Buffer.from(String(esperada));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function exigirSessao(req, res, next) {
  if (!tokenSessaoValido(req.cookies?.[NOME_COOKIE_SESSAO])) {
    return res.status(401).json({ erro: 'Não autenticado.' });
  }
  next();
}

function lerJsonSeguro(caminho, valorPadrao) {
  try {
    if (!fs.existsSync(caminho)) return valorPadrao;
    return JSON.parse(fs.readFileSync(caminho, 'utf8'));
  } catch {
    return valorPadrao;
  }
}

function carregarIpsBloqueados() {
  const lista = lerJsonSeguro(IPS_BLOQUEADOS_FILE, []);
  return Array.isArray(lista) ? lista : [];
}

function salvarIpsBloqueados(lista) {
  fs.writeFileSync(IPS_BLOQUEADOS_FILE, JSON.stringify(lista));
}

function registrarAcesso(ip) {
  if (!ip) return;
  try {
    const log = lerJsonSeguro(LOG_ACESSOS_FILE, []);
    log.unshift({ ip, em: new Date().toISOString() });
    fs.writeFileSync(LOG_ACESSOS_FILE, JSON.stringify(log.slice(0, MAX_LOG_ACESSOS)));
  } catch (e) {
    console.error('[admin] Erro ao registrar acesso:', e.message);
  }
}

function resumoIps(log, nomesIps) {
  const porIp = new Map();
  for (const item of log) {
    if (!porIp.has(item.ip)) {
      porIp.set(item.ip, { ip: item.ip, nome: nomesIps[item.ip] || '', total: 0, ultimoAcesso: item.em });
    }
    porIp.get(item.ip).total += 1;
  }
  return Array.from(porIp.values()).sort((a, b) => b.ultimoAcesso.localeCompare(a.ultimoAcesso));
}

function carregarNomesIps() {
  const mapa = lerJsonSeguro(NOMES_IPS_FILE, {});
  return mapa && typeof mapa === 'object' ? mapa : {};
}

function salvarNomeIp(ip, nome) {
  const mapa = carregarNomesIps();
  if (nome) {
    mapa[ip] = nome;
  } else {
    delete mapa[ip];
  }
  fs.writeFileSync(NOMES_IPS_FILE, JSON.stringify(mapa));
  return mapa;
}

function carregarWhitelist() {
  const lista = lerJsonSeguro(WHITELIST_FILE, []);
  return Array.isArray(lista) ? lista : [];
}

function salvarWhitelist(lista) {
  fs.writeFileSync(WHITELIST_FILE, JSON.stringify(lista));
}

function whitelistEstaAtiva() {
  return lerJsonSeguro(WHITELIST_ATIVA_FILE, false) === true;
}

function definirWhitelistAtiva(ativa) {
  fs.writeFileSync(WHITELIST_ATIVA_FILE, JSON.stringify(Boolean(ativa)));
}

function ipDoRequest(req) {
  // Atrás de proxy (Railway, Netlify, etc.) o IP real vem em X-Forwarded-For
  const xff = req.headers['x-forwarded-for'];
  if (xff) return xff.split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

carregarInicial();
carregarFilaEsperaInicial();
carregarFaturamentoInicial();

// --- App ---
const app = express();
app.use(cookieParser());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => {
  res.json({
    totalChassis: registros.length,
    ultimaAtualizacao,
    ultimoErro,
    totalFilaEspera: filaEspera.length,
    filaEsperaAtualizadaEm,
    filaEsperaErro,
    totalFaturamento: faturamentoPorChassi.size,
    faturamentoAtualizadoEm,
    faturamentoErro,
  });
});

app.get('/api/fila-resumo', (req, res) => {
  const porModelo = new Map();
  for (const item of filaEspera) {
    if (!porModelo.has(item.modelo)) {
      porModelo.set(item.modelo, { modelo: item.modelo, total: 0, cores: new Map() });
    }
    const grupo = porModelo.get(item.modelo);
    grupo.total += 1;
    const cor = item.cor || 'SEM COR';
    grupo.cores.set(cor, (grupo.cores.get(cor) || 0) + 1);
  }

  const resumo = Array.from(porModelo.values())
    .map((g) => ({
      modelo: g.modelo,
      total: g.total,
      cores: Array.from(g.cores.entries())
        .map(([cor, quantidade]) => ({ cor, quantidade }))
        .sort((a, b) => b.quantidade - a.quantidade),
    }))
    .sort((a, b) => b.total - a.total);

  res.json({ total: filaEspera.length, resumo });
});

app.get('/api/buscar', (req, res) => {
  const ip = ipDoRequest(req);
  if (ip && carregarIpsBloqueados().includes(ip)) {
    return res.status(403).json({ erro: 'Acesso bloqueado.' });
  }
  if (whitelistEstaAtiva() && !(ip && carregarWhitelist().includes(ip))) {
    return res.status(403).json({ erro: 'Acesso restrito. Fale com o administrador para liberar este acesso.' });
  }
  registrarAcesso(ip);

  const termo = limparUpper(req.query.q || '');
  if (!termo) {
    return res.status(400).json({ erro: 'Informe os últimos dígitos do chassi.' });
  }
  if (!/^[A-Z0-9]{2,17}$/.test(termo)) {
    return res.status(400).json({ erro: 'Digite apenas letras e números do chassi.' });
  }

  const resultados = registros
    .filter((r) => r.chassi.endsWith(termo))
    .sort((a, b) => (b.venceIso || '').localeCompare(a.venceIso || ''))
    .map((r) => {
      const fila = filaDoModelo(r.moto, r.cor);
      return { ...r, temFila: fila.length > 0, totalFila: fila.length };
    });
  res.json({ termo, total: resultados.length, resultados });
});

app.get('/api/fila-modelo', (req, res) => {
  const moto = req.query.moto || '';
  const cor = req.query.cor || '';
  if (!moto) {
    return res.status(400).json({ erro: 'Informe o modelo (moto) para consultar a fila.' });
  }
  const fila = filaDoModelo(moto, cor);
  res.json({ moto, cor, total: fila.length, fila });
});

app.post('/api/upload', exigirSessao, (req, res) => {
  upload.single('planilha')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ erro: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });
    }
    try {
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      // Grava temporário e recarrega usando o mesmo caminho de leitura
      fs.writeFileSync(DATA_FILE, req.file.buffer);
      carregarPlanilha(DATA_FILE);
      res.json({ ok: true, totalChassis: registros.length, ultimaAtualizacao });
    } catch (e) {
      ultimoErro = e.message;
      res.status(400).json({ erro: 'Não foi possível processar a planilha: ' + e.message });
    }
  });
});

app.post('/api/upload-fila', exigirSessao, (req, res) => {
  upload.single('planilha')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ erro: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });
    }
    try {
      fs.writeFileSync(FILA_ESPERA_FILE, req.file.buffer);
      carregarFilaEspera(FILA_ESPERA_FILE);
      res.json({ ok: true, totalFilaEspera: filaEspera.length, filaEsperaAtualizadaEm });
    } catch (e) {
      filaEsperaErro = e.message;
      res.status(400).json({ erro: 'Não foi possível processar a planilha de fila de espera: ' + e.message });
    }
  });
});

app.post('/api/upload-faturamento', exigirSessao, (req, res) => {
  upload.single('planilha')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ erro: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });
    }
    try {
      fs.writeFileSync(FATURAMENTO_FILE, req.file.buffer);
      carregarFaturamento(FATURAMENTO_FILE);
      res.json({ ok: true, totalFaturamento: faturamentoPorChassi.size, faturamentoAtualizadoEm });
    } catch (e) {
      faturamentoErro = e.message;
      res.status(400).json({ erro: 'Não foi possível processar a planilha de faturamento: ' + e.message });
    }
  });
});

app.get('/api/guerrero-dias', (req, res) => {
  res.json({ dias: diasDeEnvioDisponiveis() });
});

app.get('/api/guerrero', (req, res) => {
  const dia = req.query.dia || '';
  if (!dia) {
    return res.status(400).json({ erro: 'Informe o dia (formato YYYY-MM-DD).' });
  }
  const itens = relatorioGuerrero(dia);
  res.json({ dia, total: itens.length, itens });
});

app.post('/api/admin-login', (req, res) => {
  const { senha } = req.body || {};
  if (!senhaCorreta(senha)) {
    return res.status(401).json({ erro: 'Senha incorreta.' });
  }
  res.cookie(NOME_COOKIE_SESSAO, criarTokenSessao(), {
    httpOnly: true,
    sameSite: 'strict',
    maxAge: DURACAO_SESSAO_MS,
  });
  res.json({ ok: true });
});

app.post('/api/admin-logout', (req, res) => {
  res.clearCookie(NOME_COOKIE_SESSAO);
  res.json({ ok: true });
});

app.get('/api/admin-dados', exigirSessao, (req, res) => {
  const log = lerJsonSeguro(LOG_ACESSOS_FILE, []);
  res.json({
    totalChassis: registros.length,
    ultimaAtualizacao,
    totalFilaEspera: filaEspera.length,
    filaEsperaAtualizadaEm,
    totalFaturamento: faturamentoPorChassi.size,
    faturamentoAtualizadoEm,
    ipsBloqueados: carregarIpsBloqueados(),
    ips: resumoIps(log, carregarNomesIps()),
    whitelist: carregarWhitelist(),
    whitelistAtiva: whitelistEstaAtiva(),
  });
});

app.post('/api/admin-bloquear-ip', exigirSessao, (req, res) => {
  const { ip, acao } = req.body || {};
  if (!ip) {
    return res.status(400).json({ erro: 'Informe o IP.' });
  }
  const atual = carregarIpsBloqueados();
  const novaLista =
    acao === 'desbloquear' ? atual.filter((item) => item !== ip) : Array.from(new Set([...atual, ip]));
  salvarIpsBloqueados(novaLista);
  res.json({ ok: true, ipsBloqueados: novaLista });
});

app.post('/api/admin-nomear-ip', exigirSessao, (req, res) => {
  const { ip, nome } = req.body || {};
  if (!ip) {
    return res.status(400).json({ erro: 'Informe o IP.' });
  }
  const nomesIps = salvarNomeIp(ip, (nome || '').trim());
  res.json({ ok: true, nomesIps });
});

app.post('/api/admin-whitelist', exigirSessao, (req, res) => {
  const { ip, acao } = req.body || {};

  if (acao === 'ativar' || acao === 'desativar') {
    definirWhitelistAtiva(acao === 'ativar');
    return res.json({ ok: true, whitelistAtiva: whitelistEstaAtiva() });
  }

  if (!ip) {
    return res.status(400).json({ erro: 'Informe o IP.' });
  }
  const atual = carregarWhitelist();
  const novaLista = acao === 'remover' ? atual.filter((item) => item !== ip) : Array.from(new Set([...atual, ip]));
  salvarWhitelist(novaLista);
  res.json({ ok: true, whitelist: novaLista });
});

app.listen(PORT, () => {
  console.log(`Verificador de Chassi rodando em http://localhost:${PORT}`);
});
