// ============================================================
//  COPIAR IMAGEM (otimizado para WhatsApp mobile - layout compacto)
// ============================================================
let _html2canvasReady = null;

function loadHtml2Canvas() {
    if (_html2canvasReady) return _html2canvasReady;
    _html2canvasReady = new Promise(function (resolve, reject) {
        if (window.html2canvas) return resolve(window.html2canvas);
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        s.async = true;
        s.onload = function () { resolve(window.html2canvas); };
        s.onerror = function () { reject(new Error('Falha ao carregar html2canvas')); };
        document.head.appendChild(s);
    });
    return _html2canvasReady;
}

function canvasToBlob(canvas) {
    return new Promise(function (resolve) {
        canvas.toBlob(function (blob) { resolve(blob); }, 'image/png', 0.95);
    });
}

async function compartilharWhatsApp() {
    if (!registros || registros.length === 0) {
        mostrarToast('Sem dados para compartilhar', 'error');
        return;
    }
    mostrarToast('Gerando imagem...', 'info');

    const target = document.getElementById('captureForShare');
    if (!target) {
        mostrarToast('Area de captura nao encontrada', 'error');
        return;
    }

    // Aplica classe mobile-snapshot para forcar layout de celular na captura
    target.classList.add('mobile-snapshot');
    // Esconde temporariamente o container para evitar flicker
    const prevVisibility = target.style.visibility;
    target.style.visibility = 'visible';

    try {
        const h2c = await loadHtml2Canvas();

        // Captura com windowWidth 390 (iPhone 12/13) e scale 2 (HD retina)
        const canvas = await h2c(target, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#f0f4f8',
            logging: false,
            windowWidth: 390,
            windowHeight: target.scrollHeight,
            scrollX: 0,
            scrollY: 0
        });
        const blob = await canvasToBlob(canvas);
        if (!blob) throw new Error('Falha ao gerar blob');
        const fileName = 'lavagem_' + getDataAtual() + '.png';
        const file = new File([blob], fileName, { type: 'image/png' });

        // Caminho 1: Clipboard API (Chrome/Edge/Safari modernos)
        if (navigator.clipboard && window.ClipboardItem) {
            try {
                await navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': blob })
                ]);
                mostrarToast('Imagem copiada! Cole no WhatsApp (Ctrl+V / long press)', 'success');
                return;
            } catch (e) {
                console.warn('Clipboard falhou, tentando download:', e);
            }
        }

        // Fallback: download da imagem
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        try { document.body.removeChild(a); } catch (e2) {}
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        mostrarToast('Imagem baixada! Compartilhe o arquivo', 'success');
    } catch (err) {
        console.error(err);
        mostrarToast('Erro ao gerar imagem: ' + err.message, 'error');
    } finally {
        // Remove a classe mobile-snapshot para voltar ao layout normal
        target.classList.remove('mobile-snapshot');
        target.style.visibility = prevVisibility;
    }
}
