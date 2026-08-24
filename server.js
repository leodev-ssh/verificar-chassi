const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3300;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'fila_completa.xlsx');

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

// --- Base em memória ---
let registros = [];
let ultimaAtualizacao = null;
let ultimoErro = null;

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

  const mapaPorChassi = new Map();
  for (const linha of linhas) {
    const registro = normalizarLinha(linha);
    if (!registro) continue;
    // Em caso de chassi duplicado (reenvio), mantém o último encontrado
    mapaPorChassi.set(registro.chassi, registro);
  }

  registros = Array.from(mapaPorChassi.values());
  ultimaAtualizacao = new Date();
  ultimoErro = null;
  console.log(`[base] Carregados ${registros.length} chassis únicos de ${caminhoArquivo}`);
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

// --- App ---
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (req, res) => {
  res.json({
    totalChassis: registros.length,
    ultimaAtualizacao,
    ultimoErro,
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

  const resultados = registros.filter((r) => r.chassi.endsWith(termo));
  res.json({ termo, total: resultados.length, resultados });
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

app.listen(PORT, () => {
  console.log(`Verificador de Chassi rodando em http://localhost:${PORT}`);
});
