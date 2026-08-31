// ===========================================================
//  COMPARTILHAR IMAGEM (otimizado para WhatsApp mobile)
// ===========================================================
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

    try {
        const h2c = await loadHtml2Canvas();
        const canvas = await h2c(target, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#f0f4f8',
            logging: false,
            windowWidth: target.scrollWidth,
            windowHeight: target.scrollHeight
        });
        const blob = await canvasToBlob(canvas);
        if (!blob) throw new Error('Falha ao gerar blob');
        const fileName = 'lavagem_' + getDataAtual() + '.png';
        const file = new File([blob], fileName, { type: 'image/png' });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: 'Controle de Lavagem', text: 'Relatorio de Lavagem - ' + getDataAtual() });
                mostrarToast('Imagem compartilhada!', 'success');
                return;
            } catch (e) {}
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        try { document.body.removeChild(a); } catch (e2) {}
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);

        const texto = encodeURIComponent('Relatorio de Lavagem - ' + getDataAtual());
        setTimeout(function () {
            window.open('https://wa.me/?text=' + texto, '_blank');
        }, 600);

        mostrarToast('Imagem baixada! Anexe ao WhatsApp', 'success');
    } catch (err) {
        console.error(err);
        mostrarToast('Erro ao gerar imagem: ' + err.message, 'error');
    }
}
