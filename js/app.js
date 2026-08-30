// ============================================================
//  CONTROLE DE LAVAGEM DE COLHEDORAS
//  Aplicativo frontend (vanilla JS) - comunicacao via JSONP
//  com o Google Apps Script (lavcol_fixed.js)
// ============================================================

// ============================================================
//  CONFIGURAÇÃO
// ============================================================
const CONFIG = {
    // URL publicada do Web App do Google Apps Script
    webAppUrl: 'https://script.google.com/macros/s/AKfycbx-zKQxjSLlka1b5C2uFf6MegIw7UdGnscbN9dtI9FDhN3goHhEexJmc1MACsPxLUW3ug/exec',
    // Planilha de apoio (apenas para referencia do usuario)
    editUrl: 'https://docs.google.com/spreadsheets/d/16neBQx7o74lyVqqbZxfz9twHJnzj-slDETEIFQPUqtI/edit?usp=sharing',
    // Chaves de armazenamento local
    chaveBanco: 'lavagemBancoLocal',
    chaveOriginais: 'lavagemDadosOriginais',
    chaveDevice: 'lavagemDeviceId',
    chaveUltimoSync: 'lavagemLastSync',
    chavePendentes: 'lavagemPendentes',
    // Timeout (ms) aguardado apos envio via iframe (fallback de seguranca;
    // o iframe tambem resolve mais cedo via evento "load" quando o Apps
    // Script responde antes disso)
    timeoutIframe: 1500,
    timeoutIframeCritico: 8000,
    // Por quanto tempo (ms) um registro recem-criado localmente e protegido
    // contra ser sobrescrito por uma leitura da planilha que ainda nao o reflete
    janelaPendente: 5 * 60 * 1000
};

// ============================================================
//  TURNO (limites em minutos desde meia-noite)
// ============================================================
const TURNO_A_INICIO = 7 * 60 + 45;   // 07:45
const TURNO_A_FIM = 15 * 60 + 45;     // 15:45
const TURNO_B_INICIO = 15 * 60 + 46;  // 15:46
const TURNO_B_FIM = 23 * 60 + 45;     // 23:45
const TURNO_C_INICIO = 23 * 60 + 46;  // 23:46
const TURNO_C_FIM = 7 * 60 + 44;      // 07:44 (madrugada)
const GRUPO_OFICINA = 'OFICINA';

// ============================================================
//  ROSTER_SEED (elenco padrao de colhedoras por frente)
// ============================================================
const ROSTER_SEED = [
    ['FRENTE - 08', '80118'], ['FRENTE - 08', '80317'],
    ['FRENTE - 10', '80119'], ['FRENTE - 10', '80719'],
    ['FRENTE - 11', '80319'], ['FRENTE - 11', '80217'], ['FRENTE - 11', '80419'],
    ['FRENTE - 12', '80316'], ['FRENTE - 12', '80320'],
    ['FRENTE - 13', '80124'], ['FRENTE - 13', '80224'],
    ['FRENTE - 14', '80219'], ['FRENTE - 14B', '80422'], ['FRENTE - 14A', '80122'],
    ['FRENTE - 14B', '80420'], ['FRENTE - 14B', '80222'], ['FRENTE - 14A', '80322'],
    ['FRENTE - 15', '80120'], ['FRENTE - 15', '80519'], ['FRENTE - 15', '80619']
];

// ============================================================
//  ESTADO EM MEMORIA
// ============================================================
let registros = [];           // registros filtrados/exibidos
let registrosOriginais = [];  // base completa (todos os dias)
let edicaoFrotaId = null;     // id em edicao no modal
let carregando = false;       // trava de requisicoes
let toastTimeout = null;      // controle do toast

// ============================================================
//  VALIDAÇÃO DE DADOS
// ============================================================
function isValidFrente(frente) {
    if (!frente || typeof frente !== 'string') return false;
    const t = frente.trim();
    return t.length >= 5 && t.toUpperCase().includes('FRENTE');
}

function isValidFrota(frota) {
    if (!frota || typeof frota !== 'string') return false;
    const t = frota.trim();
    return t.length >= 3 && /\d/.test(t);
}

function isValidRegistro(reg) {
    return isValidFrente(reg.frente) && isValidFrota(reg.frota);
}

function filtrarRegistrosValidos(dados) {
    if (!Array.isArray(dados)) return [];
    return dados.filter(function (r) { return isValidRegistro(r); });
}

// ============================================================
//  TURNO E DIA OPERACIONAL
// ============================================================
function calcularTurnoPorHorario(date) {
    date = date || new Date();
    const min = date.getHours() * 60 + date.getMinutes();
    if (min >= TURNO_A_INICIO && min <= TURNO_A_FIM) return 'A';
    if (min >= TURNO_B_INICIO && min <= TURNO_B_FIM) return 'B';
    return 'C';
}

