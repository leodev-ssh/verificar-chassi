const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3300;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'fila_completa.xlsx');
const FILA_ESPERA_FILE = path.join(DATA_DIR, 'lista_de_espera.xlsx');

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

function filaDoModelo(moto) {
  const motoUpper = limparUpper(moto);
  const modeloFila = MAPA_MOTO_PARA_MODELO_FILA[motoUpper];
  if (!modeloFila) return [];

  return filaEspera
    .filter((f) => f.modelo === modeloFila)
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

carregarInicial();
carregarFilaEsperaInicial();

// --- App ---
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => {
  res.json({
    totalChassis: registros.length,
    ultimaAtualizacao,
    ultimoErro,
    totalFilaEspera: filaEspera.length,
    filaEsperaAtualizadaEm,
    filaEsperaErro,
  });
});

app.get('/api/buscar', (req, res) => {
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
      const fila = filaDoModelo(r.moto);
      return { ...r, temFila: fila.length > 0, totalFila: fila.length };
    });
  res.json({ termo, total: resultados.length, resultados });
});

app.get('/api/fila-modelo', (req, res) => {
  const moto = req.query.moto || '';
  if (!moto) {
    return res.status(400).json({ erro: 'Informe o modelo (moto) para consultar a fila.' });
  }
  const fila = filaDoModelo(moto);
  res.json({ moto, total: fila.length, fila });
});

app.post('/api/upload', (req, res) => {
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

app.post('/api/upload-fila', (req, res) => {
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

app.listen(PORT, () => {
  console.log(`Verificador de Chassi rodando em http://localhost:${PORT}`);
});
