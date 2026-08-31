# Controle de Lavagem de Colhedoras

Aplicativo mobile-first para gestao de lavagem de colhedoras em usina, com persistencia via Google Sheets (Google Apps Script) e captura/compartilhamento de relatorios via WhatsApp.

## Funcionalidades

- Dashboard com totais por turno (A/B/C), status (OK / NAOOK), oficina e desativadas
- Filtros por turno, status, frente, data e busca por frota/frente
- Marcacao rapida de lavagem com calculo automatico de turno operacional
- Cadastro de colhedoras, frentes e movimentacao entre frentes
- Oficina e desativacao com persistencia por dia
- Exportacao PDF (print) com layout otimizado
- **Compartilhamento via WhatsApp**: captura a tela como imagem PNG de alta resolucao (2x scale) e abre o WhatsApp com a imagem anexada, ideal para celular
- PWA-ready (manifest.json + favicons completos)
- Banco local em localStorage para funcionamento offline
- Bloqueio de seguranca para registros com mais de 48h

## Estrutura

- index.html - markup e estrutura
- css/style.css - estilos responsivos
- js/app.js - logica de UI, filtros, render, persistencia local
- js/share.js - captura de tela + compartilhamento WhatsApp (html2canvas + Web Share API)
- lavcol_fixed.js - Google Apps Script (backend) para Google Sheets

## GAS Web App (backend)

A planilha de apoio esta em:
https://docs.google.com/spreadsheets/d/16neBQx7o74lyVqqbZxfz9twHJnzj-slDETEIFQPUqtI/edit

Acoes disponiveis (GET ?dados=JSON):
- adicionar - cria uma nova colhedora
- atualizarStatus - marca OK/NAOOK em uma data
- moverFrente - muda a frente da colhedora
- enviarOficina - coloca/retira da oficina
- desativarFrente - desativa a frente
- excluir - remove uma colhedora
- criarRegistrosDia - gera os registros do dia
- normalizarPlanilha - remove duplicados
- consultarHistorico - retorna o historico de acoes

## Como rodar localmente

\\ash
python -m http.server 8000
# ou
npx http-server
\
Abra http://localhost:8000 no navegador (de preferencia no celular para testar o compartilhamento).

## Compartilhar no WhatsApp (mobile)

1. Clique no botao verde **COMPARTILHAR** (ao lado de EXPORTAR PDF)
2. O app captura a tela (dashboard + tabela) em alta resolucao
3. Abre o menu de compartilhamento nativo do celular
4. Escolha WhatsApp > conversa > a imagem sera anexada

Em desktops / navegadores sem Web Share API, a imagem eh baixada e o wa.me eh aberto com texto pre-preenchido.

## Licenca

Uso interno.