function calcularDataOperacional(date) {
    date = date || new Date();
    const min = date.getHours() * 60 + date.getMinutes();
    const d = new Date(date);
    if (min < TURNO_A_INICIO) d.setDate(d.getDate() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
}

function getDataAtual() {
    return calcularDataOperacional();
}

// Bloqueio de seguranca: registros com mais de 48h nao sao alterados
function ehMais48h(dataRef) {
    if (!dataRef) return true;
    const partes = String(dataRef).split('-');
    if (partes.length !== 3) return true;
    const ref = new Date(parseInt(partes[0], 10), parseInt(partes[1], 10) - 1, parseInt(partes[2], 10));
    const diffMs = new Date() - ref;
    const diffHoras = diffMs / (1000 * 60 * 60);
    return diffHoras > 48;
}

// ============================================================
//  ESTRUTURA PADRÃO / ROSTER
// ============================================================
function obterRosterAtual() {
    if (registrosOriginais.length === 0) return ROSTER_SEED;
    const mapa = new Map();
    registrosOriginais.forEach(function (r) {
        if (r.frota) mapa.set(r.frota, r.frente);
    });
    return Array.from(mapa.entries()).map(function (par) {
        return [par[1], par[0]];
    });
}

// Normaliza um registro vindo do servidor/local
function normalizarRegistro(r, idx) {
    r = r || {};
    return {
        id: r.id != null ? r.id : (idx != null ? idx + 1 : Date.now()),
        frente: (r.frente || '').toString().trim(),
        frota: (r.frota || '').toString().trim(),
        turno: r.turno || null,
        data: r.data || getDataAtual(),
        status: r.status || 'NAOOK',
        oficina: !!r.oficina,
        desativada: !!r.desativada,
        frenteOriginal: r.frenteOriginal || null,
        updatedAt: r.updatedAt || new Date().toISOString()
    };
}

// ============================================================
//  DEVICE ID (identificacao do dispositivo para sync)
// ============================================================
function getDeviceId() {
    let id = null;
    try { id = localStorage.getItem(CONFIG.chaveDevice); } catch (e) { id = null; }
    if (!id) {
        id = 'device_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
        try { localStorage.setItem(CONFIG.chaveDevice, id); } catch (e) { }
    }
    return id;
}

// ============================================================
//  BANCO LOCAL (JSON persistido em localStorage)
// ============================================================
function getBancoLocal() {
    try {
        const data = localStorage.getItem(CONFIG.chaveBanco);
        if (!data) return null;
        const banco = JSON.parse(data);
        return (banco && Array.isArray(banco.registros)) ? banco : null;
    } catch (e) {
        return null;
    }
}

function salvarBancoLocal(banco) {
    try {
        localStorage.setItem(CONFIG.chaveBanco, JSON.stringify(banco));
        if (banco && banco.lastSync) {
            localStorage.setItem(CONFIG.chaveUltimoSync, banco.lastSync);
        }
    } catch (e) {
        mostrarToast('Erro ao salvar banco local', 'error');
    }
}

// Atalho para persistir o estado atual como banco local
function montarBancoLocal() {
    return {
        version: '1.0',
        deviceId: getDeviceId(),
        lastSync: new Date().toISOString(),
        registros: registrosOriginais.map(function (r) {
            return Object.assign({}, r, { updatedAt: r.updatedAt || new Date().toISOString() });
        })
    };
}

// ============================================================
//  LOCAL STORAGE (cache simples de originais)
// ============================================================
function salvarLocal() {
    try {
        localStorage.setItem(CONFIG.chaveOriginais, JSON.stringify(registrosOriginais));
    } catch (e) { }
}

function carregarLocal() {
    try {
        const salvo = localStorage.getItem(CONFIG.chaveOriginais);
        if (!salvo) return false;
        const parsed = JSON.parse(salvo);
        if (Array.isArray(parsed) && parsed.length > 0) {
            registrosOriginais = parsed.map(function (r, i) { return normalizarRegistro(r, i); });
            return true;
        }
    } catch (e) { }
    return false;
}

// ============================================================
//  FILA DE PENDENTES (escritas locais ainda nao confirmadas na planilha)
//  Evita que uma sincronizacao com a planilha "apague" um registro que
//  acabou de ser criado/alterado localmente mas ainda nao propagou no
//  Apps Script (ex: usuario deu F5 logo apos adicionar uma colhedora).
// ============================================================
function getPendentes() {
    try {
        const salvo = localStorage.getItem(CONFIG.chavePendentes);
        const lista = salvo ? JSON.parse(salvo) : [];
        return Array.isArray(lista) ? lista : [];
    } catch (e) {
        return [];
    }
}

function salvarPendentes(lista) {
    try { localStorage.setItem(CONFIG.chavePendentes, JSON.stringify(lista)); } catch (e) { }
}

// Registra que "frota" foi criada/alterada localmente e ainda precisa
// ser confirmada na planilha antes de poder ser descartada por um sync.
function marcarPendente(frota, data) {
    if (!frota) return;
    const lista = getPendentes().filter(function (p) { return p.frota !== frota; });
    lista.push({ frota: frota, data: data || getDataAtual(), ts: Date.now() });
    salvarPendentes(lista);
}

// Remove "frota" da fila de pendentes (ja confirmada na planilha ou excluida).
function desmarcarPendente(frota) {
    const lista = getPendentes().filter(function (p) { return p.frota !== frota; });
    salvarPendentes(lista);
}

// Garante que registros pendentes recentes nao sumam de um novo "registrosOriginais"
// vindo do servidor, e limpa da fila qualquer pendente que ja tenha expirado
// ou que ja esteja presente na resposta do servidor.
function mesclarPendentesEm(listaServidor) {
    const pendentes = getPendentes();
    if (pendentes.length === 0) return listaServidor;

    const agora = Date.now();
    const aindaValidos = [];
    const porFrotaServidor = new Set(listaServidor.map(function (r) { return r.frota; }));
    const resultado = listaServidor.slice();

    pendentes.forEach(function (p) {
        const expirado = (agora - p.ts) > CONFIG.janelaPendente;
        if (porFrotaServidor.has(p.frota)) {
            // Servidor ja confirmou este registro — pode sair da fila
            return;
        }
        if (expirado) {
            // Demorou demais para confirmar; nao mantem mais como pendente
            return;
        }
        aindaValidos.push(p);
        // Mantem a versao local (que ja esta em registrosOriginais) na lista mesclada
        const localCorrespondente = registrosOriginais.find(function (r) { return r.frota === p.frota; });
        if (localCorrespondente) resultado.push(localCorrespondente);
    });

    salvarPendentes(aindaValidos);
    return resultado;
}

// Reenvia ao Apps Script qualquer acao ainda pendente (ex: apos perda de conexao)
function reenviarPendentes() {
    const pendentes = getPendentes();
    if (pendentes.length === 0) return;
    pendentes.forEach(function (p) {
        const r = registrosOriginais.find(function (x) { return x.frota === p.frota; });
        if (!r) { desmarcarPendente(p.frota); return; }
        enviarAcao({ acao: 'adicionar', frente: r.frente, frota: r.frota, data: r.data });
    });
}

// ============================================================
//  APLICAR FILTRO DE DATA ATUAL
// ============================================================
function aplicarFiltroDataAtual() {
    const dataAtual = getDataAtual();
    const dataInput = document.getElementById('filterData');
    if (dataInput) dataInput.value = dataAtual;
    registros = registrosOriginais.filter(function (r) { return r.data === dataAtual; });
}

// ============================================================
//  CARREGAR DADOS SALVOS (banco local ou cache)
// ============================================================
function carregarDadosSalvos() {
    const banco = getBancoLocal();
    if (banco && banco.registros && banco.registros.length > 0) {
        registrosOriginais = banco.registros.map(function (r, i) { return normalizarRegistro(r, i); });
        salvarLocal();
        aplicarFiltroDataAtual();
        renderizarTudo();
        const lastSync = banco.lastSync ? new Date(banco.lastSync).toLocaleString('pt-BR') : 'desconhecido';
        setStatus('📂 <span class="info">' + registrosOriginais.length + ' registros locais (banco: ' + lastSync + ')</span>');
        return true;
    }

    if (carregarLocal()) {
        aplicarFiltroDataAtual();
        renderizarTudo();
        setStatus('📂 <span class="info">' + registrosOriginais.length + ' registros locais (cache)</span>');
        return true;
    }
    return false;
}

// ============================================================
//  HELPER DE STATUS
// ============================================================
function setStatus(html) {
    const el = document.getElementById('statusText');
    if (el) el.innerHTML = html;
}


// ============================================================
//  SKELETON LOADING (feedback na tabela)
// ============================================================
function showSkeletonLoading(count) {
    count = count || 8;
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;
    let html = '';
    for (let i = 0; i < count; i++) {
        html += '<tr><td colspan="5" style="padding:8px;">' +
            '<div class="skeleton skeleton-row" style="height:18px;border-radius:6px;background:linear-gradient(90deg,#e2e8f0,#edf2f7,#e2e8f0);background-size:200% 100%;animation:shimmer 1.2s infinite;"></div>' +
            '</td></tr>';
    }
    tbody.innerHTML = html;
}

// ============================================================
//  LER GOOGLE SHEETS (JSONP)
// ============================================================
function lerGoogleSheets() {
    if (carregando) return;
    carregando = true;

    const tbody = document.getElementById('tableBody');
    const statusText = document.getElementById('statusText');
    showSkeletonLoading(8);
    setStatus('⏳ <span class="loading">Conectando...</span>');

    const callbackName = 'jsonpCallback_' + Date.now();
    const script = document.createElement('script');

    console.log('[Lavagem] Buscando planilha:', CONFIG.webAppUrl);
    console.log('[Lavagem] Callback:', callbackName);

    window[callbackName] = function (data) {
        carregando = false;
        try { delete window[callbackName]; } catch (e) { }
        try { document.body.removeChild(script); } catch (e) { }

        console.log('[Lavagem] Resposta JSONP:', data);

        if (!data || data.erro) {
            setStatus('❌ <span class="erro">Erro: ' + (data ? data.erro : 'sem resposta') + '</span>');
            mostrarToast('Erro ao buscar planilha', 'error');
            return;
        }

        if (data.dados && data.dados.length > 0) {
            const dadosValidos = filtrarRegistrosValidos(data.dados);
            if (dadosValidos.length === 0) {
                setStatus('⚠️ <span class="erro">Nenhum registro valido encontrado</span>');
                return;
            }

            const mesclados = mesclarPendentesEm(dadosValidos);
            registrosOriginais = mesclados.map(function (r, i) { return normalizarRegistro(r, i); });
            salvarLocal();
            salvarBancoLocal(montarBancoLocal());
            aplicarFiltroDataAtual();
            renderizarTudo();
            setStatus('✅ <span class="ok">' + registrosOriginais.length + ' registros na planilha</span>');
        } else {
            setStatus('ℹ️ <span class="info">Planilha vazia — sem registros</span>');
        }
    };

    script.src = CONFIG.webAppUrl + '?callback=' + encodeURIComponent(callbackName);
    console.log('[Lavagem] Requisição:', script.src);
    script.onerror = function () {
        carregando = false;
        try { delete window[callbackName]; } catch (e) { }
        try { document.body.removeChild(script); } catch (e) { }
        setStatus('❌ <span class="erro">Erro de conexao com a planilha</span>');
        mostrarToast('Erro de conexao — verifique a internet', 'error');
    };
    document.body.appendChild(script);

    let tentativas = 0;
    const MAX_TENTATIVAS = 2;

    function timeoutHandler() {
        if (!carregando) return;
        carregando = false;
        try { delete window[callbackName]; } catch (e) { }
        try { document.body.removeChild(script); } catch (e) { }

        tentativas++;
        if (tentativas < MAX_TENTATIVAS) {
            setStatus('🔄 <span class="loading">Tentando novamente...</span>');
            setTimeout(lerGoogleSheets, 1500);
        } else {
            setStatus('❌ <span class="erro">Timeout de conexao — verifique o Web App</span>');
            mostrarToast('Timeout — verifique o Web App do Apps Script', 'error');
        }
    }

    setTimeout(timeoutHandler, 12000);
}

// ============================================================


// ============================================================
//  CRIAR REGISTROS DO DIA (via iframe GET)
// ============================================================
function criarRegistrosDia() {
    const dataAtual = getDataAtual();
    const statusText = document.getElementById('statusText');

    try {
        const frentesFrotas = obterRosterAtual();
        const payload = {
            acao: 'criarRegistrosDia',
            data: dataAtual,
            frentesFrotas: frentesFrotas
        };

        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = CONFIG.webAppUrl + '?dados=' + encodeURIComponent(JSON.stringify(payload));
        document.body.appendChild(iframe);

        setTimeout(function () {
            try { document.body.removeChild(iframe); } catch (e) { }
            if (statusText) statusText.innerHTML = '✅ <span class="ok">Registros criados para ' + dataAtual + '</span>';
            lerGoogleSheets();
        }, CONFIG.timeoutIframe);
    } catch (error) {
        console.error('Erro ao criar registros:', error);
        mostrarToast('Erro ao criar registros do dia', 'error');
        carregarDadosSalvos();
    }
}

// ============================================================
//  SALVAR GOOGLE SHEETS (um registro por vez via iframe)
// ============================================================
function salvarGoogleSheets() {
    const statusText = document.getElementById('statusText');
    if (statusText) statusText.innerHTML = '⏳ <span class="loading">Salvando...</span>';

    try {
        const promessas = registros.map(function (r) {
            return new Promise(function (resolve) {
                const payload = {
                    acao: 'atualizarStatus',
                    frota: r.frota,
                    data: r.data,
                    status: r.status,
                    turno: r.turno || '',
                    frente: r.frente
                };

                const iframe = document.createElement('iframe');
                iframe.style.display = 'none';
                iframe.src = CONFIG.webAppUrl + '?dados=' + encodeURIComponent(JSON.stringify(payload));
                document.body.appendChild(iframe);

                setTimeout(function () {
                    try { document.body.removeChild(iframe); } catch (e) { }
                    resolve({ sucesso: true });
                }, CONFIG.timeoutIframe);
            });
        });

        Promise.all(promessas).then(function () {
            mostrarToast('Dados salvos na planilha!', 'success');
            if (statusText) statusText.innerHTML = '✅ <span class="ok">Salvo com sucesso!</span>';
            salvarBancoLocal(montarBancoLocal());
            lerGoogleSheets();
        }).catch(function (error) {
            console.error('Erro ao salvar:', error);
            if (statusText) statusText.innerHTML = '❌ <span class="erro">Erro: ' + error.message + '</span>';
            mostrarToast('Erro ao salvar na planilha', 'error');
        });
    } catch (error) {
        console.error('Erro ao salvar:', error);
        if (statusText) statusText.innerHTML = '❌ <span class="erro">Erro: ' + error.message + '</span>';
        mostrarToast('Erro ao salvar na planilha', 'error');
    }
}

// ============================================================
//  CARREGAR DADOS DE EXEMPLO (fallback offline)
// ============================================================
function carregarDadosExemplo() {
    const dataAtual = getDataAtual();
    const dados = ROSTER_SEED.map(function (r, idx) {
        return {
            id: idx + 1,
            frente: r[0],
            frota: r[1],
            turno: null,
            data: dataAtual,
            status: 'NAOOK',
            oficina: false,
            desativada: false
        };
    });
    registrosOriginais = dados;
    salvarLocal();
    salvarBancoLocal(montarBancoLocal());
    aplicarFiltroDataAtual();
    renderizarTudo();
    setStatus('📋 <span class="info">' + registros.length + ' registros de exemplo</span>');
}


// ============================================================
//  RENDER PRINCIPAL
// ============================================================
function renderizarTudo() {
    renderizarCards();
    renderizarFiltrosFrente();
    renderizarTabela();
    atualizarHora();
    ajustarDashboard();
}

// ============================================================
//  RENDER CARDS (dashboard)
// ============================================================
function renderizarCards() {
    const cicloAtual = getDataAtual();

    const emOficina = registros.filter(function (r) { return r.oficina; });
    const desativadas = registros.filter(function (r) { return r.desativada; });
    const ativos = registros.filter(function (r) { return !r.oficina && !r.desativada; });
    const ok = ativos.filter(function (r) { return r.status === 'OK'; });
    const naook = ativos.filter(function (r) { return r.status === 'NAOOK'; });

    const okA = ok.filter(function (r) { return r.turno === 'A'; });
    const okB = ok.filter(function (r) { return r.turno === 'B'; });
    const okC = ok.filter(function (r) { return r.turno === 'C'; });

    const totalAtivos = ativos.length;
    const eficiencia = totalAtivos > 0 ? Math.round((ok.length / totalAtivos) * 100) : 0;
    const pctPendente = totalAtivos > 0 ? Math.round((naook.length / totalAtivos) * 100) : 0;
    const pct = function (n) { return ok.length > 0 ? Math.round((n / ok.length) * 100) : 0; };

    setTexto('totalRegistros', totalAtivos);
    setTexto('totalHoje',
        'Hoje: ' + ativos.filter(function (r) { return r.data === cicloAtual; }).length +
        (emOficina.length ? ' · 🔧 ' + emOficina.length + ' na oficina' : '') +
        (desativadas.length ? ' · 🚫 ' + desativadas.length + ' desativada(s)' : ''));

    setTexto('totalOk', ok.length);
    setTexto('eficiencia', eficiencia + '%');
    setTexto('totalNaook', naook.length);
    setTexto('pctPendente', pctPendente + '% do total');
    setTexto('totalTurnoA', okA.length);
    setTexto('pctTurnoA', pct(okA.length) + '% das lavadas');
    setTexto('totalTurnoB', okB.length);
    setTexto('pctTurnoB', pct(okB.length) + '% das lavadas');
    setTexto('totalTurnoC', okC.length);
    setTexto('pctTurnoC', pct(okC.length) + '% das lavadas');
}

function setTexto(id, valor) {
    const el = document.getElementById(id);
    if (el) el.textContent = valor;
}

// ============================================================
//  RENDER TABELA
// ============================================================
function renderizarTabela() {
    const dados = getRegistrosFiltrados();
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;

    if (dados.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-msg">📋 Nenhum registro encontrado</td></tr>';
        return;
    }

    let html = '';
    dados.forEach(function (r, idx) {
        const turnoHtml = (r.status === 'OK' && r.turno)
            ? '<span class="turno-badge ' + r.turno + '">' + r.turno + '</span>'
            : '<span class="turno-badge dash">—</span>';

        let statusClass = r.oficina ? 'disabled' : r.status;
        let statusLabel = r.oficina ? '🛠️ OFICINA' : (r.status === 'OK' ? '✅ OK' : '❌ NÃOOK');
        let statusCellClass = r.oficina ? 'status-cell disabled' : 'status-cell';
        if (r.desativada) {
            statusClass = 'disabled';
            statusLabel = '🚫 DESATIVADA';
            statusCellClass = 'status-cell disabled';
        }
        const onclick = (r.oficina || r.desativada) ? '' : 'onclick="alternarStatus(' + r.id + ')"';

        const anterior = idx > 0 ? dados[idx - 1] : null;
        const grupoClass = (!anterior || anterior.frente !== r.frente)
            ? (r.frente === GRUPO_OFICINA ? 'grupo-oficina' : 'grupo-frente')
            : '';

        html += '<tr class="' + (r.oficina ? 'linha-oficina' : '') + ' ' +
            (r.desativada ? 'linha-desativada' : '') + ' ' + grupoClass + '">' +
            '<td class="col-frente" title="' + escapeAttr(r.frente) + '">' + escapeHtml(r.frente) + '</td>' +
            '<td class="col-frota">' +
            '<span class="frota-chip ' + (r.oficina ? 'oficina' : '') + ' ' + (r.desativada ? 'desativada' : '') + '">' +
            escapeHtml(r.frota) +
            (r.oficina ? '<span class="oficina-tag">OFICINA</span>' : '') +
            (r.desativada ? '<span class="oficina-tag" style="background:#e2e8f0;color:#4a5568;">DESATIVADA</span>' : '') +
            '</span>' +
            '<button class="btn-editar-frota" onclick="abrirEdicaoFrota(' + r.id + ')" title="Editar colhedora">📝</button>' +
            '</td>' +
            '<td class="col-turno">' + turnoHtml + '</td>' +
            '<td class="col-data">' + formatarData(r.data) + '</td>' +
            '<td class="' + statusCellClass + '" ' + onclick + '>' +
            '<span class="status-badge ' + statusClass + '" id="status-' + r.id + '">' + statusLabel + '</span>' +
            '</td>' +
            '</tr>';
    });
    tbody.innerHTML = html;
}

// ============================================================
//  RENDER FILTROS DE FRENTE (select dinamico)
// ============================================================
function renderizarFiltrosFrente() {
    const select = document.getElementById('filterFrente');
    if (!select) return;
    const atual = select.value;
    const frentes = Array.from(new Set(registros.map(function (r) { return r.frente; }))).sort();
    let html = '<option value="all">Todas</option>';
    frentes.forEach(function (f) {
        html += '<option value="' + escapeAttr(f) + '">' + escapeHtml(f) + '</option>';
    });
    select.innerHTML = html;
    if (atual && frentes.indexOf(atual) !== -1) select.value = atual;
}

// ============================================================
//  ATUALIZAR HORA / TURNO NO CABECALHO
// ============================================================
function atualizarHora() {
    const now = new Date();
    const horaEl = document.getElementById('headerTime');
    const turnoEl = document.getElementById('headerShift');
    if (horaEl) horaEl.textContent = now.toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (turnoEl) turnoEl.textContent = 'Turno ' + calcularTurnoPorHorario(now);
}

// ============================================================
//  FORMATAR DATA (YYYY-MM-DD -> DD/MM)
// ============================================================
function formatarData(dataStr) {
    if (!dataStr) return '-';
    const p = dataStr.split('-');
    if (p.length < 3) return dataStr;
    return p[2] + '/' + p[1];
}

// ============================================================
//  FILTROS (leitura dos campos)
// ============================================================
function getFiltros() {
    return {
        turno: document.getElementById('filterTurno') ? document.getElementById('filterTurno').value : 'all',
        status: document.getElementById('filterStatus') ? document.getElementById('filterStatus').value : 'all',
        frente: document.getElementById('filterFrente') ? document.getElementById('filterFrente').value : 'all',
        data: document.getElementById('filterData') ? document.getElementById('filterData').value : ''
    };
}

// ============================================================
//  REGISTROS FILTRADOS (aplicado na tabela)
// ============================================================
function getRegistrosFiltrados() {
    const f = getFiltros();
    const buscaEl = document.getElementById('searchInput');
    const busca = (buscaEl && buscaEl.value ? buscaEl.value : '').trim().toLowerCase();
    let resultado = registros.slice();

    if (f.turno !== 'all') resultado = resultado.filter(function (r) { return r.turno === f.turno; });
    if (f.status !== 'all') resultado = resultado.filter(function (r) { return r.status === f.status && !r.oficina; });
    if (f.frente !== 'all') resultado = resultado.filter(function (r) { return r.frente === f.frente; });
    if (busca) resultado = resultado.filter(function (r) {
        return r.frota.toLowerCase().indexOf(busca) !== -1 || r.frente.toLowerCase().indexOf(busca) !== -1;
    });

    resultado.sort(function (a, b) { return a.frente.localeCompare(b.frente); });
    return resultado;
}

// ============================================================
//  HELPERS DE ESCAPE (HTML/atributo)
// ============================================================
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

function escapeAttr(text) {
    return escapeHtml(text).replace(/"/g, '&quot;');
}


// ============================================================
//  AÇÕES
// ============================================================
function alternarStatus(id) {
    const r = registros.find(function (x) { return x.id === id; });
    if (!r) return;

    if (r.oficina) {
        mostrarToast('Colhedora em manutencao — nao pode ser marcada', 'error');
        return;
    }
    if (r.desativada) {
        mostrarToast('Frente desativada — nao pode ser marcada', 'error');
        return;
    }
    if (ehMais48h(r.data)) {
        mostrarToast('Registro com mais de 48h — bloqueado', 'error');
        return;
    }

    const badge = document.getElementById('status-' + id);
    if (badge) badge.classList.add('syncing');

    if (r.status === 'OK') {
        if (!confirm('Deseja realmente desmarcar ' + r.frota + ' como NÃOOK?')) {
            if (badge) badge.classList.remove('syncing');
            return;
        }
        r.status = 'NAOOK';
        r.turno = null;
    } else {
        r.status = 'OK';
        r.turno = calcularTurnoPorHorario();
        r.data = getDataAtual();
    }

    const rOrig = registrosOriginais.find(function (x) { return x.id === id; });
    if (rOrig) { rOrig.status = r.status; rOrig.turno = r.turno; rOrig.data = r.data; }

    salvarLocal();
    renderizarTudo();

    enviarAcao({
        acao: 'atualizarStatus',
        frota: r.frota,
        data: r.data,
        status: r.status,
        turno: r.turno || '',
        frente: r.frente
    }, function () {
        mostrarToast(r.status === 'OK'
            ? r.frota + ' lavada — Turno ' + r.turno
            : r.frota + ' voltou para NÃOOK', 'success');
    });
}

// Envia uma acao ao Apps Script via iframe (GET ?dados=).
// Usa o evento "load" do iframe para saber quando a resposta do Apps
// Script realmente chegou, em vez de remover o iframe num tempo fixo
// (o que podia abortar a requisicao antes dela concluir quando o Apps
// Script demorava mais que o timeout). Um timeout de seguranca maior
// (CONFIG.timeoutIframeCritico) garante que o callback sempre dispare,
// mesmo se o evento "load" nao disparar por algum motivo.
function enviarAcao(payload, cb) {
    try {
        let finalizado = false;
        const iframe = document.createElement('iframe');
        const concluir = function () {
            if (finalizado) return;
            finalizado = true;
            try { document.body.removeChild(iframe); } catch (e) { }
            if (cb) cb();
        };

        iframe.style.display = 'none';
        iframe.onload = concluir;
        iframe.onerror = concluir;
        iframe.src = CONFIG.webAppUrl + '?dados=' + encodeURIComponent(JSON.stringify(payload));
        document.body.appendChild(iframe);

        setTimeout(concluir, CONFIG.timeoutIframeCritico);
    } catch (e) {
        if (cb) cb();
    }
}

// Envia uma acao critica (ex: criar/excluir colhedora) garantindo entrega
// mesmo se a pagina for fechada/atualizada logo em seguida: alem do envio
// normal via enviarAcao, registra um envio de reforco no "beforeunload"
// (apenas uma vez por chamada, para nao acumular listeners).
function enviarAcaoBeacon(payload, cb) {
    enviarAcao(payload, cb);

    document.addEventListener('beforeunload', function () {
        const url = CONFIG.webAppUrl + '?dados=' + encodeURIComponent(JSON.stringify(payload));
        const iframeReforco = document.createElement('iframe');
        iframeReforco.style.display = 'none';
        iframeReforco.src = url;
        document.body.appendChild(iframeReforco);
    }, { once: true, capture: true });
}

// ============================================================
//  NOVA COLHEDORA
// ============================================================
function novaColhedora() {
    const frente = prompt('Digite a FRENTE (ex: FRENTE - 08):');
    if (!frente) return;
    const frota = prompt('Digite a FROTA (ex: 80118):');
    if (!frota) return;

    marcarPendente(frota.trim(), getDataAtual());
    enviarAcao({
        acao: 'adicionar',
        frente: frente.trim(),
        frota: frota.trim(),
        data: getDataAtual()
    }, function () {
        mostrarToast('Colhedora ' + frota + ' adicionada', 'success');
        lerGoogleSheets();
    });
}

// ============================================================
//  MODAL DE EDICAO DE FROTA
// ============================================================
function abrirEdicaoFrota(id) {
    const r = registros.find(function (item) { return item.id === id; });
    if (!r) return;

    edicaoFrotaId = id;
    setTexto('modalFrotaNumero', r.frota);
    setTexto('modalFrotaFrenteAtual', r.frente);

    const frenteInput = document.getElementById('modalFrotaFrente');
    if (frenteInput) frenteInput.value = r.frente;

    const oficinaChk = document.getElementById('modalFrotaOficina');
    if (oficinaChk) oficinaChk.checked = !!r.oficina;
    const desativaChk = document.getElementById('modalFrotaDesativar');
    if (desativaChk) desativaChk.checked = !!r.desativada;

    atualizarOficinaUI();

    const datalist = document.getElementById('listaFrentes');
    if (datalist) {
        const frentes = Array.from(new Set(registrosOriginais.map(function (x) { return x.frente; }))).sort();
        datalist.innerHTML = frentes.map(function (f) { return '<option value="' + escapeAttr(f) + '"></option>'; }).join('');
    }

    const modal = document.getElementById('modalFrota');
    if (modal) modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

// Atualiza o badge de oficina dentro do modal conforme o checkbox
function atualizarOficinaUI() {
    const chk = document.getElementById('modalFrotaOficina');
    const badge = document.getElementById('oficinaBadge');
    const section = document.getElementById('oficinaSection');
    const ativo = chk ? chk.checked : false;

    if (badge) {
        badge.textContent = ativo ? 'Ativo' : 'Inativo';
        badge.classList.toggle('active', ativo);
        badge.classList.toggle('inactive', !ativo);
    }
    if (section) section.classList.toggle('ativa', ativo);
}

// ============================================================
//  ABAS DO MODAL
// ============================================================
function trocarAbaModal(tabId) {
    document.querySelectorAll('.tab-btn').forEach(function(btn) {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });
    document.querySelectorAll('.tab-content').forEach(function(content) {
        content.classList.toggle('active', content.id === tabId);
    });

    if (tabId === 'tabFrentes') {
        carregarListaFrentes();
    }

    if (tabId === 'tabColhedoras') {
        atualizarSelectFrentesColhedoras();
        carregarListaColhedoras();
    }
}

function carregarListaFrentes() {
    const tbody = document.getElementById('tabelaFrentes');
    if (!tbody) return;

    const frentes = Array.from(new Set(registrosOriginais.map(function (x) { return x.frente; }))).sort();

    if (frentes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="2" class="empty-msg">📋 Nenhuma frente cadastrada</td></tr>';
        return;
    }

    tbody.innerHTML = frentes.map(function (frente) {
        const total = registrosOriginais.filter(function (r) { return r.frente === frente; }).length;
        return '<tr>' +
            '<td>' + escapeHtml(frente) + '</td>' +
            '<td>' +
                '<button class="btn-editar-frota" onclick="editarFrenteModal(\'' + escapeAttr(frente) + '\')" title="Editar frente">✏️</button> ' +
                '<button class="btn-excluir" onclick="excluirFrenteModal(\'' + escapeAttr(frente) + '\')" title="Excluir frente">🗑️</button>' +
            '</td>' +
        '</tr>';
    }).join('');
}

function editarFrenteModal(frente) {
    const novoNome = prompt('Editar nome da frente:', frente);
    if (!novoNome || !novoNome.trim()) return;
    const nome = novoNome.trim();

    if (nome === frente) return;

    const registrosAfetados = registrosOriginais.filter(function (r) { return r.frente === frente; });
    if (registrosAfetados.length === 0) {
        mostrarToast('Frente não encontrada', 'error');
        return;
    }

    registrosAfetados.forEach(function (r) {
        r.frente = nome;
        enviarAcao({
            acao: 'moverFrente',
            frota: r.frota,
            novaFrente: nome,
            data: r.data
        });
    });

    salvarLocal();
    salvarBancoLocal(montarBancoLocal());
    aplicarFiltroDataAtual();
    renderizarTudo();
    carregarListaFrentes();
    mostrarToast('Frente atualizada', 'success');
}

function excluirFrenteModal(frente) {
    if (!confirm('Excluir a frente "' + frente + '"?\nIsso afetará ' + registrosOriginais.filter(function (r) { return r.frente === frente; }).length + ' registro(s).')) return;

    const registrosAfetados = registrosOriginais.filter(function (r) { return r.frente === frente; });
    registrosAfetados.forEach(function (r) {
        enviarAcao({
            acao: 'excluir',
            frota: r.frota,
            data: r.data
        });
    });

    registrosOriginais = registrosOriginais.filter(function (r) { return r.frente !== frente; });
    registros = registros.filter(function (r) { return r.frente !== frente; });

    salvarLocal();
    salvarBancoLocal(montarBancoLocal());
    renderizarTudo();
    carregarListaFrentes();
    mostrarToast('Frente excluída', 'success');
}

function criarNovaFrente() {
    const input = document.getElementById('novaFrenteNome');
    const nome = input ? input.value.trim() : '';
    if (!nome) { mostrarToast('Informe o nome da frente', 'error'); return; }

    const existentes = Array.from(new Set(registrosOriginais.map(function (x) { return x.frente; })));
    if (existentes.indexOf(nome) !== -1) { mostrarToast('Frente já existe', 'error'); return; }

    registrosOriginais.push({
        id: Date.now(),
        frente: nome,
        frota: 'NOVA-' + Date.now(),
        turno: null,
        data: getDataAtual(),
        status: 'NAOOK',
        oficina: false,
        desativada: false
    });

    salvarLocal();
    salvarBancoLocal(montarBancoLocal());
    aplicarFiltroDataAtual();
    renderizarTudo();
    carregarListaFrentes();

    if (input) input.value = '';
    mostrarToast('Frente criada', 'success');
}

// ============================================================
//  GERENCIAR COLHEDORAS
// ============================================================
function carregarListaColhedoras() {
    const tbody = document.getElementById('tabelaColhedoras');
    if (!tbody) return;

    const hoje = getDataAtual();
    const mapa = new Map();
    registrosOriginais.forEach(function (r) {
        if (!r.frota) return;
        const cur = mapa.get(r.frota);
        if (!cur) {
            mapa.set(r.frota, Object.assign({}, r));
            return;
        }
        if (r.data === hoje && cur.data !== hoje) {
            cur.id = r.id;
            cur.data = r.data;
            cur.status = r.status;
            cur.turno = r.turno;
            cur.desativada = r.desativada;
            cur.oficina = r.oficina;
            cur.frente = r.frente;
        }
    });
    const ordenados = Array.from(mapa.values()).sort(function (a, b) { return a.frota.localeCompare(b.frota); });

    if (ordenados.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="empty-msg">📋 Nenhuma colhedora cadastrada</td></tr>';
        return;
    }

    tbody.innerHTML = ordenados.map(function (r) {
        const frente = escapeHtml(r.oficina ? GRUPO_OFICINA : (r.frente || GRUPO_OFICINA));
        return '<tr>' +
            '<td>' + escapeHtml(r.frota) + '</td>' +
            '<td>' + frente + '</td>' +
            '<td>' +
                '<button class="btn-editar-frota" onclick="editarColhedoraModal(' + r.id + ')" title="Editar colhedora">✏️</button> ' +
                '<button class="btn-excluir" onclick="excluirColhedoraModal(' + r.id + ')" title="Excluir colhedora">🗑️</button>' +
            '</td>' +
        '</tr>';
    }).join('');
}

function atualizarSelectFrentesColhedoras() {
    const select = document.getElementById('novaColhedoraFrente');
    if (!select) return;
    const frentes = Array.from(new Set(registrosOriginais.map(function (x) { return x.frente; }))).sort();
    select.innerHTML = '<option value="">Selecione a frente</option>';
    frentes.forEach(function (f) {
        select.innerHTML += '<option value="' + escapeAttr(f) + '">' + escapeHtml(f) + '</option>';
    });
}

function criarNovaColhedora() {
    const frotaInput = document.getElementById('novaColhedoraFrota');
    const frenteSelect = document.getElementById('novaColhedoraFrente');
    const oficinaChk = document.getElementById('novaColhedoraOficina');

    const frota = frotaInput ? frotaInput.value.trim() : '';
    if (!frota) { mostrarToast('Informe a frota', 'error'); return; }

    const frente = frenteSelect ? frenteSelect.value.trim() : '';
    const oficina = oficinaChk ? oficinaChk.checked : false;

    if (!oficina && !frente) { mostrarToast('Selecione uma frente ou ative a oficina', 'error'); return; }

    const frenteFinal = oficina ? GRUPO_OFICINA : (frente || 'FRENTE - 08');

    const existente = registrosOriginais.find(function (r) { return r.frota === frota; });
    if (existente) { mostrarToast('Colhedora já existe', 'error'); return; }

    registrosOriginais.push({
        id: Date.now(),
        frente: frenteFinal,
        frota: frota,
        turno: null,
        data: getDataAtual(),
        status: 'NAOOK',
        oficina: !!oficina,
        desativada: false
    });

    salvarLocal();
    salvarBancoLocal(montarBancoLocal());
    aplicarFiltroDataAtual();
    renderizarTudo();
    carregarListaColhedoras();
    atualizarSelectFrentesColhedoras();

    // Marca como pendente ANTES de enviar: protege o registro contra ser
    // apagado por uma sincronizacao com a planilha ate que o servidor
    // realmente confirme a criacao (a fila e limpa automaticamente por
    // mesclarPendentesEm() assim que a colhedora aparecer na resposta
    // do Apps Script, ou apos expirar o prazo de seguranca).
    const frentePlanilha = frente || 'FRENTE - 08';
    marcarPendente(frota, getDataAtual());
    enviarAcaoBeacon({ acao: 'adicionar', frente: frentePlanilha, frota: frota, data: getDataAtual() });
    if (oficina) {
        setTimeout(function () {
            enviarAcao({ acao: 'enviarOficina', frota: frota, enviar: true, data: getDataAtual() });
        }, CONFIG.timeoutIframe);
    }

    if (frotaInput) frotaInput.value = '';
    if (oficinaChk) oficinaChk.checked = false;
    mostrarToast('Colhedora criada', 'success');
}

function editarColhedoraModal(id) {
    const r = registrosOriginais.find(function (item) { return item.id === id; });
    if (!r) return;

    edicaoFrotaId = id;
    setTexto('modalFrotaNumero', r.frota);
    setTexto('modalFrotaFrenteAtual', r.frente);

    const frenteInput = document.getElementById('modalFrotaFrente');
    if (frenteInput) frenteInput.value = r.frente;

    const oficinaChk = document.getElementById('modalFrotaOficina');
    if (oficinaChk) oficinaChk.checked = !!r.oficina;
    const desativaChk = document.getElementById('modalFrotaDesativar');
    if (desativaChk) desativaChk.checked = !!r.desativada;

    atualizarOficinaUI();

    const modal = document.getElementById('modalFrota');
    if (modal) modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function excluirColhedoraModal(id) {
    const r = registrosOriginais.find(function (x) { return x.id === id; });
    if (!r) return;
    if (!confirm('Excluir a colhedora ' + r.frota + '?')) return;

    desmarcarPendente(r.frota);
    enviarAcaoBeacon({ acao: 'excluir', frota: r.frota, data: r.data }, function () {
        registros = registros.filter(function (x) { return x.frota !== r.frota; });
        registrosOriginais = registrosOriginais.filter(function (x) { return x.frota !== r.frota; });
        salvarLocal();
        salvarBancoLocal(montarBancoLocal());
        renderizarTudo();
        carregarListaColhedoras();
        mostrarToast('Colhedora removida', 'success');
    });
}

function fecharModalFrota() {
    const modal = document.getElementById('modalFrota');
    if (modal) modal.classList.remove('active');
    document.body.style.overflow = '';
    edicaoFrotaId = null;
}

function salvarEdicaoFrota() {
    if (edicaoFrotaId === null) return;
    const r = registros.find(function (x) { return x.id === edicaoFrotaId; })
        || registrosOriginais.find(function (x) { return x.id === edicaoFrotaId; });
    if (!r) return;

    let frente = (document.getElementById('modalFrotaFrente').value || '').trim();
    if (!frente) { mostrarToast('Informe a frente', 'error'); return; }

    const oficina = document.getElementById('modalFrotaOficina').checked;
    const desativada = document.getElementById('modalFrotaDesativar').checked;

    const rOrig = registrosOriginais.find(function (x) { return x.id === edicaoFrotaId; });
    const frenteAnterior = rOrig ? rOrig.frente : r.frente;
    const oficinaAnterior = rOrig ? rOrig.oficina : r.oficina;
    const desativadaAnterior = rOrig ? rOrig.desativada : r.desativada;

    if (oficina) {
        frente = GRUPO_OFICINA;
    } else if (frenteAnterior === GRUPO_OFICINA && !oficina) {
        const voltarOrigem = confirm('Deseja voltar para a frente original?');
        if (voltarOrigem) {
            frente = rOrig.frenteOriginal || r.frente;
        } else {
            const frentesAtivas = Array.from(new Set(registrosOriginais
                .filter(function (x) { return x.frente !== GRUPO_OFICINA; })
                .map(function (x) { return x.frente; }))).sort();
            if (frentesAtivas.length === 0) {
                mostrarToast('Nenhuma frente ativa disponivel', 'error');
                return;
            }
            frente = prompt('Digite a nova frente (ex: FRENTE - 08):\nOpcoes: ' + frentesAtivas.join(', ')) || frentesAtivas[0];
            if (frentesAtivas.indexOf(frente) === -1) {
                mostrarToast('Frente invalida', 'error');
                return;
            }
        }
    }

    r.frente = frente;
    r.oficina = oficina;
    r.desativada = desativada;
    if (rOrig) {
        rOrig.frente = frente;
        rOrig.oficina = oficina;
        rOrig.desativada = desativada;
        if (oficina && !rOrig.frenteOriginal) rOrig.frenteOriginal = frenteAnterior;
        if (!oficina && rOrig.frenteOriginal) delete rOrig.frenteOriginal;
    }

    salvarLocal();
    renderizarTudo();
    carregarListaColhedoras();

    if (frente !== frenteAnterior) {
        enviarAcao({ acao: 'moverFrente', frota: r.frota, novaFrente: frente, data: r.data });
    }
    if (oficina !== oficinaAnterior) {
        enviarAcao({ acao: 'enviarOficina', frota: r.frota, enviar: oficina, data: r.data });
    }
    if (desativada !== desativadaAnterior) {
        enviarAcao({ acao: 'desativarFrente', frota: r.frota, desativar: desativada, data: r.data });
    }

    mostrarToast(oficina ? 'Colhedora enviada para a oficina'
        : (desativada ? 'Frente desativada' : 'Colhedora atualizada'), 'success');
    fecharModalFrota();
}

function excluirFrotaModal() {
    if (edicaoFrotaId === null) return;
    const r = registros.find(function (x) { return x.id === edicaoFrotaId; });
    if (!r) return;

    if (!confirm('Excluir o registro de ' + r.frota + '?')) return;
    if (ehMais48h(r.data)) { mostrarToast('Registro com mais de 48h — exclusao bloqueada', 'error'); return; }

    enviarAcao({ acao: 'excluir', frota: r.frota, data: r.data }, function () {
        registros = registros.filter(function (x) { return x.id !== edicaoFrotaId; });
        registrosOriginais = registrosOriginais.filter(function (x) { return x.id !== edicaoFrotaId; });
        salvarLocal();
        renderizarTudo();
        mostrarToast('Colhedora removida', 'info');
        fecharModalFrota();
    });
}

function limparTodos() {
    if (!confirm('Limpar cache local?')) return;
    registros = [];
    registrosOriginais = [];
    try { localStorage.removeItem(CONFIG.chaveOriginais); } catch (e) { }
    try { localStorage.removeItem(CONFIG.chaveBanco); } catch (e) { }
    renderizarTudo();
    mostrarToast('Cache local limpo', 'info');
}


// ============================================================
//  BAIXAR BANCO LOCAL (exporta JSON)
// ============================================================
function baixarBancoLocal() {
    if (registrosOriginais.length === 0) { mostrarToast('Sem dados para baixar', 'error'); return; }

    const banco = montarBancoLocal();
    const blob = new Blob([JSON.stringify(banco, null, 2)], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'banco_lavagem_' + getDataAtual() + '.json';
    document.body.appendChild(a);
    a.click();
    try { document.body.removeChild(a); } catch (e) { }
    URL.revokeObjectURL(url);

    try { localStorage.setItem(CONFIG.chaveUltimoSync, banco.lastSync); } catch (e) { }
    mostrarToast('Banco local baixado!', 'success');
}

// ============================================================
//  IMPORTAR BANCO LOCAL (le JSON)
// ============================================================
function importarBancoLocal() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = function (e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (event) {
            try {
                const banco = JSON.parse(event.target.result);
                if (!banco.registros || !Array.isArray(banco.registros)) {
                    mostrarToast('Arquivo invalido', 'error');
                    return;
                }
                registrosOriginais = banco.registros.map(function (r, i) { return normalizarRegistro(r, i); });
                salvarLocal();
                salvarBancoLocal(banco);
                aplicarFiltroDataAtual();
                renderizarTudo();
                mostrarToast('Banco local importado!', 'success');
            } catch (err) {
                mostrarToast('Erro ao ler arquivo', 'error');
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

// ============================================================
//  SINCRONIZAR INCREMENTAL (JSONP + merge por id)
// ============================================================
function sincronizarIncremental() {
    const bancoLocal = getBancoLocal();
    const lastSync = bancoLocal ? bancoLocal.lastSync : null;

    if (!lastSync) {
        lerGoogleSheets();
        return;
    }

    setStatus('🔄 <span class="loading">Sincronizando...</span>');

    const callbackName = 'jsonpCallback_' + Date.now();
    const script = document.createElement('script');

    window[callbackName] = function (data) {
        try { delete window[callbackName]; } catch (e) { }
        try { document.body.removeChild(script); } catch (e) { }

        if (!data || data.erro || !data.dados || data.dados.length === 0) {
            // Sem dados do servidor: tenta cache local
            if (!carregarDadosSalvos()) {
                setStatus('❌ <span class="erro">Sem dados da planilha e sem cache local</span>');
            }
            return;
        }

        const dadosServidor = data.dados.map(function (r) {
            return normalizarRegistro(r, null);
        });

        const localMap = new Map();
        registrosOriginais.forEach(function (r) { localMap.set(r.id, r); });

        let atualizados = 0;
        let novos = 0;

        dadosServidor.forEach(function (r) {
            const local = localMap.get(r.id);
            if (!local) {
                registrosOriginais.push(r);
                novos++;
            } else if (r.updatedAt > local.updatedAt) {
                local.frente = r.frente;
                local.frota = r.frota;
                local.turno = r.turno || null;
                local.data = r.data || getDataAtual();
                local.status = r.status || 'NAOOK';
                local.oficina = !!r.oficina;
                local.desativada = !!r.desativada;
                local.updatedAt = r.updatedAt;
                atualizados++;
            }
        });

        if (atualizados > 0 || novos > 0) {
            salvarLocal();
            aplicarFiltroDataAtual();
            renderizarTudo();
        }

        const novoBanco = montarBancoLocal();
        salvarBancoLocal(novoBanco);

        setStatus('✅ <span class="ok">Sincronizado: ' + atualizados + ' atualizados, ' + novos + ' novos</span>');

        // Backup automatico apos sincronizacao
        const blobBanco = new Blob([JSON.stringify(novoBanco, null, 2)], { type: 'application/json;charset=utf-8;' });
        const urlBanco = URL.createObjectURL(blobBanco);
        const aBanco = document.createElement('a');
        aBanco.href = urlBanco;
        aBanco.download = 'banco_lavagem_sync_' + getDataAtual() + '.json';
        document.body.appendChild(aBanco);
        aBanco.click();
        try { document.body.removeChild(aBanco); } catch (e) { }
        URL.revokeObjectURL(urlBanco);
    };

    script.src = CONFIG.webAppUrl + '?callback=' + encodeURIComponent(callbackName) + '&since=' + encodeURIComponent(lastSync);
    script.onerror = function () {
        carregando = false;
        try { delete window[callbackName]; } catch (e) { }
        try { document.body.removeChild(script); } catch (e) { }
        setStatus('❌ <span class="erro">Erro de conexao</span>');
        carregarDadosSalvos();
    };
    document.body.appendChild(script);

    // Timeout de segurança para sincronizacao
    setTimeout(function () {
        if (!carregando) return;
        carregando = false;
        try { delete window[callbackName]; } catch (e) { }
        try { document.body.removeChild(script); } catch (e) { }
        if (!carregarDadosSalvos()) {
            setStatus('❌ <span class="erro">Timeout e sem cache local</span>');
        }
    }, 4000);
}


// ============================================================
//  EXPORTAR PDF (usa window.print)
// ============================================================
function exportarPDF() {
    if (registros.length === 0) { mostrarToast('Sem dados para exportar', 'error'); return; }

    const dataAtual = getDataAtual();
    const turnoAtual = calcularTurnoPorHorario();
    const total = registros.length;
    const ok = registros.filter(function (r) { return r.status === 'OK'; }).length;
    const naook = registros.filter(function (r) { return r.status === 'NAOOK'; }).length;
    const emOficina = registros.filter(function (r) { return r.oficina; }).length;
    const desativadas = registros.filter(function (r) { return r.desativada; }).length;

    let tableRows = '';
    registros.forEach(function (r, idx) {
        const statusClass = r.oficina ? 'status-oficina'
            : r.desativada ? 'status-desativada'
                : r.status === 'OK' ? 'status-ok' : 'status-naook';
        const statusText = r.oficina ? '🛠️ OFICINA'
            : r.desativada ? '🚫 DESATIVADA'
                : r.status === 'OK' ? '✅ OK' : '❌ NÃOOK';
        const turnoText = r.turno || '—';
        const frente = escapeHtml(r.frente);
        const frota = escapeHtml(r.frota);
        const turno = escapeHtml(turnoText);
        const data = escapeHtml(formatarData(r.data));
        const status = '<span class="status-badge ' + statusClass + '">' + statusText + '</span>';

        if (idx > 0) {
            tableRows += '<tr class="separator"><td colspan="5" style="padding:4px 0;">' +
                '<div style="border-top:2px solid #1a202c;margin:0;"></div></td></tr>';
        }
        tableRows += '<tr><td>' + frente + '</td><td>' + frota +
            ' 📝</td><td>' + turno + '</td><td>' + data + '</td><td>' + status + '</td></tr>';
    });

    const html =
        '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
        '<title>Relatorio Lavagem - ' + escapeHtml(dataAtual) + '</title><style>' +
        '*{box-sizing:border-box;margin:0;padding:0}' +
        'body{margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#f0f4f8;color:#1a202c;font-size:14px;line-height:1.6}' +
        '.page{max-width:1100px;margin:0 auto}' +
        'h1{font-size:24px;font-weight:800;margin-bottom:8px;text-align:center}' +
        '.subtitle{text-align:center;color:#718096;font-size:13px;margin-bottom:24px}' +
        '.summary{background:white;border-radius:12px;padding:16px;margin-bottom:24px;box-shadow:0 2px 6px rgba(0,0,0,0.06)}' +
        '.summary-item{padding:10px 0;border-bottom:1px solid #e2e8f0}.summary-item:last-child{border-bottom:none}' +
        '.summary-label{font-weight:600;color:#4a5568;font-size:13px}' +
        '.summary-value{font-weight:700;color:#1a202c;font-size:15px;float:right}' +
        '.report-table{width:100%;border-collapse:collapse;background:white;border-radius:10px;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,0.06)}' +
        '.report-table th{background:#1a365d;color:white;text-align:left;padding:10px 14px;font-size:12px;text-transform:uppercase;letter-spacing:0.05em}' +
        '.report-table td{padding:10px 14px;border-bottom:1px solid #e2e8f0;font-size:13px;vertical-align:middle}' +
        '.report-table tr:last-child td{border-bottom:none}' +
        '.report-table .separator td{padding:2px 0;background:#f7fafc}' +
        '.status-badge{display:inline-block;padding:4px 12px;border-radius:12px;font-size:11px;font-weight:700}' +
        '.status-ok{background:#c6f6d5;color:#22543d}.status-naook{background:#fed7d7;color:#822727}' +
        '.status-oficina{background:#feebc8;color:#744210}.status-desativada{background:#e2e8f0;color:#4a5568}' +
        '@media print{body{padding:0;background:white}.page{max-width:100%}.report-table{box-shadow:none;border:1px solid #e2e8f0}}' +
        '</style></head><body><div class="page">' +
        '<h1>🚜 Controle de Lavagem</h1>' +
        '<div class="subtitle">Relatorio gerado em ' + new Date().toLocaleString('pt-BR') +
        ' • Data operacional: ' + escapeHtml(dataAtual) + ' • Turno: ' + escapeHtml(turnoAtual) + '</div>' +
        '<div class="summary">' +
        '<div class="summary-item"><span class="summary-label">Total de Frotas</span><span class="summary-value">' + total + '</span></div>' +
        '<div class="summary-item"><span class="summary-label">✅ Lavadas</span><span class="summary-value">' + ok + '</span></div>' +
        '<div class="summary-item"><span class="summary-label">❌ Pendentes</span><span class="summary-value">' + naook + '</span></div>' +
        (emOficina > 0 ? '<div class="summary-item"><span class="summary-label">🔧 Na Oficina</span><span class="summary-value">' + emOficina + '</span></div>' : '') +
        (desativadas > 0 ? '<div class="summary-item"><span class="summary-label">🚫 Desativadas</span><span class="summary-value">' + desativadas + '</span></div>' : '') +
        '</div>' +
        '<table class="report-table"><thead><tr><th>Frente</th><th>Frota</th><th>Turno</th><th>Data</th><th>Status</th></tr></thead><tbody>' +
        tableRows +
        '</tbody></table>' +
        '</div></body></html>';

    // Cria uma janela de impressao e dispara window.print()
    const win = window.open('', '_blank');
    if (!win) {
        mostrarToast('Bloqueador de pop-up impediu a impressao', 'error');
        return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(function () {
        win.print();
        mostrarToast('PDF enviado para impressao', 'success');
    }, 400);
}

// ============================================================
//  TOAST
// ============================================================
function mostrarToast(msg, tipo) {
    tipo = tipo || 'info';
    if (toastTimeout) {
        const old = document.querySelector('.toast');
        if (old) old.remove();
        clearTimeout(toastTimeout);
    }
    const el = document.createElement('div');
    el.className = 'toast ' + tipo;
    el.textContent = msg;
    document.body.appendChild(el);
    toastTimeout = setTimeout(function () {
        el.style.opacity = '0';
        el.style.transition = 'opacity 0.3s';
        setTimeout(function () { el.remove(); toastTimeout = null; }, 300);
    }, 2800);
}

// ============================================================
//  AJUSTE DO DASHBOARD (responsivo)
// ============================================================
function ajustarDashboard() {
    const dashboard = document.getElementById('dashboard');
    if (!dashboard) return;
    dashboard.className = window.innerWidth <= 600 ? 'dashboard mobile' : 'dashboard desktop';
}


// ============================================================
//  EVENTOS (DOMContentLoaded)
// ============================================================
document.addEventListener('DOMContentLoaded', function () {
    ajustarDashboard();

    // Mostra o cache local imediatamente (inclui qualquer alteracao feita
    // pelo usuario que ainda nao tenha sido confirmada pela planilha) e,
    // em seguida, sincroniza com o Apps Script. Importante: NAO apagamos
    // o cache local aqui — apagar antes de confirmar que a planilha ja tem
    // os dados mais recentes é o que fazia registros recem-criados (ex:
    // uma colhedora adicionada e a pagina atualizada com F5 logo em seguida)
    // desaparecerem, pois a escrita no Apps Script pode levar alguns
    // segundos para propagar.
    carregarDadosSalvos();

    // Reenvia qualquer acao que ainda nao foi confirmada pela planilha
    try { reenviarPendentes(); } catch (e) { }

    // Sincroniza com a planilha (mescla com pendentes recentes, nao apaga)
    try { lerGoogleSheets(); } catch (e) { setStatus('❌ <span class="erro">Erro ao carregar planilha</span>'); }

    // Botão manual de atualização
    vincularOpcional('atualizarBtn', function () {
        setStatus('🔄 <span class="loading">Atualizando...</span>');
        try { lerGoogleSheets(); } catch (e) { }
    });

    // Painel de filtros
    const filtersToggle = document.getElementById('filtersToggle');
    if (filtersToggle) {
        filtersToggle.addEventListener('click', function () {
            const panel = document.getElementById('filtersPanel');
            const arrow = document.getElementById('filtersArrow');
            if (panel) panel.classList.toggle('open');
            if (arrow) arrow.classList.toggle('open');
        });
    }

    // Exportar PDF
    const exportPdfBtn = document.getElementById('exportPdfBtn');
    if (exportPdfBtn) exportPdfBtn.addEventListener('click', exportarPDF);

    // Aplicar filtros
    const applyFilters = document.getElementById('applyFilters');
    if (applyFilters) {
        applyFilters.addEventListener('click', function () {
            const dataFiltro = document.getElementById('filterData').value;
            registros = dataFiltro
                ? registrosOriginais.filter(function (r) { return r.data === dataFiltro; })
                : registrosOriginais.slice();
            renderizarTudo();
        });
    }

    // Resetar filtros (volta para hoje)
    const resetFilters = document.getElementById('resetFilters');
    if (resetFilters) {
        resetFilters.addEventListener('click', function () {
            const ft = document.getElementById('filterTurno');
            const fs = document.getElementById('filterStatus');
            const ff = document.getElementById('filterFrente');
            const fd = document.getElementById('filterData');
            const si = document.getElementById('searchInput');
            if (ft) ft.value = 'all';
            if (fs) fs.value = 'all';
            if (ff) ff.value = 'all';
            if (fd) fd.value = getDataAtual();
            if (si) si.value = '';
            registros = registrosOriginais.filter(function (r) { return r.data === getDataAtual(); });
            renderizarTudo();
        });
    }

    // Busca em tempo real
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.addEventListener('input', function () { renderizarTabela(); });

    // Filtros de turno/status/frente disparam re-render imediato
    ['filterTurno', 'filterStatus', 'filterFrente'].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', function () { renderizarTabela(); });
    });

    // Modal de edicao de frota
    const modalFrotaCancel = document.getElementById('modalFrotaCancel');
    if (modalFrotaCancel) modalFrotaCancel.addEventListener('click', fecharModalFrota);

    const modalFrotaSave = document.getElementById('modalFrotaSave');
    if (modalFrotaSave) modalFrotaSave.addEventListener('click', salvarEdicaoFrota);

    const modalFrotaExcluir = document.getElementById('modalFrotaExcluir');
    if (modalFrotaExcluir) modalFrotaExcluir.addEventListener('click', excluirFrotaModal);

    const modalFrotaOficina = document.getElementById('modalFrotaOficina');
    if (modalFrotaOficina) modalFrotaOficina.addEventListener('change', atualizarOficinaUI);

    const modalFrota = document.getElementById('modalFrota');
    if (modalFrota) {
        modalFrota.addEventListener('click', function (e) {
            if (e.target === this) fecharModalFrota();
        });
    }

    // Abas do modal
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            const tabId = this.getAttribute('data-tab');
            if (tabId) trocarAbaModal(tabId);
        });
    });

    // Botão criar frente
    const btnCriarFrente = document.getElementById('btnCriarFrente');
    if (btnCriarFrente) btnCriarFrente.addEventListener('click', criarNovaFrente);

    // Botão criar colhedora
    const btnCriarColhedora = document.getElementById('btnCriarColhedora');
    if (btnCriarColhedora) btnCriarColhedora.addEventListener('click', criarNovaColhedora);

    // Fechamento por tecla Escape
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') fecharModalFrota();
    });

    // Botoes opcionais (presentes em versoes estendidas da UI)
    vincularOpcional('limparTodosBtn', limparTodos);
    vincularOpcional('salvarBtn', salvarGoogleSheets);
    vincularOpcional('baixarBancoBtn', baixarBancoLocal);
    vincularOpcional('importarBancoBtn', importarBancoLocal);
    vincularOpcional('sincronizarBtn', sincronizarIncremental);

    // Relogio do cabecalho
    setInterval(function () { atualizarHora(); }, 30000);

    // Sincronizacao periodica em segundo plano: reenvia pendentes que
    // ainda nao foram confirmados e busca atualizacoes da planilha
    // (util para multiplos dispositivos e para "curar" uma escrita que
    // nao tenha chegado a tempo na primeira tentativa).
    setInterval(function () {
        try { reenviarPendentes(); } catch (e) { }
        if (!carregando) { try { lerGoogleSheets(); } catch (e) { } }
    }, 45000);

    // Responsividade
    let resizeTimeout;
    window.addEventListener('resize', function () {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(ajustarDashboard, 200);
    });
});

// Vincula um listener a um elemento apenas se ele existir no DOM
function vincularOpcional(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
}

// ============================================================
//  INICIALIZACAO DE DEPURACAO
// ============================================================
console.log('🚜 Controle de Lavagem — versao final');
console.log('📌 Web App: ' + CONFIG.webAppUrl);
console.log('📌 Planilha: ' + CONFIG.editUrl);
console.log('📅 Data operacional: ' + getDataAtual());

