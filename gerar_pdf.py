#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gerador de PDF Mobile-First para Relatório de Lavagem
Otimizado para smartphones (320px a 430px de largura)
Usa WeasyPrint para renderização de alta qualidade
"""

import json
import sys
from datetime import datetime

from weasyprint import HTML, CSS


def gerar_pdf_lavagem(dados: dict, saida_pdf: str) -> str:
    registros = dados.get('registros', [])
    data_atual = dados.get('data', datetime.now().strftime('%Y-%m-%d'))
    turno_atual = dados.get('turno', '—')

    linhas_por_frente = {}
    for r in registros:
        frente = r.get('frente', 'SEM FRENTE')
        if frente not in linhas_por_frente:
            linhas_por_frente[frente] = []
        linhas_por_frente[frente].append(r)

    total = len(registros)
    ok = sum(1 for r in registros if r.get('status') == 'OK')
    naook = sum(1 for r in registros if r.get('status') == 'NAOOK')
    em_oficina = sum(1 for r in registros if r.get('oficina'))
    desativadas = sum(1 for r in registros if r.get('desativada'))

    frentes_ordenadas = sorted(linhas_por_frente.keys())

    frente_blocks = []
    for frente in frentes_ordenadas:
        frotas = sorted(linhas_por_frente[frente], key=lambda x: x.get('frota', ''))
        linhas = []
        for r in frotas:
            status = r.get('status', 'NAOOK')
            oficina = r.get('oficina', False)
            desativada = r.get('desativada', False)
            turno = r.get('turno')

            if oficina:
                status_class = 'status-oficina'
                status_text = 'OFICINA'
            elif desativada:
                status_class = 'status-desativada'
                status_text = 'DESATIVADA'
            elif status == 'OK':
                status_class = 'status-ok'
                status_text = 'OK'
            else:
                status_class = 'status-naook'
                status_text = 'NÃOOK'

            turno_html = ''
            if turno:
                turno_html = f'<span class="turno-badge turno-{turno.lower()}">{turno}</span>'

            linhas.append(f"""
                <div class="frota-item">
                    <span class="frota-name">{r.get('frota', '')}</span>
                    {turno_html}
                    <span class="status-badge {status_class}">{status_text}</span>
                </div>
            """)

        frente_blocks.append(f"""
            <div class="frente-group">
                <h3>{frente}</h3>
                {''.join(linhas)}
            </div>
        """)

    html_content = f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Relatório de Lavagem - {data_atual}</title>
    <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        *::before, *::after {{ box-sizing: border-box; }}
        body {{
            margin: 0;
            padding: 20px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f7fa;
            color: #1a202c;
            font-size: 15px;
            line-height: 1.7;
        }}
        .page {{
            max-width: 420px;
            margin: 0 auto;
        }}
        h1 {{
            font-size: 24px;
            font-weight: 800;
            margin-bottom: 8px;
            text-align: center;
        }}
        .subtitle {{
            text-align: center;
            color: #718096;
            font-size: 13px;
            margin-bottom: 28px;
        }}
        .summary {{
            background: white;
            border-radius: 16px;
            padding: 20px;
            margin-bottom: 24px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }}
        .summary-item {{
            padding: 14px 0;
            border-bottom: 1px solid #e2e8f0;
        }}
        .summary-item:last-child {{ border-bottom: none; }}
        .summary-label {{
            font-weight: 600;
            color: #4a5568;
            font-size: 14px;
            display: block;
            margin-bottom: 4px;
        }}
        .summary-value {{
            font-weight: 700;
            color: #1a202c;
            font-size: 16px;
            float: right;
        }}
        .frente-group {{
            background: white;
            border-radius: 16px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }}
        .frente-group h3 {{
            font-size: 18px;
            font-weight: 700;
            margin-bottom: 14px;
            padding-bottom: 10px;
            border-bottom: 3px solid #1a202c;
        }}
        .frota-item {{
            padding: 12px 0;
            border-bottom: 1px solid #f7fafc;
        }}
        .frota-item:last-child {{ border-bottom: none; }}
        .frota-name {{
            font-weight: 700;
            font-size: 15px;
            display: block;
            margin-bottom: 6px;
        }}
        .status-badge {{
            display: inline-block;
            padding: 5px 14px;
            border-radius: 14px;
            font-size: 12px;
            font-weight: 700;
            float: right;
        }}
        .status-ok {{ background: #c6f6d5; color: #22543d; }}
        .status-naook {{ background: #fed7d7; color: #822727; }}
        .status-oficina {{ background: #feebc8; color: #744210; }}
        .status-desativada {{ background: #e2e8f0; color: #4a5568; }}
        .turno-badge {{
            display: inline-block;
            padding: 3px 10px;
            border-radius: 10px;
            font-size: 11px;
            font-weight: 700;
            margin-left: 8px;
            background: #bee3f8;
            color: #2a4365;
        }}
        .turno-a {{ background: #c6f6d5; color: #22543d; }}
        .turno-b {{ background: #bee3f8; color: #2a4365; }}
        .turno-c {{ background: #e9d8fd; color: #44337a; }}

        @page {{
            size: 360mm 640mm;
            margin: 0;
        }}
    </style>
</head>
<body>
    <div class="page">
        <h1>🚜 Controle de Lavagem</h1>
        <div class="subtitle">
            Relatório gerado em {datetime.now().strftime('%d/%m/%Y %H:%M')} •
            Data operacional: {data_atual} • Turno: {turno_atual}
        </div>

        <div class="summary">
            <div class="summary-item">
                <span class="summary-label">Total de Frotas</span>
                <span class="summary-value">{total}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">✅ Lavadas</span>
                <span class="summary-value">{ok}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">❌ Pendentes</span>
                <span class="summary-value">{naook}</span>
            </div>
            {f'<div class="summary-item"><span class="summary-label">🔧 Na Oficina</span><span class="summary-value">{em_oficina}</span></div>' if em_oficina > 0 else ''}
            {f'<div class="summary-item"><span class="summary-label">🚫 Desativadas</span><span class="summary-value">{desativadas}</span></div>' if desativadas > 0 else ''}
        </div>

        {''.join(frente_blocks)}
    </div>
</body>
</html>"""

    HTML(string=html_content).write_pdf(
        saida_pdf,
        stylesheets=[CSS(string='@page { size: 360mm 640mm; margin: 0; }')]
    )

    return saida_pdf


def main():
    if len(sys.argv) < 3:
        print("Uso: python gerar_pdf.py <arquivo_json> <saida.pdf>")
        sys.exit(1)

    arquivo_json = sys.argv[1]
    saida_pdf = sys.argv[2]

    with open(arquivo_json, 'r', encoding='utf-8') as f:
        dados = json.load(f)

    gerar_pdf_lavagem(dados, saida_pdf)
    print(f"PDF gerado: {saida_pdf}")


if __name__ == '__main__':
    main()
